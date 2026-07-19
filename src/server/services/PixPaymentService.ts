import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows, withTransaction } from "../db/db";
import { features } from "../config";
import { AuditService } from "./AuditService";
import { EventService } from "./EventService";

export type PixMode = "PIX_DISABLED" | "PIX_SANDBOX" | "PIX_PRODUCTION";

const PIX_MODE: PixMode = features.pixPayments
  ? (process.env.PIX_MODE as PixMode ?? "PIX_SANDBOX")
  : "PIX_DISABLED";

type PaymentAccount = {
  id: string;
  provider_id: string;
  pix_key_type: string;
  pix_key: string;
  holder_name: string;
  holder_document: string | null;
  status: string;
};

type ProviderPayment = {
  id: string;
  provider_id: string;
  amount: number;
  status: string;
  assembly_job_id: string | null;
  order_id: string | null;
};

export class PixPaymentService {
  constructor(
    private readonly events = new EventService(),
    private readonly audit = new AuditService(),
  ) {}

  getMode(): PixMode { return PIX_MODE; }

  async getProviderAccount(providerId: string): Promise<PaymentAccount | null> {
    return queryOne<PaymentAccount>(
      "SELECT * FROM MONT_PROVIDER_PAYMENT_ACCOUNTS WHERE PROVIDER_ID = :pid AND STATUS = 'ATIVO'",
      { pid: providerId },
    );
  }

