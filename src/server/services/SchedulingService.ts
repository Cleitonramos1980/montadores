import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows, withTransaction } from "../db/db";
import { EventService } from "./EventService";

export class SchedulingService {
  constructor(private readonly events = new EventService()) {}

  async availableSlots(orderId: string) {
    const providers = await queryRows<{ id: string; name: string; capacity_per_day: number }>(
      `SELECT ID, NAME, CAPACITY_PER_DAY FROM MONT_PROVIDERS
       WHERE STATUS = 'APROVADO' AND ACTIVE = 1 AND DOCUMENTS_VALIDATED = 1`,
    );
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    });
    return days.flatMap((date) =>
      providers.flatMap((provider) =>
        ["MANHA", "TARDE"].map((period) => ({
          orderId,
          providerId: provider.id,
          providerName: provider.name,
          date,
          period,
        })),
      ),
    );
  }

  async schedule(orderId: string, providerId: string, date: string, period: string) {
    const provider = await queryOne(
      "SELECT * FROM MONT_PROVIDERS WHERE ID = :id AND STATUS = 'APROVADO' AND ACTIVE = 1 AND DOCUMENTS_VALIDATED = 1",
      { id: providerId },
    );
    if (!provider) throw new Error("Montador indisponível, inativo, bloqueado ou ainda não aprovado.");

    const order = await queryOne<{ id: string; numped: string; codcli: string }>(
      "SELECT ID, NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
      { id: orderId },
    );
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");

    // Idempotência por pedido: um pedido não pode ter dois agendamentos/jobs ativos
    // (senão gera 2 montadores + 2 pagamentos para a mesma montagem).
    const existing = await queryOne<{ value: number }>(
      `SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS
       WHERE ORDER_ID = :orderId AND STATUS IN ('AGENDADA','EM_EXECUCAO','FINALIZADA')`,
      { orderId },
    );
    if (Number(existing?.value ?? 0) > 0) {
      throw new AppError("Este pedido já possui uma montagem agendada.", 409, "CONFLICT");
    }

    // Calculate assembly cost from VLMAODEOBRA stored in ASSEMBLY_COST column
    const costRow = await queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(QUANTITY * ASSEMBLY_COST), 0) AS TOTAL
       FROM MONT_ORDER_ITEMS
       WHERE ORDER_ID = :orderId AND REQUIRES_ASSEMBLY = 1`,
      { orderId },
    );
    const amount = Number(costRow?.total ?? 0) > 0 ? Number(costRow!.total) : 120;

    const scheduleId = uuid();
    const jobId = uuid();
    // Atômico: schedule + job + pagamento + status do pedido são tudo-ou-nada.
    await withTransaction(async (tx) => {
      await tx.exec(
        `INSERT INTO MONT_ASSEMBLY_SCHEDULES (ID, ORDER_ID, PROVIDER_ID, SCHEDULED_DATE, SCHEDULED_PERIOD)
         VALUES (:id, :orderId, :providerId, :scheduledDate, :scheduledPeriod)`,
        { id: scheduleId, orderId, providerId, scheduledDate: date, scheduledPeriod: period },
      );
      await tx.exec(
        `INSERT INTO MONT_ASSEMBLY_JOBS (ID, ORDER_ID, SCHEDULE_ID, PROVIDER_ID, STATUS)
         VALUES (:id, :orderId, :scheduleId, :providerId, 'AGENDADA')`,
        { id: jobId, orderId, scheduleId, providerId },
      );
      await tx.exec(
        `INSERT INTO MONT_PROVIDER_PAYMENTS (ID, PROVIDER_ID, ASSEMBLY_JOB_ID, AMOUNT, STATUS)
         VALUES (:id, :providerId, :jobId, :amount, 'AGUARDANDO_FINALIZACAO')`,
        { id: uuid(), providerId, jobId, amount },
      );
      await tx.exec(
        "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_AGENDADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: orderId },
      );
    });

    await this.events.emit({
      type: "MONTAGEM_AGENDADA",
      orderId,
      numped: order.numped,
      codcli: order.codcli,
      assemblyId: jobId,
      providerId,
      origin: "CLIENTE",
      metadata: { description: `Montagem agendada para ${date} (${period}).`, amount },
      idempotencyKey: `montagem-agendada:${order.numped}:${date}:${period}`,
    });

    return { scheduleId, jobId, amount };
  }
}
