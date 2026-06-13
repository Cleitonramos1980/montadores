import { v4 as uuid } from "uuid";
import type { EventType } from "../../shared/domain";
import { execDml, queryOne, queryRows } from "../db/db";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";
import { SacService } from "./SacService";

export type AtendimentoPendente = {
  numped: string;
  data: Date | null;
  vltotal: number;
  codcli: string;
  cliente: string;
  telent: string | null;
  codusur: string | null;
  nome_vendedor: string | null;
  enviada: number;
};

export class ReviewService {
  constructor(
    private readonly events = new EventService(),
    private readonly sac = new SacService(),
    private readonly audit = new AuditService(),
  ) {}

  async list() {
    const [reviews, summary, phaseStats, sentCounts] = await Promise.all([
      queryRows(
        `SELECT r.*, o.NUMPED, c.NAME AS CUSTOMER_NAME, p.NAME AS PROVIDER_NAME
         FROM MONT_CUSTOMER_REVIEWS r
         JOIN MONT_ORDERS o ON o.ID = r.ORDER_ID
         JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
         LEFT JOIN MONT_ASSEMBLY_JOBS a ON a.ID = r.ASSEMBLY_JOB_ID
         LEFT JOIN MONT_PROVIDERS p ON p.ID = a.PROVIDER_ID
         ORDER BY r.CREATED_AT DESC`,
      ),
      queryOne<{ total: number; positive: number; neutral: number; negative: number; averageScore: number }>(
        `SELECT
           COUNT(*) AS TOTAL,
           SUM(CASE WHEN CLASSIFICATION = 'POSITIVA' THEN 1 ELSE 0 END) AS POSITIVE,
           SUM(CASE WHEN CLASSIFICATION = 'NEUTRA' THEN 1 ELSE 0 END) AS NEUTRAL,
           SUM(CASE WHEN CLASSIFICATION = 'NEGATIVA' THEN 1 ELSE 0 END) AS NEGATIVE,
           ROUND(AVG(SCORE), 2) AS "averageScore"
         FROM MONT_CUSTOMER_REVIEWS`,
      ),
      queryRows(
        `SELECT SERVICE_TYPE,
                COUNT(*) AS RECEIVED,
                ROUND(AVG(SCORE), 2) AS AVG_SCORE,
                SUM(CASE WHEN CLASSIFICATION = 'POSITIVA' THEN 1 ELSE 0 END) AS POSITIVE,
                SUM(CASE WHEN CLASSIFICATION = 'NEUTRA' THEN 1 ELSE 0 END) AS NEUTRAL,
                SUM(CASE WHEN CLASSIFICATION = 'NEGATIVA' THEN 1 ELSE 0 END) AS NEGATIVE
         FROM MONT_CUSTOMER_REVIEWS
         GROUP BY SERVICE_TYPE`,
      ),
      queryRows(
        `SELECT TYPE AS EVENT_TYPE, COUNT(DISTINCT NUMPED) AS TOTAL
         FROM MONT_ORDER_EVENTS
         WHERE TYPE IN ('ATENDIMENTO_AVALIACAO_ENVIADA', 'ENTREGA_REALIZADA', 'LINK_AVALIACAO_MONTAGEM_ENVIADO')
         GROUP BY TYPE`,
      ),
    ]);

    // WinThor: count faturados (POSICAO='F', CONDVENDA='7') and pendentes (not yet reviewed)
    let atendimentoFaturados = 0;
    let atendimentoPendentes = 0;
    try {
      const wt = await queryOne<{ faturados: number; pendentes: number }>(
        `SELECT
           (SELECT COUNT(*) FROM PCPEDC WHERE POSICAO = 'F' AND CONDVENDA = '7') AS FATURADOS,
           (SELECT COUNT(*) FROM PCPEDC p2
              WHERE p2.POSICAO = 'F'
                AND p2.CONDVENDA = '7'
                AND NOT EXISTS (
                  SELECT 1 FROM MONT_ORDERS mo
                  JOIN MONT_CUSTOMER_REVIEWS r2 ON r2.ORDER_ID = mo.ID AND r2.SERVICE_TYPE = 'ATENDIMENTO'
                  WHERE mo.NUMPED = TO_CHAR(p2.NUMPED)
                )
           ) AS PENDENTES
         FROM DUAL`,
      );
      atendimentoFaturados = Number(wt?.faturados ?? 0);
      atendimentoPendentes = Number(wt?.pendentes ?? 0);
    } catch {
      // WinThor unavailable — leave as 0
    }

    const byType = (type: string) => {
      const row = phaseStats.find((r: any) => r.service_type === type) as any;
      return {
        received: Number(row?.received ?? 0),
        avgScore: Number(row?.avg_score ?? 0),
        positive: Number(row?.positive ?? 0),
        neutral:  Number(row?.neutral  ?? 0),
        negative: Number(row?.negative ?? 0),
      };
    };
    const sentByEvent = (evt: string) =>
      Number((sentCounts.find((r: any) => r.event_type === evt) as any)?.total ?? 0);

    const phases = [
      {
        key: "ATENDIMENTO",
        label: "Atendimento",
        description: "Pedido faturado no WinThor (CONDVENDA=7)",
        triggerLabel: "POSICAO=F · CONDVENDA=7",
        sent: sentByEvent("ATENDIMENTO_AVALIACAO_ENVIADA"),
        faturados: atendimentoFaturados,
        pendentes: atendimentoPendentes,
        ...byType("ATENDIMENTO"),
      },
      {
        key: "ENTREGA",
        label: "Entrega",
        description: "Pedido entregue",
        triggerLabel: "ENTREGA REALIZADA",
        sent: sentByEvent("ENTREGA_REALIZADA"),
        faturados: 0,
        pendentes: 0,
        ...byType("ENTREGA"),
      },
      {
        key: "MONTAGEM",
        label: "Montagem",
        description: "Montador executa serviço",
        triggerLabel: "LINK AVALIAÇÃO MONTAGEM ENVIADO",
        sent: sentByEvent("LINK_AVALIACAO_MONTAGEM_ENVIADO"),
        faturados: 0,
        pendentes: 0,
        ...byType("MONTAGEM"),
      },
    ];

    return { summary, reviews, phases };
  }

