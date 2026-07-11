import { describe, it, expect, vi, beforeEach } from "vitest";
import { InboundWebhookService } from "../server/services/InboundWebhookService";

vi.mock("../server/db/db", () => ({
  queryOne: vi.fn(),
  execDml:  vi.fn().mockResolvedValue(undefined),
}));

import { queryOne, execDml } from "../server/db/db";
const mockQueryOne = vi.mocked(queryOne);
const mockExecDml  = vi.mocked(execDml);

const svc = new InboundWebhookService();

// ─── parseUazapi ─────────────────────────────────────────────────────────────
describe("InboundWebhookService.parseUazapi", () => {
  it("payload completo → retorna InboundMessage", () => {
    const msg = svc.parseUazapi({ phone: "5511999990000", body: "Olá", messageId: "wamid-1" });
    expect(msg).not.toBeNull();
    expect(msg!.provider).toBe("uazapiGO");
    expect(msg!.fromNumber).toBe("5511999990000");
    expect(msg!.messageBody).toBe("Olá");
    expect(msg!.wamid).toBe("wamid-1");
  });

  it("aceita campo alternativo 'from' em vez de 'phone'", () => {
    const msg = svc.parseUazapi({ from: "5511888880000", text: "Oi" });
    expect(msg?.fromNumber).toBe("5511888880000");
  });

  it("sem número → retorna null", () => {
    expect(svc.parseUazapi({ body: "Olá" })).toBeNull();
  });

  it("payload inválido (não-objeto) → retorna null sem lançar", () => {
    expect(svc.parseUazapi(null)).toBeNull();
    expect(svc.parseUazapi("string")).toBeNull();
    expect(svc.parseUazapi(42)).toBeNull();
  });

  it("número é normalizado para apenas dígitos", () => {
    // "+55 (11) 9999-0000" → strip non-digits → "551199990000" (12 dígitos)
    const msg = svc.parseUazapi({ phone: "+55 (11) 9999-0000", body: "teste" });
    expect(msg?.fromNumber).toBe("551199990000");
  });
});

// ─── parseMeta ────────────────────────────────────────────────────────────────
describe("InboundWebhookService.parseMeta", () => {
  const validMetaPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "5511999990000",
            id:   "wamid-meta-1",
            text: { body: "Parar" },
          }],
        },
      }],
    }],
  };

  it("payload Meta válido → retorna InboundMessage", () => {
    const msg = svc.parseMeta(validMetaPayload);
    expect(msg).not.toBeNull();
    expect(msg!.provider).toBe("Meta");
    expect(msg!.fromNumber).toBe("5511999990000");
    expect(msg!.messageBody).toBe("Parar");
    expect(msg!.wamid).toBe("wamid-meta-1");
  });

  it("payload sem messages → retorna null", () => {
    expect(svc.parseMeta({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
  });

  it("payload inválido → retorna null sem lançar", () => {
    expect(svc.parseMeta(null)).toBeNull();
    expect(svc.parseMeta({})).toBeNull();
  });
});

// ─── handle — opt-out keywords ────────────────────────────────────────────────
describe("InboundWebhookService.handle — opt-out", () => {
  const baseMsg = {
    provider:    "uazapiGO" as const,
    fromNumber:  "5511999990000",
    wamid:       "wamid-001",
    rawPayload:  {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecDml.mockResolvedValue(undefined);
  });

  const optOutKeywords = [
    "SAIR", "sair", "Sair",
    "PARAR", "parar",
    "STOP", "stop", "Stop",
    "CANCELAR", "cancelar",
    "0",
    "NAO QUERO", "nao quero",
    "NÃO QUERO", "não quero",   // com acento — deve ser normalizado
  ];

  for (const kw of optOutKeywords) {
    it(`"${kw}" → OPT_OUT_REGISTERED quando cliente encontrado`, async () => {
      mockQueryOne.mockResolvedValueOnce({ codcli: "12345" });

      const r = await svc.handle({ ...baseMsg, messageBody: kw });
      expect(r.action).toBe("OPT_OUT_REGISTERED");

      expect(mockExecDml).toHaveBeenCalledWith(
        expect.stringContaining("OPT_OUT_WHATSAPP = 1"),
        expect.objectContaining({ codcli: "12345" }),
      );
    });
  }

  it("opt-out com espaços extras → normaliza e processa", async () => {
    mockQueryOne.mockResolvedValueOnce({ codcli: "99999" });
    const r = await svc.handle({ ...baseMsg, messageBody: "  SAIR  " });
    expect(r.action).toBe("OPT_OUT_REGISTERED");
  });

  it("opt-out mas cliente não encontrado → OPT_OUT_CUSTOMER_NOT_FOUND", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const r = await svc.handle({ ...baseMsg, messageBody: "STOP" });
    expect(r.action).toBe("OPT_OUT_CUSTOMER_NOT_FOUND");
  });

  it("mensagem não é opt-out → ação NONE e não altera banco", async () => {
    const r = await svc.handle({ ...baseMsg, messageBody: "Olá, como está?" });
    expect(r.action).toBe("NONE");
    // queryOne de cliente NÃO deve ser chamado para não-opt-out
    expect(mockQueryOne).not.toHaveBeenCalled();
    // execDml só deve ser chamado para o INSERT de log, nunca para UPDATE de opt-out
    const updateCall = mockExecDml.mock.calls.find(([sql]) => (sql as string).includes("OPT_OUT_WHATSAPP"));
    expect(updateCall).toBeUndefined();
  });

  it("mensagens comuns não ativam opt-out", async () => {
    const nonOptOut = ["Obrigado", "OK", "Sim", "Não", "Quando chega?", "1", "2"];
    for (const msg of nonOptOut) {
      vi.clearAllMocks();
      mockExecDml.mockResolvedValue(undefined);
      const r = await svc.handle({ ...baseMsg, messageBody: msg });
      expect(r.action).toBe("NONE");
    }
  });

  it("inbound log é gravado para QUALQUER mensagem (opt-out ou não)", async () => {
    mockQueryOne.mockResolvedValueOnce({ codcli: "12345" });

    await svc.handle({ ...baseMsg, messageBody: "SAIR" });

    const insertCall = mockExecDml.mock.calls.find(([sql]) => (sql as string).includes("MONT_MSG_INBOUND_LOGS"));
    expect(insertCall).toBeDefined();
  });

  it("erro no banco ao registrar opt-out → PROPAGA (não marca OPT_OUT_REGISTERED em falha)", async () => {
    mockQueryOne.mockResolvedValueOnce({ codcli: "12345" });
    // UPDATE do opt-out falha — o erro deve propagar para o handler (webhook responde
    // !2xx → provedor reentrega). Antes o catch engolia e retornava OPT_OUT_REGISTERED
    // mesmo sem persistir o descadastro (bug APP-010).
    mockExecDml.mockRejectedValueOnce(new Error("ORA-xxxx")); // UPDATE opt-out falha

    await expect(svc.handle({ ...baseMsg, messageBody: "STOP" })).rejects.toThrow();
  });
});
