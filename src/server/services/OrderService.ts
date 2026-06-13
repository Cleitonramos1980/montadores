import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { json, parseJson } from "../db/database";
import { EventService } from "./EventService";
import { TokenService } from "./TokenService";

export class OrderService {
  constructor(
    private readonly events = new EventService(),
    private readonly tokens = new TokenService(),
  ) {}

  async createDemoOrder() {
    const customerId = uuid();
    const orderId = uuid();
    const suffix = String(Date.now()).slice(-6);
    const codcli = `10${suffix}`;
    const numped = String(Math.floor(Date.now() / 1000));

    await execDml(
      `INSERT INTO MONT_CUSTOMERS (ID, CODCLI, NAME, PHONE, DOCUMENT, EMAIL, ADDRESS_JSON)
       VALUES (:id, :codcli, :name, :phone, :document, :email, :address)`,
      {
        id: customerId,
        codcli,
        name: `Cliente Exemplo ${suffix}`,
        phone: "11999990000",
        document: "00000000000",
        email: `cliente.${suffix}@example.com`,
        address: json({ street: "Rua das Montagens, 100", city: "São Paulo", uf: "SP" }),
      },
    );

    await execDml(
      `INSERT INTO MONT_ORDERS
       (ID, NUMPED, CODCLI, CUSTOMER_ID, BRANCH, SELLER, CITY, UF, TOTAL_AMOUNT, CURRENT_STATUS, HAS_ASSEMBLY)
       VALUES (:id, :numped, :codcli, :customerId, '01', 'VENDEDOR LARA', 'São Paulo', 'SP', 1890, 'PEDIDO_CRIADO', 1)`,
      { id: orderId, numped, codcli, customerId },
    );

    await execDml(
      `INSERT INTO MONT_ORDER_ITEMS (ID, ORDER_ID, PRODUCT_ID, DESCRIPTION, QUANTITY, REQUIRES_ASSEMBLY, ASSEMBLY_COST)
       VALUES (:id, :orderId, 'MOVEL-001', 'Guarda-roupa casal', 1, 1, 120)`,
      { id: uuid(), orderId },
    );

    await this.events.emit({
      type: "PEDIDO_CRIADO",
      orderId,
      numped,
      codcli,
      origin: "SISTEMA",
      metadata: { description: "Pedido de demonstração criado para validar a jornada." },
      idempotencyKey: `pedido-criado:${numped}`,
    });
    await this.events.emit({
      type: "MONTAGEM_NECESSARIA",
      orderId,
      numped,
      codcli,
      origin: "SISTEMA",
      metadata: { description: "Itens do pedido exigem montagem." },
      idempotencyKey: `montagem-necessaria:${numped}`,
    });

    const token = await this.tokens.create(orderId, "JORNADA_CLIENTE");
    return { orderId, numped, token };
  }

  async list(filters: Record<string, string | undefined>) {
    const limit = Math.min(Number(filters.limit ?? 100), 500);
    const offset = Number(filters.offset ?? 0);

    return queryRows(
      `SELECT o.*, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE (:status IS NULL OR o.CURRENT_STATUS = :status)
       ORDER BY o.CREATED_AT DESC
       OFFSET :offset ROWS FETCH FIRST :limit ROWS ONLY`,
      { status: filters.status ?? null, limit, offset },
    );
  }

  async detail(id: string) {
    const order = await queryOne<Record<string, unknown>>(
      `SELECT o.*, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
              c.EMAIL AS CUSTOMER_EMAIL, c.ADDRESS_JSON
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE o.ID = :id OR o.NUMPED = :id`,
      { id },
    );
    if (!order) throw new Error("Pedido não encontrado.");
    const orderId = String(order.id);

    const [items, timeline, reviews, sacCases, payments, audit] = await Promise.all([
      queryRows("SELECT * FROM MONT_ORDER_ITEMS WHERE ORDER_ID = :id", { id: orderId }),
      queryRows("SELECT * FROM MONT_ORDER_TIMELINE WHERE ORDER_ID = :id ORDER BY CREATED_AT ASC", { id: orderId }),
      queryRows("SELECT * FROM MONT_CUSTOMER_REVIEWS WHERE ORDER_ID = :id ORDER BY CREATED_AT DESC", { id: orderId }),
      queryRows("SELECT * FROM MONT_SAC_CASES WHERE ORDER_ID = :id ORDER BY CREATED_AT DESC", { id: orderId }),
      queryRows(
        `SELECT p.* FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         WHERE a.ORDER_ID = :id`,
        { id: orderId },
      ),
      queryRows(
        `SELECT * FROM MONT_AUDIT_LOGS
         WHERE ENTITY_ID = :id OR ENTITY_TYPE = 'order_event'
         ORDER BY CREATED_AT DESC FETCH FIRST 50 ROWS ONLY`,
        { id: orderId },
      ),
    ]);

    return {
      ...order,
      address: parseJson(order.address_json, {}),
      items,
      timeline,
      reviews,
      sacCases,
      payments,
      audit,
    };
  }

