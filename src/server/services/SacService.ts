import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";

export class SacService {
  constructor(
    private readonly events = new EventService(),
    private readonly audit = new AuditService(),
  ) {}

  async open(orderId: string, reason: string, description: string, assemblyJobId?: string) {
    const order = await queryOne<{ id: string; numped: string; codcli: string }>(
      "SELECT ID, NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
      { id: orderId },
    );
    if (!order) throw new Error("Pedido não encontrado.");

    const id = uuid();
    await execDml(
      `INSERT INTO MONT_SAC_CASES
       (ID, ORDER_ID, ASSEMBLY_JOB_ID, REASON, DESCRIPTION, NEXT_ACTION_DATE, SLA_DEADLINE)
       VALUES (:id, :orderId, :jobId, :reason, :description,
               SYSDATE + INTERVAL '3' DAY, SYSDATE + INTERVAL '7' DAY)`,
      { id, orderId, jobId: assemblyJobId ?? null, reason, description },
    );

    if (assemblyJobId) {
      await execDml(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'BLOQUEADO', BLOCKED_REASON = :reason, UPDATED_AT = SYSTIMESTAMP WHERE ASSEMBLY_JOB_ID = :jobId",
        { reason, jobId: assemblyJobId },
      );

      // Auto-create rework if the complaint relates to assembly quality
      const reworkKeywords = ["montagem", "retrabalho", "incorreto", "errado", "defeito", "mal feita", "quebrado", "danificado"];
      if (reworkKeywords.some((kw) => reason.toLowerCase().includes(kw))) {
        try {
          const job = await queryOne<{ provider_id: string }>(
            "SELECT PROVIDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :id",
            { id: assemblyJobId },
          );
          if (job?.provider_id) {
            await execDml(
              `INSERT INTO MONT_ASSEMBLY_REWORKS
                 (ID, ASSEMBLY_JOB_ID, PROVIDER_ID, SAC_CASE_ID, REASON, DESCRIPTION, STATUS)
               VALUES (:id, :jobId, :providerId, :sacId, :reason, :description, 'PENDENTE')`,
              { id: uuid(), jobId: assemblyJobId, providerId: job.provider_id, sacId: id, reason, description },
            );
          }
        } catch {
          // Non-critical: rework creation failure does not block SAC
        }
      }
    }

    await this.events.emit({
      type: "SAC_CASO_ABERTO",
      orderId,
      numped: order.numped,
      codcli: order.codcli,
      assemblyId: assemblyJobId,
      origin: "SISTEMA",
      metadata: { description: `SAC aberto: ${reason}` },
      idempotencyKey: `sac:${order.numped}:${reason}:${Date.now()}`,
    });

    await this.audit.log({ action: "SAC_OPENED", entityType: "sac_case", entityId: id, next: { reason, description } });
    return { id };
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows(
        `SELECT s.ID, s.STATUS, s.REASON, s.DESCRIPTION, s.CREATED_AT, s.UPDATED_AT,
                s.RESPONSIBLE_USER_ID, s.NEXT_ACTION_DATE, s.SLA_DEADLINE,
                o.NUMPED, c.NAME AS CUSTOMER_NAME
         FROM MONT_SAC_CASES s
         JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
         JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
         ORDER BY s.CREATED_AT DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { offset, pageSize },
      ),
      queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_SAC_CASES"),
    ]);
    return { rows, total: Number(countRow?.total ?? 0), page, pageSize };
  }

  async getById(id: string) {
    // Scalar subqueries for review data — covers any service type and works when ASSEMBLY_JOB_ID is NULL
    const sacCase = await queryOne<{ numped: string | number | null; codcli: string | number | null; [key: string]: unknown }>(
      `SELECT s.*, o.NUMPED, o.TOTAL_AMOUNT, o.CODCLI, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
              COALESCE(
                (SELECT MIN(r.SCORE) FROM MONT_CUSTOMER_REVIEWS r WHERE r.ORDER_ID = s.ORDER_ID),
                er.SCORE
              ) AS REVIEW_SCORE,
              COALESCE(
                (SELECT r.CLASSIFICATION FROM MONT_CUSTOMER_REVIEWS r
                 WHERE r.ORDER_ID = s.ORDER_ID ORDER BY r.SCORE ASC FETCH FIRST 1 ROW ONLY),
                er.CLASSIFICATION
              ) AS REVIEW_CLASSIFICATION,
              COALESCE(
                (SELECT r.COMPLAINT_REASON FROM MONT_CUSTOMER_REVIEWS r
                 WHERE r.ORDER_ID = s.ORDER_ID AND r.COMPLAINT_REASON IS NOT NULL
                 ORDER BY r.SCORE ASC FETCH FIRST 1 ROW ONLY),
                er.EVAL_COMMENT
              ) AS REVIEW_COMPLAINT,
              er.PHASE AS EVAL_PHASE, er.ID AS EVAL_RESPONSE_ID
       FROM MONT_SAC_CASES s
       JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       LEFT JOIN MONT_EVAL_RESPONSES er ON er.SAC_CASE_ID = s.ID
       WHERE s.ID = :id`,
      { id },
    );
    if (!sacCase) throw new Error("Caso SAC não encontrado.");

    const [logs, evalAnswers, legacyReviews, orderItems, winthorOrder, winthorItems, winthorClient] = await Promise.all([
      queryRows(
        "SELECT * FROM MONT_SAC_CASE_LOGS WHERE SAC_CASE_ID = :id ORDER BY CREATED_AT ASC",
        { id },
      ),

      // Per-question answers (new eval system).
      // Primary: linked by SAC_CASE_ID. Fallback: most recent eval for same order.
      queryRows<{ label: string; type: string; position: number; value_text: string | null; value_number: number | null }>(
        `SELECT q.LABEL, q.TYPE, q.POSITION, a.VALUE_TEXT, a.VALUE_NUMBER
         FROM MONT_EVAL_ANSWERS a
         JOIN MONT_EVAL_QUESTIONS q ON q.ID = a.QUESTION_ID
         WHERE a.RESPONSE_ID = (
           SELECT COALESCE(
             (SELECT er.ID FROM MONT_EVAL_RESPONSES er
              WHERE er.SAC_CASE_ID = :id AND ROWNUM = 1),
             (SELECT er2.ID FROM MONT_EVAL_RESPONSES er2
              JOIN MONT_SAC_CASES sc ON sc.ORDER_ID = er2.ORDER_ID
              WHERE sc.ID = :id2
              ORDER BY er2.CREATED_AT DESC FETCH FIRST 1 ROW ONLY)
           ) FROM DUAL
         )
         ORDER BY q.POSITION`,
        { id, id2: id },
      ),

      // All reviews from the old system for this order (one per service phase)
      queryRows<{ service_type: string; score: number; classification: string; review_comment: string | null; complaint_reason: string | null; created_at: string }>(
        `SELECT r.SERVICE_TYPE, r.SCORE, r.CLASSIFICATION, r.REVIEW_COMMENT,
                r.COMPLAINT_REASON, r.CREATED_AT
         FROM MONT_CUSTOMER_REVIEWS r
         JOIN MONT_SAC_CASES s ON s.ORDER_ID = r.ORDER_ID
         WHERE s.ID = :id
         ORDER BY r.CREATED_AT ASC`,
        { id },
      ),

      // MONT_ORDER_ITEMS fallback (kept for cases not in WinThor)
      queryRows<{ description: string; quantity: number; requires_assembly: number; assembly_cost: number }>(
        `SELECT oi.DESCRIPTION, oi.QUANTITY, oi.REQUIRES_ASSEMBLY, oi.ASSEMBLY_COST
         FROM MONT_SAC_CASES s
         JOIN MONT_ORDER_ITEMS oi ON oi.ORDER_ID = s.ORDER_ID
         WHERE s.ID = :id
         ORDER BY oi.REQUIRES_ASSEMBLY DESC, oi.DESCRIPTION`,
        { id },
      ),

      // WinThor order header: data da venda, filial, RCA
      queryOne<{ data: Date; codfilial: number; codusur: number; nome_vendedor: string | null; vltotal: number }>(
        `SELECT p.DATA, p.CODFILIAL, p.CODUSUR, p.VLTOTAL,
                (SELECT u.NOME FROM PCUSUARI u WHERE u.CODUSUR = p.CODUSUR AND ROWNUM = 1) AS NOME_VENDEDOR
         FROM PCPEDC p
         WHERE TO_CHAR(p.NUMPED) = TO_CHAR(:numped)
         FETCH FIRST 1 ROW ONLY`,
        { numped: sacCase.numped },
      ).catch(() => null),

      // WinThor order items (real products from PCPEDI + PCPRODUT)
      queryRows<{ numseq: number; codprod: string; descricao: string | null; qt: number; pvenda: number; requer_montagem: number }>(
        `SELECT i.NUMSEQ, TO_CHAR(i.CODPROD) AS CODPROD, p.DESCRICAO, i.QT, i.PVENDA,
                CASE WHEN NVL(p.VLMAODEOBRA, 0) > 0 THEN 1 ELSE 0 END AS REQUER_MONTAGEM
         FROM PCPEDI i
         LEFT JOIN PCPRODUT p ON p.CODPROD = i.CODPROD
         WHERE TO_CHAR(i.NUMPED) = TO_CHAR(:numped)
           AND NVL(i.POSICAO, 'A') != 'C'
         ORDER BY i.NUMSEQ`,
        { numped: sacCase.numped },
      ).catch(() => []),

      // WinThor client phone (PCCLIENT.TELENT)
      queryOne<{ telent: string | null }>(
        `SELECT TELENT FROM PCCLIENT WHERE CODCLI = :codcli`,
        { codcli: sacCase.codcli },
      ).catch(() => null),
    ]);

    return { ...sacCase, logs, evalAnswers, legacyReviews, orderItems, winthorOrder, winthorItems, winthorClient };
  }

  async assign(id: string, userId: string | undefined) {
    const sacCase = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; status: string }>(
      `SELECT s.ID, s.STATUS, s.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_SAC_CASES s JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID WHERE s.ID = :id`,
      { id },
    );
    if (!sacCase) throw new Error("Caso SAC não encontrado.");
    await execDml(
      "UPDATE MONT_SAC_CASES SET RESPONSIBLE_USER_ID = :userId, STATUS = 'EM_ANALISE', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { userId: userId ?? null, id },
    );
    await execDml(
      "INSERT INTO MONT_SAC_CASE_LOGS (ID, SAC_CASE_ID, ACTION, NOTE, USER_ID) VALUES (:logId, :sacId, 'ATRIBUIDO', 'Caso assumido pelo atendente.', :userId)",
      { logId: uuid(), sacId: id, userId: userId ?? null },
    );
    await this.events.emit({
      type: "SAC_RESPONSAVEL_ATRIBUIDO",
      orderId: sacCase.order_id,
      numped: sacCase.numped,
      codcli: sacCase.codcli,
      origin: "SAC",
      metadata: { description: "Caso SAC atribuído a responsável." },
      idempotencyKey: `sac-atribuido:${id}:${userId}`,
    });
    await this.audit.log({ actorUserId: userId, action: "SAC_ASSIGNED", entityType: "sac_case", entityId: id });
    return { id, status: "EM_ANALISE" };
  }

  async addNote(id: string, note: string, userId: string | undefined) {
    const sacCase = await queryOne<{ id: string }>("SELECT ID FROM MONT_SAC_CASES WHERE ID = :id", { id });
    if (!sacCase) throw new Error("Caso SAC não encontrado.");
    await execDml(
      "INSERT INTO MONT_SAC_CASE_LOGS (ID, SAC_CASE_ID, ACTION, NOTE, USER_ID) VALUES (:logId, :sacId, 'TRATATIVA', :note, :userId)",
      { logId: uuid(), sacId: id, note, userId: userId ?? null },
    );
    await execDml("UPDATE MONT_SAC_CASES SET UPDATED_AT = SYSTIMESTAMP WHERE ID = :id", { id });
    return { id, logged: true };
  }

  async resolve(id: string, note: string, userId: string | undefined) {
    const sacCase = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; status: string }>(
      `SELECT s.ID, s.STATUS, s.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_SAC_CASES s JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID WHERE s.ID = :id`,
      { id },
    );
    if (!sacCase) throw new Error("Caso SAC não encontrado.");
    if (["RESOLVIDO", "ENCERRADO"].includes(sacCase.status)) throw new Error("Caso já encerrado.");
    await execDml(
      "UPDATE MONT_SAC_CASES SET STATUS = 'RESOLVIDO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_SAC_CASE_LOGS (ID, SAC_CASE_ID, ACTION, NOTE, USER_ID) VALUES (:logId, :sacId, 'RESOLVIDO', :note, :userId)",
      { logId: uuid(), sacId: id, note: note || "Caso resolvido.", userId: userId ?? null },
    );
    await this.events.emit({
      type: "SAC_ENCERROU_CASO",
      orderId: sacCase.order_id,
      numped: sacCase.numped,
      codcli: sacCase.codcli,
      origin: "SAC",
      metadata: { description: `SAC resolvido: ${note}` },
      idempotencyKey: `sac-resolvido:${id}`,
    });
    await this.audit.log({ actorUserId: userId, action: "SAC_RESOLVED", entityType: "sac_case", entityId: id, justification: note });
    return { id, status: "RESOLVIDO" };
  }

  async close(id: string, note: string, userId: string | undefined) {
    if (!note?.trim()) throw new Error("Justificativa obrigatória para encerrar o caso.");
    const sacCase = await queryOne<{ id: string; status: string }>(
      "SELECT ID, STATUS FROM MONT_SAC_CASES WHERE ID = :id",
      { id },
    );
    if (!sacCase) throw new Error("Caso SAC não encontrado.");
    await execDml(
      "UPDATE MONT_SAC_CASES SET STATUS = 'ENCERRADO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_SAC_CASE_LOGS (ID, SAC_CASE_ID, ACTION, NOTE, USER_ID) VALUES (:logId, :sacId, 'ENCERRADO', :note, :userId)",
      { logId: uuid(), sacId: id, note: note.trim(), userId: userId ?? null },
    );
    await this.audit.log({ actorUserId: userId, action: "SAC_CLOSED", entityType: "sac_case", entityId: id, justification: note });
    return { id, status: "ENCERRADO" };
  }
}
