import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { features } from "../config";
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
  constructor(private readonly events = new EventService()) {}

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
    if (!payment) throw new Error("Pagamento não encontrado.");
    if (payment.status !== "LIBERADO") {
      throw new Error(`Pagamento não pode ser pago via PIX com status "${payment.status}". Deve estar LIBERADO.`);
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT ID FROM MONT_PIX_PAYMENT_REQUESTS
       WHERE PROVIDER_PAYMENT_ID = :pid AND STATUS NOT IN ('FALHOU','CANCELADO')`,
      { pid: paymentId },
    );
    if (existing) {
      throw new Error("Já existe uma solicitação PIX ativa para este pagamento. Aguarde a confirmação.");
    }

    const account = await this.getProviderAccount(payment.provider_id);
    if (!account) {
      throw new Error("Montador não tem chave PIX cadastrada e validada. Cadastre a chave PIX primeiro.");
    }

    const idempotencyKey = `pix:${paymentId}:${Date.now()}`;
    const requestId = uuid();

    await execDml(
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

    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PROCESSANDO_PIX', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: paymentId },
    );

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
      await this.simulateSandboxConfirmation(requestId, paymentId);
    }

    return { requestId, mode: PIX_MODE };
  }

  private async simulateSandboxConfirmation(requestId: string, paymentId: string): Promise<void> {
    const fakeEndToEnd = `E${Date.now()}SANDBOX`;
    await execDml(
      `UPDATE MONT_PIX_PAYMENT_REQUESTS
       SET STATUS = 'CONFIRMADO', END_TO_END_ID = :e2e, CONFIRMED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP
       WHERE ID = :id`,
      { e2e: fakeEndToEnd, id: requestId },
    );
    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'PAGO', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: paymentId },
    );
    await this.events.emit({
      type: "PIX_PAYMENT_CONFIRMED",
      orderId: "",
      numped: "",
      codcli: "",
      origin: "SISTEMA",
      metadata: { description: `PIX confirmado (SANDBOX). EndToEnd: ${fakeEndToEnd}.`, endToEndId: fakeEndToEnd },
      idempotencyKey: `pix-confirm:${requestId}`,
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
