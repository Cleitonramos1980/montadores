import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import type { EventType } from "../../shared/domain";
import { execDml, queryOne, queryRows } from "../db/db";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";
import { SacService } from "./SacService";

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
        description: "Pedido criado no WinThor",
        triggerLabel: "ATENDIMENTO AVALIAÇÃO ENVIADA",
        sent: sentByEvent("ATENDIMENTO_AVALIACAO_ENVIADA"),
        ...byType("ATENDIMENTO"),
      },
      {
        key: "ENTREGA",
        label: "Entrega",
        description: "Pedido entregue",
        triggerLabel: "ENTREGA REALIZADA",
        sent: sentByEvent("ENTREGA_REALIZADA"),
        ...byType("ENTREGA"),
      },
      {
        key: "MONTAGEM",
        label: "Montagem",
        description: "Montador executa serviço",
        triggerLabel: "LINK AVALIAÇÃO MONTAGEM ENVIADO",
        sent: sentByEvent("LINK_AVALIACAO_MONTAGEM_ENVIADO"),
        ...byType("MONTAGEM"),
      },
    ];

    return { summary, reviews, phases };
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
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");

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
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");

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

  async listAtendimentoPendentes(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows(
        `SELECT o.NUMPED, o.CODCLI, o.CURRENT_STATUS, o.UPDATED_AT
         FROM MONT_ORDERS o
         WHERE NOT EXISTS (
           SELECT 1 FROM MONT_CUSTOMER_REVIEWS r
           WHERE r.ORDER_ID = o.ID AND r.SERVICE_TYPE = 'ATENDIMENTO'
         ) AND o.CURRENT_STATUS IN ('ENTREGUE','CONCLUIDO','AVALIADO')
         ORDER BY o.UPDATED_AT DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { offset, pageSize },
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS TOTAL FROM MONT_ORDERS o
         WHERE NOT EXISTS (
           SELECT 1 FROM MONT_CUSTOMER_REVIEWS r
           WHERE r.ORDER_ID = o.ID AND r.SERVICE_TYPE = 'ATENDIMENTO'
         ) AND o.CURRENT_STATUS IN ('ENTREGUE','CONCLUIDO','AVALIADO')`,
      ),
    ]);
    return { rows, total: Number(countRow?.total ?? 0), page, pageSize };
  }

  async marcarAtendimentoEnviado(numped: string) {
    const order = await queryOne<{ id: string; codcli: string }>(
      "SELECT ID, CODCLI FROM MONT_ORDERS WHERE NUMPED = :numped",
      { numped },
    );
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");
    await this.events.emit({
      type: "ATENDIMENTO_AVALIACAO_ENVIADA",
      orderId: order.id,
      numped,
      codcli: order.codcli,
      origin: "SISTEMA",
      idempotencyKey: `atendimento-avaliacao-enviada:${numped}`,
    });
    return { numped, ok: true };
  }
}
