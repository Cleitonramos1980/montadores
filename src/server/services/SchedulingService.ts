import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { EventService } from "./EventService";
import { AssemblyEligibilityService } from "./AssemblyEligibilityService";

export class SchedulingService {
  constructor(
    private readonly events = new EventService(),
    private readonly eligibility = new AssemblyEligibilityService(),
  ) {}

  async availableSlots(orderId: string) {
    const providers = await queryRows<{ id: string; name: string; capacity_per_day: number }>(
      `SELECT ID, NAME, CAPACITY_PER_DAY FROM MONT_PROVIDERS
       WHERE STATUS = 'APROVADO' AND ACTIVE = 1 AND DOCUMENTS_VALIDATED = 1`,
    );
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    });

    const [bookedSlots, unavailability] = await Promise.all([
      queryRows<{ provider_id: string; scheduled_date: string; scheduled_period: string }>(
        `SELECT PROVIDER_ID, SCHEDULED_DATE, SCHEDULED_PERIOD
         FROM MONT_ASSEMBLY_SCHEDULES
         WHERE SCHEDULED_DATE >= :firstDay AND STATUS != 'CANCELADA'`,
        { firstDay: days[0] },
      ),
      queryRows<{ provider_id: string; unavail_date: string }>(
        `SELECT PROVIDER_ID, TO_CHAR(UNAVAIL_DATE, 'YYYY-MM-DD') AS UNAVAIL_DATE
         FROM MONT_PROVIDER_UNAVAILABILITY
         WHERE UNAVAIL_DATE >= TO_DATE(:firstDay, 'YYYY-MM-DD')`,
        { firstDay: days[0] },
      ).catch(() => [] as { provider_id: string; unavail_date: string }[]),
    ]);

    const bookedSet   = new Set(bookedSlots.map((s) => `${s.provider_id}:${s.scheduled_date}:${s.scheduled_period}`));
    const unavailSet  = new Set(unavailability.map((u) => `${u.provider_id}:${u.unavail_date}`));

    return days.flatMap((date) =>
      providers.flatMap((provider) =>
        (["MANHA", "TARDE"] as const).flatMap((period) => {
          if (bookedSet.has(`${provider.id}:${date}:${period}`)) return [];
          if (unavailSet.has(`${provider.id}:${date}`)) return [];
          return [{ orderId, providerId: provider.id, providerName: provider.name, date, period }];
        }),
      ),
    );
  }

  async schedule(orderId: string, providerId: string, date: string, period: string, origin: "CLIENTE" | "OPERACAO" = "OPERACAO") {
    const provider = await queryOne(
      "SELECT * FROM MONT_PROVIDERS WHERE ID = :id AND STATUS = 'APROVADO' AND ACTIVE = 1 AND DOCUMENTS_VALIDATED = 1",
      { id: providerId },
    );
    if (!provider) throw new Error("Montador indisponível, inativo, bloqueado ou ainda não aprovado.");

    const order = await queryOne<{ id: string; numped: string; codcli: string }>(
      "SELECT ID, NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
      { id: orderId },
    );
    if (!order) throw new Error("Pedido não encontrado.");

    // Block scheduling if no products have active commission rules
    const eligResult = await this.eligibility.checkEligibility(order.numped);
    if (eligResult.dataSource === "winthor_pcpedi" && !eligResult.eligible) {
      throw new Error(
        `Pedido ${order.numped} não possui produtos com comissão de montagem configurada. Configure as regras em Comissões antes de agendar.`,
      );
    }

    // Cancel any existing active job + schedule for this order (reagendamento gracioso)
    const existingJob = await queryOne<{ id: string; schedule_id: string | null }>(
      `SELECT ID, SCHEDULE_ID FROM MONT_ASSEMBLY_JOBS
       WHERE ORDER_ID = :orderId AND STATUS NOT IN ('CANCELADA', 'FINALIZADA')
       FETCH FIRST 1 ROWS ONLY`,
      { orderId },
    );
    if (existingJob) {
      await execDml(
        "UPDATE MONT_ASSEMBLY_JOBS SET STATUS = 'CANCELADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: existingJob.id },
      );
      if (existingJob.schedule_id) {
        await execDml(
          "UPDATE MONT_ASSEMBLY_SCHEDULES SET STATUS = 'CANCELADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
          { id: existingJob.schedule_id },
        );
      }
      await execDml(
        `UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'CANCELADO', UPDATED_AT = SYSTIMESTAMP
         WHERE ASSEMBLY_JOB_ID = :jobId AND STATUS NOT IN ('PAGO')`,
        { jobId: existingJob.id },
      );
    }

    // Remove any previously cancelled schedule for this provider+date+period
    // so the unique constraint (PROVIDER_ID, SCHEDULED_DATE, SCHEDULED_PERIOD) does not block the new INSERT.
    await execDml(
      `DELETE FROM MONT_ASSEMBLY_SCHEDULES
       WHERE PROVIDER_ID = :providerId
         AND SCHEDULED_DATE = :scheduledDate
         AND SCHEDULED_PERIOD = :scheduledPeriod
         AND STATUS = 'CANCELADA'`,
      { providerId, scheduledDate: date, scheduledPeriod: period },
    );

    const scheduleId = uuid();
    await execDml(
      `INSERT INTO MONT_ASSEMBLY_SCHEDULES (ID, ORDER_ID, PROVIDER_ID, SCHEDULED_DATE, SCHEDULED_PERIOD)
       VALUES (:id, :orderId, :providerId, :scheduledDate, :scheduledPeriod)`,
      { id: scheduleId, orderId, providerId, scheduledDate: date, scheduledPeriod: period },
    );

    const jobId = uuid();
    await execDml(
      `INSERT INTO MONT_ASSEMBLY_JOBS (ID, ORDER_ID, SCHEDULE_ID, PROVIDER_ID, STATUS)
       VALUES (:id, :orderId, :scheduleId, :providerId, 'AGENDADA')`,
      { id: jobId, orderId, scheduleId, providerId },
    );

    // Payment amount comes from commission rules × PCPEDI quantities (calculated during eligibility check).
    // Fallback to 0 only when Oracle is offline and no commission data is available.
    const amount = eligResult.dataSource === "winthor_pcpedi"
      ? (eligResult.totalEstimatedCommission ?? 0)
      : 0;

    // Record eligible products for this assembly job
    if (eligResult.eligibleProducts?.length) {
      for (const ep of eligResult.eligibleProducts) {
        await execDml(
          `INSERT INTO MONT_ASSEMBLY_JOB_ITEMS
             (ID, ASSEMBLY_JOB_ID, CODPROD, DESCRICAO, QUANTITY, RULE_SOURCE,
              COMMISSION_PERCENT, FIXED_AMOUNT, CALCULATED_AMOUNT,
              VALOR_UNITARIO, VALOR_TOTAL_ITEM, UNIDADE)
           VALUES
             (:id, :jobId, :codprod, :descricao, :qty, :ruleSource,
              :commPct, :fixedAmt, :calcAmt,
              :valorUnitario, :valorTotal, :unidade)`,
          {
            id: uuid(),
            jobId,
            codprod: Number(ep.codprod),
            descricao: ep.descricao ?? null,
            qty: ep.quantity,
            ruleSource: ep.ruleSource,
            commPct: ep.commissionPercent ?? null,
            fixedAmt: ep.fixedAmount ?? null,
            calcAmt: ep.estimatedCommission,
            valorUnitario: ep.pvenda ?? null,
            valorTotal: ep.pvenda != null ? ep.pvenda * ep.quantity : null,
            unidade: ep.unidade ?? null,
          },
        );
      }
    }

    await execDml(
      `INSERT INTO MONT_PROVIDER_PAYMENTS (ID, PROVIDER_ID, ASSEMBLY_JOB_ID, AMOUNT, STATUS)
       VALUES (:id, :providerId, :jobId, :amount, 'AGUARDANDO_FINALIZACAO')`,
      { id: uuid(), providerId, jobId, amount },
    );

    await execDml(
      "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_AGENDADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: orderId },
    );

    await this.events.emit({
      type: "MONTAGEM_AGENDADA",
      orderId,
      numped: order.numped,
      codcli: order.codcli,
      assemblyId: jobId,
      providerId,
      origin,
      metadata: { description: `Montagem agendada para ${date} (${period}).`, amount },
      idempotencyKey: `montagem-agendada:${order.numped}:${date}:${period}`,
    });

    return { scheduleId, jobId, amount };
  }
}
