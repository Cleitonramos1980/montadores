import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows } from "../db/db";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";

export class PaymentService {
  constructor(
    private readonly events = new EventService(),
    private readonly audit = new AuditService(),
  ) {}

  async list(page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows(
        `SELECT p.*, pr.NAME AS PROVIDER_NAME, o.NUMPED
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_PROVIDERS pr ON pr.ID = p.PROVIDER_ID
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
         ORDER BY p.CREATED_AT DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { offset, pageSize },
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS TOTAL
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_PROVIDERS pr ON pr.ID = p.PROVIDER_ID
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID`,
      ),
    ]);
    return { rows, total: Number(countRow?.total ?? 0), page, pageSize };
  }

  async listAll() {
    return queryRows(
      `SELECT p.*, pr.NAME AS PROVIDER_NAME, o.NUMPED
       FROM MONT_PROVIDER_PAYMENTS p
       JOIN MONT_PROVIDERS pr ON pr.ID = p.PROVIDER_ID
       JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       ORDER BY p.CREATED_AT DESC`,
    );
  }

  async release(paymentId: string, userId?: string, justification = "Liberação manual autorizada") {
    const payment = await queryOne<{
      id: string;
      assembly_job_id: string;
      order_id: string;
      numped: string;
      codcli: string;
      status: string;
    }>(
      `SELECT p.ID, p.ASSEMBLY_JOB_ID, p.STATUS, a.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_PROVIDER_PAYMENTS p
       JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE p.ID = :id`,
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");

    const sacOpen = await queryOne<{ value: number }>(
      `SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES
       WHERE ASSEMBLY_JOB_ID = :jobId AND STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')`,
      { jobId: payment.assembly_job_id },
    );
    if (Number(sacOpen?.value ?? 0) > 0) throw new Error("Pagamento não pode ser liberado com SAC aberto.");

    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'LIBERADO', BLOCKED_REASON = NULL, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: paymentId },
    );

    await this.events.emit({
      type: "PAGAMENTO_LIBERADO",
      orderId: payment.order_id,
      numped: payment.numped,
      codcli: payment.codcli,
      paymentId,
      previousStatus: payment.status,
      newStatus: "LIBERADO",
      origin: "FINANCEIRO",
      metadata: { description: "Pagamento liberado para financeiro." },
      userId,
      idempotencyKey: `pagamento-liberado:${paymentId}`,
    });

    await this.audit.log({ actorUserId: userId, action: "PAYMENT_RELEASED", entityType: "provider_payment", entityId: paymentId, justification });
    return { paymentId, status: "LIBERADO" };
  }

  async pay(paymentId: string, userId?: string) {
    const payment = await queryOne<{
      status: string;
      assembly_job_id: string;
      order_id: string;
      numped: string;
      codcli: string;
      amount: number;
    }>(
      `SELECT p.STATUS, p.ASSEMBLY_JOB_ID, p.AMOUNT, a.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_PROVIDER_PAYMENTS p
       JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE p.ID = :id`,
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");
    if (!["PROGRAMADO", "LIBERADO"].includes(payment.status)) {
      throw new Error("Somente pagamentos programados ou liberados podem ser marcados como pagos.");
    }

    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PAGO', PAID_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: paymentId },
    );

    await execDml(
      "INSERT INTO MONT_PAYMENT_APPROVAL_LOGS (ID, PAYMENT_ID, ACTION, USER_ID) VALUES (:logId, :paymentId, 'PAGO', :userId)",
      { logId: uuid(), paymentId, userId: userId ?? null },
    );

    await execDml(
      "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'CONCLUIDO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: payment.order_id },
    );

    await this.events.emit({
      type: "PAGAMENTO_REALIZADO",
      orderId: payment.order_id,
      numped: payment.numped,
      codcli: payment.codcli,
      paymentId,
      origin: "FINANCEIRO",
      metadata: {
        description: "Pagamento ao montador realizado.",
        amount: payment.amount,
        visibleToCustomer: false,
      },
      userId,
      idempotencyKey: `pagamento-realizado:${paymentId}`,
    });

    await this.audit.log({ actorUserId: userId, action: "PAYMENT_PAID", entityType: "provider_payment", entityId: paymentId });
    return { paymentId, status: "PAGO" };
  }

  async program(paymentId: string, programmedFor: string, userId?: string) {
    const payment = await queryOne<{ status: string }>(
      "SELECT STATUS FROM MONT_PROVIDER_PAYMENTS WHERE ID = :id",
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");
    if (payment.status !== "LIBERADO") throw new Error("Somente pagamentos liberados podem ser programados.");

    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PROGRAMADO', PROGRAMMED_FOR = :programmedFor, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { programmedFor, id: paymentId },
    );

    await this.audit.log({ actorUserId: userId, action: "PAYMENT_PROGRAMMED", entityType: "provider_payment", entityId: paymentId, next: { programmedFor } });
    return { paymentId, status: "PROGRAMADO" };
  }

  async setAmount(paymentId: string, newAmount: number, justification: string, userId?: string) {
    const payment = await queryOne<{ id: string; amount: number; status: string }>(
      "SELECT ID, AMOUNT, STATUS FROM MONT_PROVIDER_PAYMENTS WHERE ID = :id",
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");
    if (payment.status === "PAGO") throw new Error("Valor de pagamento já executado não pode ser alterado.");
    if (newAmount < 0) throw new Error("Valor não pode ser negativo.");

    const previousAmount = Number(payment.amount ?? 0);

    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET AMOUNT = :amount, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { amount: newAmount, id: paymentId },
    );

    await this.audit.log({
      actorUserId: userId,
      action:      "PAYMENT_AMOUNT_MANUAL_OVERRIDE",
      entityType:  "provider_payment",
      entityId:    paymentId,
      justification,
      previous:    { amount: previousAmount },
      next:        { amount: newAmount },
    });

    return { paymentId, previousAmount, newAmount };
  }
}