  async upsertProviderAccount(providerId: string, data: {
    pixKeyType: string;
    pixKey: string;
    holderName: string;
    holderDocument?: string;
  }): Promise<void> {
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDER_PAYMENT_ACCOUNTS WHERE PROVIDER_ID = :pid",
      { pid: providerId },
    );
    if (existing) {
      await execDml(
        `UPDATE MONT_PROVIDER_PAYMENT_ACCOUNTS
         SET PIX_KEY_TYPE = :kt, PIX_KEY = :pk, HOLDER_NAME = :hn,
             HOLDER_DOCUMENT = :hd, STATUS = 'PENDENTE', UPDATED_AT = SYSTIMESTAMP
         WHERE ID = :id`,
        { kt: data.pixKeyType, pk: data.pixKey, hn: data.holderName,
          hd: data.holderDocument ?? null, id: existing.id },
      );
    } else {
      await execDml(
        `INSERT INTO MONT_PROVIDER_PAYMENT_ACCOUNTS
           (ID, PROVIDER_ID, PIX_KEY_TYPE, PIX_KEY, HOLDER_NAME, HOLDER_DOCUMENT, STATUS)
         VALUES (:id, :pid, :kt, :pk, :hn, :hd, 'PENDENTE')`,
        { id: uuid(), pid: providerId, kt: data.pixKeyType, pk: data.pixKey,
          hn: data.holderName, hd: data.holderDocument ?? null },
      );
    }
  }

  async validateAccount(accountId: string, validatedBy: string): Promise<void> {
    await execDml(
      `UPDATE MONT_PROVIDER_PAYMENT_ACCOUNTS
       SET STATUS = 'ATIVO', VALIDATED_AT = SYSTIMESTAMP, VALIDATED_BY = :uid, UPDATED_AT = SYSTIMESTAMP
       WHERE ID = :id`,
      { id: accountId, uid: validatedBy },
    );
  }

  async requestPayment(paymentId: string, requestedBy: string): Promise<{ requestId: string; mode: PixMode }> {
    if (PIX_MODE === "PIX_DISABLED") {
      throw new Error("PIX não está habilitado neste ambiente. Configure ENABLE_PIX_PAYMENTS=true e PIX_MODE=PIX_SANDBOX para testes.");
    }

    const payment = await queryOne<ProviderPayment>(
      "SELECT * FROM MONT_PROVIDER_PAYMENTS WHERE ID = :id",
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");
    if (payment.status !== "LIBERADO") {
      throw new Error(`Pagamento não pode ser pago via PIX com status "${payment.status}". Deve estar LIBERADO.`);
    }

    const account = await this.getProviderAccount(payment.provider_id);
    if (!account) {
      throw new Error("Montador não tem chave PIX cadastrada e validada. Cadastre a chave PIX primeiro.");
    }

    const idempotencyKey = `pix:${paymentId}:${Date.now()}`;
    const requestId = uuid();

    // Seção crítica atômica com lock pessimista (mesmo padrão de PaymentService.pay()):
    // fecha o TOCTOU — duas solicitações PIX concorrentes para o mesmo pagamento não geram
    // duas requests nem dois PROCESSANDO_PIX (o segundo espera o commit, re-lê e aborta).
    await withTransaction(async (tx) => {
      const locked = await tx.queryOne<{ status: string }>(
        "SELECT STATUS FROM MONT_PROVIDER_PAYMENTS WHERE ID = :id FOR UPDATE",
        { id: paymentId },
      );
      if (!locked || locked.status !== "LIBERADO") {
        throw new AppError("Pagamento não está LIBERADO (pode já ter uma solicitação PIX em andamento).", 409, "CONFLICT");
      }
      const dup = await tx.queryOne<{ id: string }>(
        `SELECT ID FROM MONT_PIX_PAYMENT_REQUESTS
         WHERE PROVIDER_PAYMENT_ID = :pid AND STATUS NOT IN ('FALHOU','CANCELADO')`,
        { pid: paymentId },
      );
      if (dup) {
        throw new AppError("Já existe uma solicitação PIX ativa para este pagamento. Aguarde a confirmação.", 409, "CONFLICT");
      }
      await tx.exec(
        `INSERT INTO MONT_PIX_PAYMENT_REQUESTS
           (ID, PROVIDER_PAYMENT_ID, PROVIDER_ID, AMOUNT, PIX_KEY, PSP_PROVIDER,
            STATUS, IDEMPOTENCY_KEY, REQUESTED_BY)
         VALUES (:id, :pmtId, :provId, :amt, :pix, :psp, :status, :ikey, :reqby)`,
        {
          id: requestId,
          pmtId: paymentId,
          provId: payment.provider_id,
          amt: payment.amount,
          pix: account.pix_key,
          psp: PIX_MODE === "PIX_SANDBOX" ? "SANDBOX" : "DISABLED",
          status: PIX_MODE === "PIX_SANDBOX" ? "PROCESSANDO" : "PENDENTE",
          ikey: idempotencyKey,
          reqby: requestedBy,
        },
      );
      await tx.exec(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PROCESSANDO_PIX', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: paymentId },
      );
    });

    await this.events.emit({
      type: "PIX_PAYMENT_REQUESTED",
      orderId: payment.order_id ?? "",
      numped: "",
      codcli: "",
      origin: "FINANCEIRO",
      metadata: {
        description: `PIX solicitado para montador via ${PIX_MODE}. Valor: R$ ${payment.amount}. RequestId: ${requestId}.`,
        pixRequestId: requestId,
        mode: PIX_MODE,
      },
      idempotencyKey: idempotencyKey,
    });

    if (PIX_MODE === "PIX_SANDBOX") {
      await this.simulateSandboxConfirmation(requestId, paymentId, requestedBy);
    }

    return { requestId, mode: PIX_MODE };
  }

  private async simulateSandboxConfirmation(requestId: string, paymentId: string, requestedBy: string): Promise<void> {
    const fakeEndToEnd = `E${Date.now()}SANDBOX`;

    // Dados do pedido para espelhar o pay() canônico (concluir pedido + logar aprovação).
    const info = await queryOne<{ order_id: string; numped: string; codcli: string }>(
      `SELECT a.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_PROVIDER_PAYMENTS p
       JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE p.ID = :id`,
      { id: paymentId },
    );

    // Atômico e espelhando pay(): PIX confirmado marca o pagamento PAGO, registra o log
    // de aprovação e conclui o pedido — tudo-ou-nada (evita pagamento "meio-feito").
    await withTransaction(async (tx) => {
      await tx.exec(
        `UPDATE MONT_PIX_PAYMENT_REQUESTS
         SET STATUS = 'CONFIRMADO', END_TO_END_ID = :e2e, CONFIRMED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP
         WHERE ID = :id`,
        { e2e: fakeEndToEnd, id: requestId },
      );
      await tx.exec(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PAGO', PAID_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: paymentId },
      );
      await tx.exec(
        "INSERT INTO MONT_PAYMENT_APPROVAL_LOGS (ID, PAYMENT_ID, ACTION, USER_ID) VALUES (:logId, :paymentId, 'PAGO', :userId)",
        { logId: uuid(), paymentId, userId: requestedBy ?? null },
      );
      if (info?.order_id) {
        await tx.exec(
          "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'CONCLUIDO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
          { id: info.order_id },
        );
      }
    });

    await this.events.emit({
      type: "PIX_PAYMENT_CONFIRMED",
      orderId: info?.order_id ?? "",
      numped: info?.numped ?? "",
      codcli: info?.codcli ?? "",
      origin: "SISTEMA",
      metadata: { description: `PIX confirmado (SANDBOX). EndToEnd: ${fakeEndToEnd}.`, endToEndId: fakeEndToEnd },
      idempotencyKey: `pix-confirm:${requestId}`,
    });

    await this.audit.log({
      actorUserId: requestedBy,
      action: "PAYMENT_PAID",
      entityType: "provider_payment",
      entityId: paymentId,
      next: { via: "PIX_SANDBOX", endToEndId: fakeEndToEnd },
    });
  }

  async listRequests(providerId?: string): Promise<unknown[]> {
    const where = providerId ? "WHERE PROVIDER_ID = :pid" : "";
    const binds = providerId ? { pid: providerId } : {};
    return queryRows(
      `SELECT * FROM MONT_PIX_PAYMENT_REQUESTS ${where} ORDER BY REQUESTED_AT DESC FETCH FIRST 100 ROWS ONLY`,
      binds,
    );
  }
}
