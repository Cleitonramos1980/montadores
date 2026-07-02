export type WhatsAppSendResult = {
  status: "SIMULADO" | "ENVIADO" | "ERRO";
  provider?: "uazapiGO" | "Meta";
  messageId?: string;
  error?: string;
};

const RETRY_DELAYS_MS = [1_000, 2_000];

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Already in E.164-ish format with country code 55
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }
  // Brazilian 11-digit cell (DDD + 9 + number) or 10-digit landline (DDD + 8)
  if (digits.length === 11 || digits.length === 10) {
    return `55${digits}`;
  }
  // Unexpected length — return as-is (provider may handle it)
  return digits.length > 0 ? digits : null;
}
const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      if (resp.ok) return resp;
      if (!TRANSIENT_HTTP.has(resp.status)) {
        console.warn(`[WhatsApp] ${label} HTTP ${resp.status}`, await resp.text().catch(() => ""));
        return null;
      }
      console.warn(`[WhatsApp] ${label} HTTP ${resp.status} — retry ${attempt + 1}`);
    } catch (err) {
      console.error(`[WhatsApp] ${label} erro tentativa ${attempt + 1}:`, (err as Error).message);
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return null;
}

export class WhatsAppProviderService {
  async send(params: {
    to: string;
    text: string;
    modo: string;
  }): Promise<WhatsAppSendResult> {
    const { to, text, modo } = params;

    if (modo === "DRY_RUN") {
      return { status: "SIMULADO" };
    }

    const phone = normalizePhone(to);
    if (!phone) return { status: "ERRO", error: "Telefone inválido" };

    // Primary: uazapiGO
    const uazapiUrl   = process.env.WHATSAPP_UAZAPI_URL;
    const uazapiToken = process.env.WHATSAPP_UAZAPI_TOKEN;

    if (uazapiUrl && uazapiToken) {
      const resp = await fetchWithRetry(
        `${uazapiUrl}/send/text/${phone}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", token: uazapiToken },
          body: JSON.stringify({ text }),
        },
        "uazapiGO",
      );
      if (resp) {
        const data = await resp.json() as { messageId?: string };
        return { status: "ENVIADO", provider: "uazapiGO", messageId: data.messageId };
      }
    }

    // Fallback: Meta Cloud API
    const metaPhoneId = process.env.META_PHONE_ID;
    const metaToken   = process.env.META_WHATSAPP_TOKEN;

    if (metaPhoneId && metaToken) {
      const resp = await fetchWithRetry(
        `https://graph.facebook.com/v18.0/${metaPhoneId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${metaToken}` },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: text },
          }),
        },
        "Meta",
      );
      if (resp) {
        const data = await resp.json() as { messages?: Array<{ id: string }> };
        return { status: "ENVIADO", provider: "Meta", messageId: data.messages?.[0]?.id };
      }
    }

    return { status: "ERRO", error: "Nenhum provider WhatsApp disponível ou configurado" };
  }
}
