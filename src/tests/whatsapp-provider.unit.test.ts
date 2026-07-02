import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhatsAppProviderService, normalizePhone } from "../server/services/WhatsAppProviderService";

// ─── normalizePhone ───────────────────────────────────────────────────────────
describe("normalizePhone", () => {
  it("número com 11 dígitos (celular com 9) → prefixo 55", () => {
    expect(normalizePhone("11999990000")).toBe("5511999990000");
  });

  it("número com 10 dígitos (fixo) → prefixo 55", () => {
    expect(normalizePhone("1133330000")).toBe("551133330000");
  });

  it("número já com 55 + 11 dígitos → mantém", () => {
    expect(normalizePhone("5511999990000")).toBe("5511999990000");
  });

  it("número já com 55 + 10 dígitos → mantém", () => {
    expect(normalizePhone("551133330000")).toBe("551133330000");
  });

  it("formatos com máscara → normaliza dígitos e adiciona 55", () => {
    expect(normalizePhone("(11) 99999-0000")).toBe("5511999990000");
    expect(normalizePhone("11.9999.00000")).toBe("5511999900000"); // 11 dígitos com 5 zeros
    // +55 11 9999-0000 → digits: 551199990000 (12 dígitos, já começa com 55) → mantém
    expect(normalizePhone("+55 11 9999-0000")).toBe("551199990000");
  });

  it("string vazia → null", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("apenas caracteres não-numéricos → null", () => {
    expect(normalizePhone("---")).toBeNull();
  });
});

// ─── WhatsAppProviderService.send ─────────────────────────────────────────────
describe("WhatsAppProviderService.send", () => {
  const svc = new WhatsAppProviderService();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Clear env vars before each test
    delete process.env.WHATSAPP_UAZAPI_URL;
    delete process.env.WHATSAPP_UAZAPI_TOKEN;
    delete process.env.META_PHONE_ID;
    delete process.env.META_WHATSAPP_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("modo DRY_RUN → SIMULADO sem chamar fetch", async () => {
    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "DRY_RUN" });
    expect(r.status).toBe("SIMULADO");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("telefone inválido (apenas letras) → ERRO", async () => {
    const r = await svc.send({ to: "abc", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ERRO");
    expect(r.error).toContain("inválido");
  });

  it("sem nenhum provider configurado → ERRO com mensagem explicativa", async () => {
    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ERRO");
    expect(r.error).toContain("provider");
  });

  it("uazapiGO configurado e responde OK → ENVIADO com provider=uazapiGO", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ messageId: "msg-001" }),
    } as unknown as Response);

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ENVIADO");
    expect(r.provider).toBe("uazapiGO");
    expect(r.messageId).toBe("msg-001");
  });

  it("uazapiGO envia número normalizado com 55 no path", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({}),
    } as unknown as Response);

    await svc.send({ to: "(11) 99999-0000", text: "Olá", modo: "PRODUCAO" });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("5511999990000");
    expect(calledUrl).not.toContain("/11999990000");
  });

  it("uazapiGO falha → fallback para Meta → ENVIADO com provider=Meta", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";
    process.env.META_PHONE_ID         = "phone-id-001";
    process.env.META_WHATSAPP_TOKEN   = "meta-tok";

    // uazapiGO: 3 tentativas (initial + 2 retries) → todas falham com 500 transiente
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" } as unknown as Response)
      // Meta fallback: sucesso
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ messages: [{ id: "meta-msg-001" }] }),
      } as unknown as Response);

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ENVIADO");
    expect(r.provider).toBe("Meta");
    expect(r.messageId).toBe("meta-msg-001");
  }, 15_000);

  it("uazapiGO erro não-transiente (400) → sem retry → vai para Meta", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";
    process.env.META_PHONE_ID         = "phone-id-001";
    process.env.META_WHATSAPP_TOKEN   = "meta-tok";

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "bad request" } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "m2" }] }) } as unknown as Response);

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ENVIADO");
    expect(r.provider).toBe("Meta");
    // uazapiGO fez apenas 1 chamada (sem retry em 400)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("ambos os providers falham → ERRO", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";
    process.env.META_PHONE_ID         = "phone-id-001";
    process.env.META_WHATSAPP_TOKEN   = "meta-tok";

    vi.mocked(fetch)
      .mockResolvedValue({ ok: false, status: 500, text: async () => "err" } as unknown as Response);

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ERRO");
    expect(r.error).toContain("provider");
  }, 15_000);

  it("Meta configurado sem uazapiGO → usa Meta diretamente", async () => {
    process.env.META_PHONE_ID       = "phone-id-001";
    process.env.META_WHATSAPP_TOKEN = "meta-tok";

    vi.mocked(fetch).mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ messages: [{ id: "meta-direct" }] }),
    } as unknown as Response);

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ENVIADO");
    expect(r.provider).toBe("Meta");
  });

  it("fetch lança exceção de rede → provider tenta retry e cai no ERRO", async () => {
    process.env.WHATSAPP_UAZAPI_URL   = "https://api.uazapi.test";
    process.env.WHATSAPP_UAZAPI_TOKEN = "tok123";

    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const r = await svc.send({ to: "11999990000", text: "Olá", modo: "PRODUCAO" });
    expect(r.status).toBe("ERRO");
  }, 15_000);
});