  async listAtendimentoPendentes(page = 1, pageSize = 20): Promise<{ rows: AtendimentoPendente[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows<AtendimentoPendente>(
        `SELECT p.NUMPED, p.DATA, p.VLTOTAL, p.CODCLI,
                c.CLIENTE, c.TELENT,
                p.CODUSUR,
                u.NOME AS NOME_VENDEDOR,
                CASE WHEN ev.NUMPED IS NOT NULL THEN 1 ELSE 0 END AS ENVIADA
         FROM PCPEDC p
         JOIN PCCLIENT c ON c.CODCLI = p.CODCLI
         LEFT JOIN PCUSUARI u ON u.CODUSUR = p.CODUSUR AND c.CODUSUR1 = p.CODUSUR
         LEFT JOIN (
           SELECT NUMPED FROM MONT_ORDER_EVENTS
           WHERE TYPE = 'ATENDIMENTO_AVALIACAO_ENVIADA'
           GROUP BY NUMPED
         ) ev ON ev.NUMPED = TO_CHAR(p.NUMPED)
         WHERE p.POSICAO = 'F'
           AND p.CONDVENDA = '7'
           AND NOT EXISTS (
             SELECT 1 FROM MONT_ORDERS mo
             JOIN MONT_CUSTOMER_REVIEWS r ON r.ORDER_ID = mo.ID AND r.SERVICE_TYPE = 'ATENDIMENTO'
             WHERE mo.NUMPED = TO_CHAR(p.NUMPED)
           )
         ORDER BY p.DATA DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { offset, pageSize },
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS TOTAL
         FROM PCPEDC p
         WHERE p.POSICAO = 'F'
           AND p.CONDVENDA = '7'
           AND NOT EXISTS (
             SELECT 1 FROM MONT_ORDERS mo
             JOIN MONT_CUSTOMER_REVIEWS r ON r.ORDER_ID = mo.ID AND r.SERVICE_TYPE = 'ATENDIMENTO'
             WHERE mo.NUMPED = TO_CHAR(p.NUMPED)
           )`,
      ),
    ]);
    return { rows, total: Number(countRow?.total ?? 0) };
  }

  async marcarAtendimentoEnviado(numped: string) {
    // Look up order in WinThor
    const wtRows = await queryRows<{ numped: string; codcli: string; vltotal: number; data: Date; cliente: string; telent: string; nome: string; codusur: string }>(
      `SELECT p.NUMPED, p.CODCLI, p.VLTOTAL, p.DATA,
              c.CLIENTE, c.TELENT, p.CODUSUR,
              NVL(u.NOME, '') AS NOME
       FROM PCPEDC p
       JOIN PCCLIENT c ON c.CODCLI = p.CODCLI
       LEFT JOIN PCUSUARI u ON u.CODUSUR = p.CODUSUR
       WHERE p.NUMPED = :numped`,
      { numped },
    );
    if (wtRows.length === 0) throw new Error(`Pedido ${numped} não encontrado no WinThor.`);
    const wt = wtRows[0];

    // Find or create MONT_CUSTOMERS
    let customerId: string;
    const existingCustomer = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_CUSTOMERS WHERE CODCLI = :codcli",
      { codcli: wt.codcli },
    );
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      customerId = uuid();
      await execDml(
        `INSERT INTO MONT_CUSTOMERS (ID, CODCLI, NAME, PHONE, EMAIL, ADDRESS_JSON)
         VALUES (:id, :codcli, :name, :phone, :email, '{}')`,
        { id: customerId, codcli: wt.codcli, name: wt.cliente, phone: wt.telent ?? null, email: null },
      );
    }

    // Find or create MONT_ORDERS
    let orderId: string;
    const existingOrder = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
      { numped },
    );
    if (existingOrder) {
      orderId = existingOrder.id;
    } else {
      orderId = uuid();
      await execDml(
        `INSERT INTO MONT_ORDERS (ID, NUMPED, CODCLI, CUSTOMER_ID, SELLER, TOTAL_AMOUNT, CURRENT_STATUS, HAS_ASSEMBLY, ORACLE_PAYLOAD_JSON)
         VALUES (:id, :numped, :codcli, :customerId, :seller, :totalAmount, 'FATURADO', 0, '{}')`,
        { id: orderId, numped, codcli: wt.codcli, customerId, seller: wt.nome || null, totalAmount: wt.vltotal ?? 0 },
      );
    }

    await this.events.emit({
      type: "ATENDIMENTO_AVALIACAO_ENVIADA",
      orderId,
      numped,
      codcli: wt.codcli,
      origin: "SISTEMA",
      metadata: { description: "Solicitação de avaliação de atendimento marcada como enviada." },
      idempotencyKey: `atendimento-enviado:${numped}`,
    });

    await this.audit.log({
      action: "ATENDIMENTO_AVALIACAO_ENVIADA",
      entityType: "order",
      entityId: orderId,
      next: { numped },
    });

    return { orderId, numped };
  }

  async reviewAtendimento(orderId: string, score: number, comment?: string, complaintReason?: string) {
    return this._submitPhaseReview(orderId, null, "ATENDIMENTO", "ATENDIMENTO_AVALIADO", score, comment, complaintReason);
  }

  async reviewEntrega(orderId: string, score: number, comment?: string, complaintReason?: string) {
    return this._submitPhaseReview(orderId, null, "ENTREGA", "ENTREGA_AVALIADA", score, comment, complaintReason);
  }

  private async _submitPhaseReview(
    orderId: string,
    assemblyJobId: string | null,
    serviceType: string,
    eventType: EventType,
    score: number,
    comment?: string,
    complaintReason?: string,
  ) {
    const order = await queryOne<{ id: string; numped: string; codcli: string }>(
      "SELECT ID, NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
      { id: orderId },
    );
    if (!order) throw new Error("Pedido não encontrado.");

    const existing = await queryOne(
      "SELECT ID FROM MONT_CUSTOMER_REVIEWS WHERE ORDER_ID = :orderId AND SERVICE_TYPE = :serviceType",
      { orderId, serviceType },
    );
    if (existing) throw new Error(`Este pedido já possui avaliação de ${serviceType.toLowerCase()}.`);

    const classification = score <= 6 ? "NEGATIVA" : score <= 8 ? "NEUTRA" : "POSITIVA";
    const id = uuid();

    await execDml(
      `INSERT INTO MONT_CUSTOMER_REVIEWS
       (ID, ORDER_ID, ASSEMBLY_JOB_ID, SERVICE_TYPE, SCORE, CLASSIFICATION, REVIEW_COMMENT, COMPLAINT_REASON)
       VALUES (:id, :orderId, :jobId, :serviceType, :score, :classification, :reviewComment, :complaintReason)`,
      {
        id, orderId,
        jobId: assemblyJobId,
        serviceType, score, classification,
        reviewComment: comment ?? null,
        complaintReason: complaintReason ?? null,
      },
    );

    await this.events.emit({
      type: eventType,
      orderId,
      numped: order.numped,
      codcli: order.codcli,
      origin: "CLIENTE",
      metadata: {
        description: `Avaliação de ${serviceType.toLowerCase()} recebida com nota ${score}.`,
        score,
        classification,
      },
      idempotencyKey: `avaliacao-${serviceType.toLowerCase()}:${order.numped}`,
    });

    await this.audit.log({
      action: "REVIEW_SUBMITTED",
      entityType: "review",
      entityId: id,
      next: { serviceType, score, classification, complaintReason: complaintReason ?? null },
    });

    if (score <= 6 || !!complaintReason) {
      await this.sac.open(
        orderId,
        complaintReason || `Avaliação ${classification} (nota ${score}) — ${serviceType}`,
        comment || "Avaliação exige análise.",
        assemblyJobId ?? undefined,
      );
    }

    return { id, classification };
  }

  async reviewAssembly(
    orderId: string,
    assemblyJobId: string,
    score: number,
    comment?: string,
    complaintReason?: string,
  ) {
    const order = await queryOne<{ id: string; numped: string; codcli: string }>(
      "SELECT ID, NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
      { id: orderId },
    );
    if (!order) throw new Error("Pedido não encontrado.");

    const existing = await queryOne(
      "SELECT ID FROM MONT_CUSTOMER_REVIEWS WHERE ORDER_ID = :orderId AND SERVICE_TYPE = 'MONTAGEM'",
      { orderId },
    );
    if (existing) throw new Error("Este pedido já possui avaliação de montagem.");

    const classification = score <= 6 ? "NEGATIVA" : score <= 8 ? "NEUTRA" : "POSITIVA";
    const id = uuid();

    await execDml(
      `INSERT INTO MONT_CUSTOMER_REVIEWS
       (ID, ORDER_ID, ASSEMBLY_JOB_ID, SERVICE_TYPE, SCORE, CLASSIFICATION, REVIEW_COMMENT, COMPLAINT_REASON)
       VALUES (:id, :orderId, :jobId, 'MONTAGEM', :score, :classification, :reviewComment, :complaintReason)`,
      {
        id,
        orderId,
        jobId: assemblyJobId,
        score,
        classification,
        reviewComment: comment ?? null,
        complaintReason: complaintReason ?? null,
      },
    );

    await this.events.emit({
      type: "AVALIACAO_CLIENTE_RECEBIDA",
      orderId,
      numped: order.numped,
      codcli: order.codcli,
      assemblyId: assemblyJobId,
      origin: "CLIENTE",
      metadata: { description: `Cliente avaliou montagem com nota ${score}.`, score, classification },
      idempotencyKey: `avaliacao-montagem:${order.numped}`,
    });

    await this.audit.log({
      action: "REVIEW_SUBMITTED",
      entityType: "review",
      entityId: id,
      next: { score, classification, complaintReason: complaintReason ?? null },
    });

    // Open SAC only for scores <= 6 or when customer explicitly provided a complaint reason
    const needsSac = score <= 6 || !!complaintReason;

    if (!needsSac) {
      await execDml(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'LIBERADO', UPDATED_AT = SYSTIMESTAMP WHERE ASSEMBLY_JOB_ID = :jobId",
        { jobId: assemblyJobId },
      );
      await execDml(
        "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'AVALIADO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: orderId },
      );
      await this.events.emit({
        type: "PAGAMENTO_LIBERADO",
        orderId,
        numped: order.numped,
        codcli: order.codcli,
        assemblyId: assemblyJobId,
        origin: "SISTEMA",
        metadata: { description: "Avaliação positiva liberou pagamento automaticamente." },
        idempotencyKey: `pagamento-auto:${assemblyJobId}`,
      });
      return { id, classification, payment: "LIBERADO" };
    }

    await execDml(
      "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'SAC_ABERTO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: orderId },
    );

    await this.sac.open(
      orderId,
      complaintReason || `Avaliação ${classification} (nota ${score})`,
      comment || "Avaliação exige análise.",
      assemblyJobId,
    );
    return { id, classification, payment: "BLOQUEADO" };
  }
}
