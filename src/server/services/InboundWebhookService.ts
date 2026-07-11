import { v4 as uuid } from "uuid";
import { execDml, queryOne } from "../db/db";
import { logger } from "../logger";

const OPT_OUT_KEYWORDS = new Set(["SAIR", "PARAR", "STOP", "CANCELAR", "0", "NAO QUERO", "NÃO QUERO"]);

function normalizeBody(s: string): string {
  return s.trim().toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export type InboundMessage = {
  provider: "uazapiGO" | "Meta" | "unknown";
  fromNumber: string;
  messageBody: string;
  wamid: string | null;
  rawPayload: unknown;
};

export class InboundWebhookService {
  parseUazapi(payload: unknown): InboundMessage | null {
    try {
      const p = payload as Record<string, unknown>;
      const body = String(p["body"] ?? p["text"] ?? "");
      const from = String(p["phone"] ?? p["from"] ?? "").replace(/\D/g, "");
      if (!from) return null;
      return {
        provider:    "uazapiGO",
        fromNumber:  from,
        messageBody: body,
        wamid:       String(p["messageId"] ?? p["id"] ?? ""),
        rawPayload:  payload,
      };
    } catch { return null; }
  }

  parseMeta(payload: unknown): InboundMessage | null {
    try {
      const p = payload as Record<string, unknown>;
      const entry = (p["entry"] as unknown[])?.[0] as Record<string, unknown> | undefined;
      const change = (entry?.["changes"] as unknown[])?.[0] as Record<string, unknown> | undefined;
      const value = change?.["value"] as Record<string, unknown> | undefined;
      const msg = (value?.["messages"] as unknown[])?.[0] as Record<string, unknown> | undefined;
      if (!msg) return null;
      const from = String(msg["from"] ?? "").replace(/\D/g, "");
      const text = (msg["text"] as Record<string, unknown> | undefined);
      const body = String(text?.["body"] ?? "");
      return {
        provider:    "Meta",
        fromNumber:  from,
        messageBody: body,
        wamid:       String(msg["id"] ?? ""),
        rawPayload:  payload,
      };
    } catch { return null; }
  }

  async handle(msg: InboundMessage): Promise<{ action: string }> {
    const logId = uuid();
    const isOptOut = OPT_OUT_KEYWORDS.has(normalizeBody(msg.messageBody));
    let action = "NONE";

    if (isOptOut) {
      // Sem .catch mascarando: um erro de banco no lookup/UPDATE deve propagar para o
      // handler → webhook responde !2xx → provedor reentrega (at-least-once). Só marca
      // OPT_OUT_REGISTERED DEPOIS de o UPDATE persistir (antes marcava mesmo em falha).
      const customer = await queryOne<{ codcli: string }>(
        "SELECT CODCLI FROM MONT_CUSTOMERS WHERE REPLACE(REPLACE(REPLACE(PHONE,' ',''),'-',''),'(','') LIKE '%' || :phone || '%'",
        { phone: msg.fromNumber.slice(-8) },
      );

      if (customer) {
        await execDml(
          `UPDATE MONT_CUSTOMERS SET OPT_OUT_WHATSAPP = 1, UPDATED_AT = SYSTIMESTAMP WHERE CODCLI = :codcli`,
          { codcli: customer.codcli },
        );
        action = "OPT_OUT_REGISTERED";
        logger.info({ codcli: customer.codcli, provider: msg.provider }, "[inbound] opt-out registrado");
      } else {
        action = "OPT_OUT_CUSTOMER_NOT_FOUND";
      }
    }

    await execDml(
      `INSERT INTO MONT_MSG_INBOUND_LOGS
       (ID, PROVIDER, FROM_NUMBER, MESSAGE_BODY, WAMID, PAYLOAD_JSON, ACTION_TAKEN, CRIADO_EM)
       VALUES (:id, :provider, :from, :body, :wamid, :payload, :action, SYSTIMESTAMP)`,
      {
        id:       logId,
        provider: msg.provider,
        from:     msg.fromNumber,
        body:     msg.messageBody.slice(0, 4000),
        wamid:    msg.wamid ?? null,
        payload:  JSON.stringify(msg.rawPayload).slice(0, 4000),
        action,
      },
    ).catch((e) => logger.error({ err: (e as Error).message }, "[inbound] erro ao gravar log de entrada"));

    return { action };
  }
}
