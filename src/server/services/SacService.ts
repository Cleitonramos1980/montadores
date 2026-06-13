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
                 (ID, ASSEMBLY_JOB_ID, PROVIDER_ID, SAC_ID, REASON, DESCRIPTION, STATUS)
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

  async list() {
    return queryRows(
      `SELECT s.*, o.NUMPED, c.NAME AS CUSTOMER_NAME
       FROM MONT_SAC_CASES s
       JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       ORDER BY s.CREATED_AT DESC`,
    );
  }

  async getById(id: string) {
    const sacCase = await queryOne(
      `SELECT s.*, o.NUMPED, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
              r.SCORE AS REVIEW_SCORE, r.CLASSIFICATION AS REVIEW_CLASSIFICATION,
              r.COMPLAINT_REASON AS REVIEW_COMPLAINT
       FROM MONT_SAC_CASES s
       JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       LEFT JOIN MONT_CUSTOMER_REVIEWS r
         ON r.ASSEMBLY_JOB_ID = s.ASSEMBLY_JOB_ID AND r.SERVICE_TYPE = 'MONTAGEM'
       WHERE s.ID = :id`,
      { id },
    );
    if (!sacCase) throw new Error("Caso SAC não encontrado.");
    const logs = await queryRows(
      "SELECT * FROM MONT_SAC_CASE_LOGS WHERE SAC_CASE_ID = :id ORDER BY CREATED_AT ASC",
      { id },
    );
    return { ...sacCase, logs };
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
