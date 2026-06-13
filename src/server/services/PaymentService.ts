import oracledb from "oracledb";
import { v4 as uuid } from "uuid";
import { queryRows, queryOne } from "../db/db";
import { withTransaction } from "../db/oracle";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";

export class PaymentService {
  constructor(
    private readonly events = new EventService(),
    private readonly audit = new AuditService(),
  ) {}

  async list(page = 1, pageSize = 50) {
    const limit  = Math.min(pageSize, 200);
    const offset = (page - 1) * limit;
    const [rows, countRow] = await Promise.all([
      queryRows(
        `SELECT p.*, pr.NAME AS PROVIDER_NAME, o.NUMPED
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_PROVIDERS pr ON pr.ID = p.PROVIDER_ID
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
         ORDER BY p.CREATED_AT DESC
         OFFSET :offset ROWS FETCH FIRST :limit ROWS ONLY`,
        { offset, limit },
      ),
      queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_PROVIDER_PAYMENTS", {}),
    ]);
    return { rows, total: Number(countRow?.total ?? 0), page, pageSize: limit };
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
    type PayRow = { id: string; assembly_job_id: string; order_id: string; numped: string; codcli: string; status: string };
    let payment: PayRow | null = null;

    await withTransaction(async (conn) => {
      const r = await conn.execute(
        `SELECT p.ID, p.ASSEMBLY_JOB_ID, p.STATUS, a.ORDER_ID, o.NUMPED, o.CODCLI
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
         WHERE p.ID = :id FOR UPDATE`,
        { id: paymentId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      const row = ((r as any).rows as Record<string, unknown>[] | undefined)?.[0];
      if (!row) throw new Error("Pagamento não encontrado.");

      const sacR = await conn.execute(
        `SELECT COUNT(*) AS CNT FROM MONT_SAC_CASES
         WHERE ASSEMBLY_JOB_ID = :jobId AND STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')`,
        { jobId: String(row.ASSEMBLY_JOB_ID) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      const sacRow = ((sacR as any).rows as Record<string, unknown>[] | undefined)?.[0];
      if (Number(sacRow?.CNT ?? 0) > 0) throw new Error("Pagamento não pode ser liberado com SAC aberto.");

      await conn.execute(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'LIBERADO', BLOCKED_REASON = NULL, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: paymentId },
        { autoCommit: false },
      );

      payment = {
        id: String(row.ID),
        assembly_job_id: String(row.ASSEMBLY_JOB_ID),
        order_id: String(row.ORDER_ID),
        numped: String(row.NUMPED),
        codcli: String(row.CODCLI),
        status: String(row.STATUS),
      };
    });

    await this.events.emit({
      type: "PAGAMENTO_LIBERADO",
      orderId: payment!.order_id,
      numped: payment!.numped,
      codcli: payment!.codcli,
      paymentId,
      previousStatus: payment!.status,
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
    type PayRow = { status: string; assembly_job_id: string; order_id: string; numped: string; codcli: string; amount: number };
    let payment: PayRow | null = null;

    await withTransaction(async (conn) => {
      const r = await conn.execute(
        `SELECT p.STATUS, p.ASSEMBLY_JOB_ID, p.AMOUNT, a.ORDER_ID, o.NUMPED, o.CODCLI
         FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
         WHERE p.ID = :id FOR UPDATE`,
        { id: paymentId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      const row = ((r as any).rows as Record<string, unknown>[] | undefined)?.[0];
      if (!row) throw new Error("Pagamento não encontrado.");
      if (!["PROGRAMADO", "LIBERADO"].includes(String(row.STATUS))) {
        throw new Error("Somente pagamentos programados ou liberados podem ser marcados como pagos.");
      }

      await conn.execute(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PAGO', PAID_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: paymentId },
        { autoCommit: false },
      );
      await conn.execute(
        "INSERT INTO MONT_PAYMENT_APPROVAL_LOGS (ID, PAYMENT_ID, ACTION, USER_ID) VALUES (:logId, :paymentId, 'PAGO', :userId)",
        { logId: uuid(), paymentId, userId: userId ?? null },
        { autoCommit: false },
      );
      await conn.execute(
        "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'CONCLUIDO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :orderId",
        { orderId: String(row.ORDER_ID) },
        { autoCommit: false },
      );

      payment = {
        status: String(row.STATUS),
        assembly_job_id: String(row.ASSEMBLY_JOB_ID),
        order_id: String(row.ORDER_ID),
        numped: String(row.NUMPED),
        codcli: String(row.CODCLI),
        amount: Number(row.AMOUNT),
      };
    });

    await this.events.emit({
      type: "PAGAMENTO_REALIZADO",
      orderId: payment!.order_id,
      numped: payment!.numped,
      codcli: payment!.codcli,
      paymentId,
      origin: "FINANCEIRO",
      metadata: { description: "Pagamento ao montador realizado.", amount: payment!.amount, visibleToCustomer: false },
      userId,
      idempotencyKey: `pagamento-realizado:${paymentId}`,
    });

    await this.audit.log({ actorUserId: userId, action: "PAYMENT_PAID", entityType: "provider_payment", entityId: paymentId });
    return { paymentId, status: "PAGO" };
  }

  async program(paymentId: string, programmedFor: string, userId?: string) {
    await withTransaction(async (conn) => {
      const r = await conn.execute(
        "SELECT STATUS FROM MONT_PROVIDER_PAYMENTS WHERE ID = :id FOR UPDATE",
        { id: paymentId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
      );
      const row = ((r as any).rows as Record<string, unknown>[] | undefined)?.[0];
      if (!row) throw new Error("Pagamento não encontrado.");
      if (String(row.STATUS) !== "LIBERADO") throw new Error("Somente pagamentos liberados podem ser programados.");

      await conn.execute(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PROGRAMADO', PROGRAMMED_FOR = :programmedFor, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { programmedFor, id: paymentId },
        { autoCommit: false },
      );
    });

    await this.audit.log({ actorUserId: userId, action: "PAYMENT_PROGRAMMED", entityType: "provider_payment", entityId: paymentId, next: { programmedFor } });
    return { paymentId, status: "PROGRAMADO" };
  }
}