  async dashboard() {
    const metric = async (sql: string, binds: Record<string, unknown> = {}) => {
      const row = await queryOne<{ value: number }>(sql, binds);
      return Number(row?.value ?? 0);
    };

    const [
      monitored, createdToday, withAssembly,
      awaitingSchedule, scheduled, inExecution, finished, awaitingReview,
      sacOpen, sacResolved,
      blocked, released, programmed, paid,
      failures,
    ] = await Promise.all([
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS WHERE TRUNC(CREATED_AT) = TRUNC(SYSDATE)"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS WHERE HAS_ASSEMBLY = 1"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'AGUARDANDO_AGENDAMENTO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_SCHEDULES WHERE STATUS = 'AGENDADA'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'EM_EXECUCAO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'FINALIZADA'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES WHERE STATUS IN ('ABERTO','EM_ANALISE')"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES WHERE STATUS IN ('RESOLVIDO','ENCERRADO')"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'BLOQUEADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'LIBERADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PROGRAMADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PAGO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL"),
    ]);

    // Executive KPIs — independent queries, each fails gracefully
    const safeMetric = async (sql: string, binds: Record<string, unknown> = {}) => {
      try { return Number((await queryOne<{ value: number }>(sql, binds))?.value ?? 0); }
      catch { return null; }
    };
    const safeRows = async <T>(sql: string, binds: Record<string, unknown> = {}): Promise<T[]> => {
      try { return await queryRows<T>(sql, binds); }
      catch { return []; }
    };

    const [
      avgScore, avgCommissionPaid, totalSacCases, byFilial, pipeline30d, winthorInTransit,
      leadDeliveryToScheduleHours, leadScheduleToFinishHours, selfSchedulePct, noHumanContactPct,
      noShowPct, reworkPct, reworkCost, blockedByReason, sacAtRisk, safePayments,
      branchDelayRanking, productIssueRanking, invitationConversion, avgPendingAgeDays,
      providerPerformance,
    ] = await Promise.all([
      safeMetric("SELECT ROUND(AVG(SCORE), 1) AS VALUE FROM MONT_CUSTOMER_REVIEWS WHERE SERVICE_TYPE = 'MONTAGEM'"),
      safeMetric("SELECT ROUND(AVG(AMOUNT), 2) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PAGO'"),
      safeMetric("SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES"),
      safeRows<{ codfilial: string; total_jobs: number; finished: number; avg_score: number | null; total_paid: number }>(
        `SELECT NVL(o.BRANCH, '?') AS CODFILIAL,
                COUNT(DISTINCT a.ID) AS TOTAL_JOBS,
                COUNT(DISTINCT CASE WHEN a.STATUS = 'FINALIZADA' THEN a.ID END) AS FINISHED,
                ROUND(AVG(r.SCORE), 1) AS AVG_SCORE,
                NVL(SUM(CASE WHEN p.STATUS = 'PAGO' THEN p.AMOUNT ELSE 0 END), 0) AS TOTAL_PAID
         FROM MONT_ORDERS o
         LEFT JOIN MONT_ASSEMBLY_JOBS a ON a.ORDER_ID = o.ID
         LEFT JOIN MONT_CUSTOMER_REVIEWS r ON r.ORDER_ID = o.ID AND r.SERVICE_TYPE = 'MONTAGEM'
         LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
         WHERE o.HAS_ASSEMBLY = 1
         GROUP BY o.BRANCH
         ORDER BY COUNT(DISTINCT a.ID) DESC
         FETCH FIRST 15 ROWS ONLY`,
      ),
      safeRows<{ status: string; cnt: number }>(
        `SELECT CURRENT_STATUS AS STATUS, COUNT(*) AS CNT
         FROM MONT_ORDERS
         WHERE HAS_ASSEMBLY = 1
           AND CREATED_AT >= SYSDATE - 30
           AND CURRENT_STATUS NOT IN ('CONCLUIDO','CANCELADO','AVALIACAO_CONCLUIDA')
         GROUP BY CURRENT_STATUS
         ORDER BY CNT DESC`,
      ),
      safeRows<{ codfilial: string; cnt: number }>(
        `SELECT p.CODFILIAL, COUNT(*) AS CNT
         FROM PCCARREG c
         JOIN PCPEDC p ON p.NUMCAR = c.NUMCAR
         WHERE c.DTFECHA IS NULL
         GROUP BY p.CODFILIAL
         ORDER BY CNT DESC
         FETCH FIRST 20 ROWS ONLY`,
      ),
      safeMetric(
        `SELECT ROUND(AVG((CAST(DATA_MONTAGEM_AGENDADA AS DATE) - CAST(DATA_ENTREGA_CONFIRMADA AS DATE)) * 24), 1) AS VALUE
         FROM MONT_AGENDA_CANDIDATOS
         WHERE DATA_ENTREGA_CONFIRMADA IS NOT NULL
           AND DATA_MONTAGEM_AGENDADA IS NOT NULL
           AND DATA_MONTAGEM_AGENDADA >= DATA_ENTREGA_CONFIRMADA`,
      ),
      safeMetric(
        `SELECT ROUND(AVG((CAST(a.FINISHED_AT AS DATE) - TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD')) * 24), 1) AS VALUE
         FROM MONT_ASSEMBLY_JOBS a
         JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
         WHERE a.FINISHED_AT IS NOT NULL
           AND s.SCHEDULED_DATE IS NOT NULL`,
      ),
      safeMetric(
        `SELECT ROUND(
           100 * SUM(CASE WHEN ORIGIN = 'CLIENTE' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1
         ) AS VALUE
         FROM MONT_ORDER_EVENTS
         WHERE TYPE = 'MONTAGEM_AGENDADA'`,
      ),
      safeMetric(
        `SELECT ROUND(100 * SUM(CASE
           WHEN EXISTS (
             SELECT 1 FROM MONT_ORDER_EVENTS e
             WHERE e.NUMPED = o.NUMPED AND e.TYPE = 'MONTAGEM_AGENDADA' AND e.ORIGIN = 'CLIENTE'
           )
           AND NOT EXISTS (
             SELECT 1 FROM MONT_SAC_CASES s WHERE s.ORDER_ID = o.ID
           )
           THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS VALUE
         FROM MONT_ORDERS o
         JOIN MONT_ASSEMBLY_JOBS a ON a.ORDER_ID = o.ID
         WHERE a.STATUS = 'FINALIZADA'`,
      ),
      safeMetric(
        `SELECT ROUND(100 * SUM(CASE WHEN a.STATUS = 'AGENDADA' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS VALUE
         FROM MONT_ASSEMBLY_JOBS a
         JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
         WHERE TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD') < TRUNC(SYSDATE)`,
      ),
      safeMetric(
        `SELECT ROUND(100 * (SELECT COUNT(*) FROM MONT_ASSEMBLY_REWORKS) / NULLIF(COUNT(*), 0), 1) AS VALUE
         FROM MONT_ASSEMBLY_JOBS
         WHERE STATUS = 'FINALIZADA'`,
      ),
      safeMetric(
        `SELECT NVL(SUM(p.AMOUNT), 0) AS VALUE
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN (
           SELECT DISTINCT ASSEMBLY_JOB_ID FROM MONT_ASSEMBLY_REWORKS
         ) r ON r.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
         WHERE p.STATUS != 'CANCELADO'`,
      ),
      safeRows<{ reason: string; cnt: number; amount: number }>(
        `SELECT NVL(BLOCKED_REASON, 'Sem motivo informado') AS REASON,
                COUNT(*) AS CNT,
                NVL(SUM(AMOUNT), 0) AS AMOUNT
         FROM MONT_PROVIDER_PAYMENTS
         WHERE STATUS = 'BLOQUEADO'
         GROUP BY NVL(BLOCKED_REASON, 'Sem motivo informado')
         ORDER BY COUNT(*) DESC
         FETCH FIRST 8 ROWS ONLY`,
      ),
      safeRows<{ id: string; numped: string; reason: string; status: string; sla_deadline: string | null; impact_amount: number }>(
        `SELECT s.ID, o.NUMPED, s.REASON, s.STATUS, s.SLA_DEADLINE,
                NVL(SUM(p.AMOUNT), 0) AS IMPACT_AMOUNT
         FROM MONT_SAC_CASES s
         JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
         LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = s.ASSEMBLY_JOB_ID AND p.STATUS != 'CANCELADO'
         WHERE s.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
           AND (s.SLA_DEADLINE IS NULL OR s.SLA_DEADLINE <= SYSTIMESTAMP + INTERVAL '1' DAY)
         GROUP BY s.ID, o.NUMPED, s.REASON, s.STATUS, s.SLA_DEADLINE
         ORDER BY s.SLA_DEADLINE NULLS FIRST, IMPACT_AMOUNT DESC
         FETCH FIRST 8 ROWS ONLY`,
      ),
      safeRows<{ status: string; cnt: number; amount: number }>(
        `SELECT CASE
                  WHEN p.STATUS IN ('LIBERADO','PROGRAMADO')
                   AND p.INVOICE_URL IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM MONT_SAC_CASES s
                     WHERE s.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
                       AND s.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
                   )
                  THEN 'PODE_PAGAR'
                  WHEN p.STATUS IN ('LIBERADO','PROGRAMADO') AND p.INVOICE_URL IS NULL
                  THEN 'FALTA_NOTA'
                  WHEN EXISTS (
                     SELECT 1 FROM MONT_SAC_CASES s
                     WHERE s.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
                       AND s.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
                   )
                  THEN 'SAC_ABERTO'
                  ELSE p.STATUS
                END AS STATUS,
                COUNT(*) AS CNT,
                NVL(SUM(p.AMOUNT), 0) AS AMOUNT
         FROM MONT_PROVIDER_PAYMENTS p
         WHERE p.STATUS IN ('LIBERADO','PROGRAMADO','BLOQUEADO','AGUARDANDO_AVALIACAO_CLIENTE')
         GROUP BY CASE
                  WHEN p.STATUS IN ('LIBERADO','PROGRAMADO')
                   AND p.INVOICE_URL IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM MONT_SAC_CASES s
                     WHERE s.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
                       AND s.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
                   )
                  THEN 'PODE_PAGAR'
                  WHEN p.STATUS IN ('LIBERADO','PROGRAMADO') AND p.INVOICE_URL IS NULL
                  THEN 'FALTA_NOTA'
                  WHEN EXISTS (
                     SELECT 1 FROM MONT_SAC_CASES s
                     WHERE s.ASSEMBLY_JOB_ID = p.ASSEMBLY_JOB_ID
                       AND s.STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
                   )
                  THEN 'SAC_ABERTO'
                  ELSE p.STATUS
                END
         ORDER BY AMOUNT DESC`,
      ),
      safeRows<{ codfilial: string; delayed_jobs: number; avg_delay_days: number }>(
        `SELECT NVL(o.BRANCH, '?') AS CODFILIAL,
                COUNT(*) AS DELAYED_JOBS,
                ROUND(AVG(TRUNC(SYSDATE) - TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD')), 1) AS AVG_DELAY_DAYS
         FROM MONT_ASSEMBLY_JOBS a
         JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
         WHERE a.STATUS NOT IN ('FINALIZADA','CANCELADA')
           AND TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD') < TRUNC(SYSDATE)
         GROUP BY o.BRANCH
         ORDER BY DELAYED_JOBS DESC, AVG_DELAY_DAYS DESC
         FETCH FIRST 8 ROWS ONLY`,
      ),
      safeRows<{ product_id: string; description: string; total_orders: number; sac_cases: number; reworks: number }>(
        `SELECT i.PRODUCT_ID,
                MAX(i.DESCRIPTION) AS DESCRIPTION,
                COUNT(DISTINCT i.ORDER_ID) AS TOTAL_ORDERS,
                COUNT(DISTINCT s.ID) AS SAC_CASES,
                COUNT(DISTINCT r.ID) AS REWORKS
         FROM MONT_ORDER_ITEMS i
         LEFT JOIN MONT_SAC_CASES s ON s.ORDER_ID = i.ORDER_ID
         LEFT JOIN MONT_ASSEMBLY_JOBS a ON a.ORDER_ID = i.ORDER_ID
         LEFT JOIN MONT_ASSEMBLY_REWORKS r ON r.ASSEMBLY_JOB_ID = a.ID
         WHERE i.REQUIRES_ASSEMBLY = 1
         GROUP BY i.PRODUCT_ID
         HAVING COUNT(DISTINCT s.ID) > 0 OR COUNT(DISTINCT r.ID) > 0
         ORDER BY COUNT(DISTINCT s.ID) DESC, COUNT(DISTINCT r.ID) DESC
         FETCH FIRST 8 ROWS ONLY`,
      ),
      safeMetric(
        `SELECT ROUND(100 * SUM(CASE WHEN MONTAGEM_AGENDADA = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN CONVITE_ENVIADO = 1 THEN 1 ELSE 0 END), 0), 1) AS VALUE
         FROM MONT_AGENDA_CANDIDATOS`,
      ),
      safeMetric(
        `SELECT ROUND(AVG(AGE_DAYS), 1) AS VALUE FROM (
           SELECT (CAST(SYSTIMESTAMP AS DATE) - CAST(CREATED_AT AS DATE)) AS AGE_DAYS
           FROM MONT_SAC_CASES
           WHERE STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')
           UNION ALL
           SELECT (CAST(SYSTIMESTAMP AS DATE) - CAST(CREATED_AT AS DATE)) AS AGE_DAYS
           FROM MONT_PROVIDER_PAYMENTS
           WHERE STATUS IN ('BLOQUEADO','AGUARDANDO_AVALIACAO_CLIENTE')
           UNION ALL
           SELECT (CAST(SYSTIMESTAMP AS DATE) - CAST(CREATED_AT AS DATE)) AS AGE_DAYS
           FROM MONT_AGENDA_CANDIDATOS
           WHERE MONTAGEM_AGENDADA = 0
         )`,
      ),
      safeRows<{ provider_id: string; provider_name: string; finished: number; avg_score: number | null; reworks: number; delayed: number; score: number }>(
        `SELECT pr.ID AS PROVIDER_ID,
                pr.NAME AS PROVIDER_NAME,
                COUNT(DISTINCT CASE WHEN a.STATUS = 'FINALIZADA' THEN a.ID END) AS FINISHED,
                ROUND(AVG(rv.SCORE), 1) AS AVG_SCORE,
                COUNT(DISTINCT rw.ID) AS REWORKS,
                COUNT(DISTINCT CASE
                  WHEN a.STATUS NOT IN ('FINALIZADA','CANCELADA')
                   AND s.SCHEDULED_DATE IS NOT NULL
                   AND TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD') < TRUNC(SYSDATE)
                  THEN a.ID END) AS DELAYED,
                ROUND(
                  NVL(AVG(rv.SCORE), 7)
                  - COUNT(DISTINCT rw.ID) * 0.8
                  - COUNT(DISTINCT CASE
                      WHEN a.STATUS NOT IN ('FINALIZADA','CANCELADA')
                       AND s.SCHEDULED_DATE IS NOT NULL
                       AND TO_DATE(s.SCHEDULED_DATE, 'YYYY-MM-DD') < TRUNC(SYSDATE)
                      THEN a.ID END) * 0.5
                , 1) AS SCORE
         FROM MONT_PROVIDERS pr
         LEFT JOIN MONT_ASSEMBLY_JOBS a ON a.PROVIDER_ID = pr.ID
         LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
         LEFT JOIN MONT_CUSTOMER_REVIEWS rv ON rv.ORDER_ID = a.ORDER_ID AND rv.SERVICE_TYPE = 'MONTAGEM'
         LEFT JOIN MONT_ASSEMBLY_REWORKS rw ON rw.PROVIDER_ID = pr.ID
         WHERE pr.STATUS = 'APROVADO'
         GROUP BY pr.ID, pr.NAME
         HAVING COUNT(DISTINCT a.ID) > 0
         ORDER BY SCORE ASC
         FETCH FIRST 8 ROWS ONLY`,
      ),
    ]);

    const sacRate = (totalSacCases !== null && finished > 0)
      ? Number(((totalSacCases / finished) * 100).toFixed(1))
      : null;

    const scheduleRate = (awaitingSchedule + scheduled + inExecution + finished) > 0
      ? Number(((scheduled + inExecution + finished) / (awaitingSchedule + scheduled + inExecution + finished) * 100).toFixed(1))
      : null;

    return {
      orders: { monitored, createdToday, withAssembly },
      assembly: { awaitingSchedule, scheduled, inExecution, finished, awaitingReview },
      sac: { open: sacOpen, resolved: sacResolved },
      finance: { blocked, released, programmed, paid },
      integration: { failures },
      executive: {
        avgScore,
        avgCommissionPaid,
        sacRate,
        scheduleRate,
        byFilial,
        pipeline30d,
        winthorInTransit,
      },
      process: {
        leadTimes: {
          deliveryToScheduleHours: leadDeliveryToScheduleHours,
          scheduleToFinishHours: leadScheduleToFinishHours,
        },
        conversion: {
          clientSelfSchedulePct: selfSchedulePct,
          noHumanContactPct,
          invitationToSchedulePct: invitationConversion,
        },
        quality: {
          noShowPct,
          reworkPct,
          reworkCost,
        },
        finance: {
          safePayments,
          blockedByReason,
        },
        sac: {
          atRisk: sacAtRisk,
        },
        rankings: {
          branchDelay: branchDelayRanking,
          productIssues: productIssueRanking,
          providerPerformance,
        },
        pending: {
          avgAgeDays: avgPendingAgeDays,
        },
      },
    };
  }
}
