/**
 * Testes unitários de deduplicação de mensagens.
 *
 * Cobre o comportamento corrigido do MessageTriggerService:
 *  1. DRY_RUN verifica checkIdempotency(key, "DRY_RUN") e bloqueia SIMULADO_DRY_RUN repetido.
 *  2. Chave de idempotência é fluxo:numped:eventKey (sem event.id) — dois disparos do mesmo
 *     tipo para o mesmo pedido são bloqueados como IGNORADO_DUPLICIDADE.
 *  3. RESEND_ALLOWED / MAX_RESENDS / RESEND_AFTER_H são consultados e verificados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageTriggerService } from "../server/services/MessageTriggerService";
import type { FluxoEventTrigger } from "../server/services/MessageTriggerService";
import type { OrderSnapshot } from "../server/services/OrderSnapshotService";

// ─── Mock do módulo de banco ────────────────────────────────────────────────
vi.mock("../server/db/db", () => ({
  queryOne: vi.fn(),
  execDml:  vi.fn().mockResolvedValue(undefined),
  query:    vi.fn().mockResolvedValue([]),
}));

import { queryOne } from "../server/db/db";
const mockQueryOne = vi.mocked(queryOne);

// ─── Fixtures ────────────────────────────────────────────────────────────────
const baseEvent: FluxoEventTrigger = {
  id:                "evt-001",
  numped:            "99999",
  codcli:            "12345",
  eventKey:          "PEDIDO_CRIADO",
  fluxoEventKeyNovo: "PEDIDO_CRIADO",
};

const baseSnapshot: OrderSnapshot = {
  numped:                    "99999",
  codcli:                    "12345",
  nome_cliente:              "Cliente Teste",
  codfilial:                 "1",
  condvenda:                 1,
  posicao:                   "A",
  status_pedido:             null,
  fluxo_status_atual:        "PEDIDO_CRIADO",
  fluxo_status_anterior:     null,
  fluxo_event_key_atual:     "PEDIDO_CRIADO",
  fluxo_event_key_anterior:  null,
  data_digitacao:            null,
  data_emissao_mapa:         null,
  data_inicio_conferencia:   null,
  data_fim_conferencia:      null,
  numnota:                   null,
  data_faturamento:          null,
  data_saida_nota:           null,
  data_entrega_real:         null,
  func_emissao_mapa:         null,
  cod_separador:             null,
  cod_conferente:            null,
  faturado_por:              null,
  ultima_sincronizacao:      new Date(),
  atualizado_em:             new Date(),
};

// ─── Helpers de setup de mocks ───────────────────────────────────────────────
function makeDeps(overrides: {
  logFn?:           ReturnType<typeof vi.fn>;
  checkIdempotency?: ReturnType<typeof vi.fn>;
  getSendHistory?:  ReturnType<typeof vi.fn>;
  send?:            ReturnType<typeof vi.fn>;
  gateCheck?:       ReturnType<typeof vi.fn>;
} = {}) {
  const mockLogs = {
    log:              overrides.logFn           ?? vi.fn().mockResolvedValue({ id: "log-id-1", duplicate: false }),
    checkIdempotency: overrides.checkIdempotency ?? vi.fn().mockResolvedValue(false),
    getSendHistory:   overrides.getSendHistory   ?? vi.fn().mockResolvedValue({ resendCount: 0, lastSentAt: null }),
  } as any;
  const mockWp   = { send: overrides.send      ?? vi.fn().mockResolvedValue({ status: "ENVIADO", provider: "uazapiGO", messageId: "msg-1" }) } as any;
  const mockGate = { check: overrides.gateCheck ?? vi.fn().mockReturnValue({ allowed: true }) } as any;
  return { mockLogs, mockWp, mockGate };
}

function setupProductionDb(overrides: {
  eventConfig?: Record<string, unknown> | null;
  modeRow?:     Record<string, unknown> | null;
  template?:    Record<string, unknown> | null;
  customer?:    Record<string, unknown> | null;
  pcclient?:    Record<string, unknown> | null;
} = {}) {
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return "eventConfig" in overrides ? overrides.eventConfig : { ativo_mensagem: 1, modo_envio: "PRODUCAO", telefones_teste: null };
    if (sql.includes("MONT_SYNC_CONFIG"))        return "modeRow"     in overrides ? overrides.modeRow     : { config_value: "PRODUCAO" };
    if (sql.includes("MONT_MSG_TEMPLATES"))       return "template"    in overrides ? overrides.template    : { id: "tmpl-001", body: "Olá {{nome}}, pedido {{numped}}.", active: 1, send_hour_start: 8, send_hour_end: 21 };
    if (sql.includes("MONT_CUSTOMERS"))           return "customer"    in overrides ? overrides.customer    : { phone: "11999990000", opt_out_whatsapp: 0 };
    if (sql.includes("PCCLIENT"))                 return "pcclient"    in overrides ? overrides.pcclient    : { telcelent: null, telent: null };
    return null;
  });
}

function setupDryRunDb() {
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 1, modo_envio: "PRODUCAO", telefones_teste: null };
    if (sql.includes("MONT_SYNC_CONFIG"))        return { config_value: "DRY_RUN" };
    if (sql.includes("MONT_MSG_TEMPLATES"))       return { id: "tmpl-001", body: "Olá {{nome}}", active: 1, send_hour_start: 8, send_hour_end: 21 };
    return null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("MessageTriggerService — Deduplicação de Mensagens", () => {

  beforeEach(() => { vi.clearAllMocks(); });

  // ─── Grupo 1: DRY_RUN ─────────────────────────────────────────────────────
  describe("Modo DRY_RUN — com deduplicação (corrigido)", () => {

    it("primeiro disparo retorna SIMULADO_DRY_RUN", async () => {
      setupDryRunDb();
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("SIMULADO_DRY_RUN");
    });

    it("segundo disparo com mesmo (numped, eventKey) em DRY_RUN retorna IGNORADO_DUPLICIDADE", async () => {
      setupDryRunDb();
      const checkIdempotency = vi.fn()
        .mockResolvedValueOnce(false)  // primeiro disparo — não bloqueado
        .mockResolvedValueOnce(true);  // segundo disparo — já simulado
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r1 = await svc.process(baseEvent, baseSnapshot);
      const r2 = await svc.process(baseEvent, baseSnapshot);

      expect(r1.status).toBe("SIMULADO_DRY_RUN");
      expect(r2.status).toBe("IGNORADO_DUPLICIDADE");
    });

    it("checkIdempotency é chamado com mode='DRY_RUN' e chave sem event.id", async () => {
      setupDryRunDb();
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process({ ...baseEvent, id: "evt-qualquer" }, baseSnapshot);

      expect(checkIdempotency).toHaveBeenCalledWith("fluxo:99999:PEDIDO_CRIADO", "DRY_RUN");
    });

    it("log de DRY_RUN inclui idempotencyKey para persistência da deduplicação", async () => {
      setupDryRunDb();
      const logFn = vi.fn().mockResolvedValue({ id: "log-dry", duplicate: false });
      const { mockLogs, mockWp, mockGate } = makeDeps({ logFn });
      mockLogs.log = logFn;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process(baseEvent, baseSnapshot);

      expect(logFn).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: "fluxo:99999:PEDIDO_CRIADO",
        status:         "SIMULADO_DRY_RUN",
      }));
    });

    it("NÃO chama o provider WhatsApp em DRY_RUN", async () => {
      setupDryRunDb();
      const send = vi.fn().mockResolvedValue({ status: "SIMULADO" });
      const { mockLogs, mockGate } = makeDeps({ send });
      const mockWp = { send } as any;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process(baseEvent, baseSnapshot);
      expect(send).not.toHaveBeenCalled();
    });
  });

  // ─── Grupo 2: Idempotência por (numped, eventKey) — corrigido ────────────
  describe("Idempotência por (numped, eventKey) — modo PRODUCAO", () => {

    it("mesmo tipo de evento processado duas vezes → segundo é IGNORADO_DUPLICIDADE", async () => {
      setupProductionDb();
      const checkIdempotency = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r1 = await svc.process(baseEvent, baseSnapshot);
      const r2 = await svc.process(baseEvent, baseSnapshot);

      expect(r1.status).toBe("ENVIADO");
      expect(r2.status).toBe("IGNORADO_DUPLICIDADE");
    });

    it("chave de idempotência é fluxo:numped:eventKey — sem event.id", async () => {
      setupProductionDb();
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process({ ...baseEvent, id: "evt-qualquer" }, baseSnapshot);

      expect(checkIdempotency).toHaveBeenCalledWith("fluxo:99999:PEDIDO_CRIADO");
      expect(checkIdempotency).not.toHaveBeenCalledWith(expect.stringContaining(":evt-"));
    });

    it("dois disparos do mesmo tipo com IDs distintos → segundo bloqueado pela mesma chave", async () => {
      setupProductionDb();
      const checkIdempotency = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r1 = await svc.process({ ...baseEvent, id: "evt-AAA" }, baseSnapshot);
      const r2 = await svc.process({ ...baseEvent, id: "evt-BBB" }, baseSnapshot);

      expect(r1.status).toBe("ENVIADO");
      expect(r2.status).toBe("IGNORADO_DUPLICIDADE");

      expect(checkIdempotency.mock.calls[0][0]).toBe("fluxo:99999:PEDIDO_CRIADO");
      expect(checkIdempotency.mock.calls[1][0]).toBe("fluxo:99999:PEDIDO_CRIADO");
    });

    it("ORA-00001 no log (duplicate=true) também retorna IGNORADO_DUPLICIDADE", async () => {
      setupProductionDb();
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const getSendHistory   = vi.fn().mockResolvedValue({ resendCount: 0, lastSentAt: null });
      const logFn            = vi.fn().mockResolvedValue({ id: "log-dup", duplicate: true });
      const mockLogs = { checkIdempotency, getSendHistory, log: logFn } as any;
      const { mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("IGNORADO_DUPLICIDADE");
    });
  });

  // ─── Grupo 3: Resend — RESEND_ALLOWED / MAX_RESENDS / RESEND_AFTER_H ─────
  describe("Resend — RESEND_ALLOWED / MAX_RESENDS / RESEND_AFTER_H (corrigido)", () => {

    it("SQL de template agora inclui RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H", async () => {
      const templateSpy = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 1, modo_envio: "PRODUCAO", telefones_teste: null };
        if (sql.includes("MONT_SYNC_CONFIG"))        return { config_value: "PRODUCAO" };
        if (sql.includes("MONT_MSG_TEMPLATES")) {
          expect(sql).toContain("RESEND_ALLOWED");
          expect(sql).toContain("MAX_RESENDS");
          expect(sql).toContain("RESEND_AFTER_H");
          return { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21, resend_allowed: 0, max_resends: 0, resend_after_h: null };
        }
        if (sql.includes("MONT_CUSTOMERS")) return { phone: "11999990000", opt_out_whatsapp: 0 };
        return null;
      });
      mockQueryOne.mockImplementation(templateSpy);

      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process(baseEvent, baseSnapshot);
    });

    it("template com RESEND_ALLOWED=0: segundo envio retorna IGNORADO_DUPLICIDADE com razão", async () => {
      setupProductionDb({ template: { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21, resend_allowed: 0, max_resends: 0, resend_after_h: null } });
      const checkIdempotency = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      await svc.process(baseEvent, baseSnapshot);
      const r2 = await svc.process(baseEvent, baseSnapshot);

      expect(r2.status).toBe("IGNORADO_DUPLICIDADE");
      expect(r2.reason).toContain("reenvio não permitido");
    });

    it("template com RESEND_ALLOWED=1 e MAX_RESENDS=1: primeiro reenvio usa chave :r1", async () => {
      const resendTemplate = { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21, resend_allowed: 1, max_resends: 1, resend_after_h: 24 };
      setupProductionDb({ template: resendTemplate });

      const checkIdempotency = vi.fn().mockResolvedValue(true);
      const getSendHistory   = vi.fn().mockResolvedValue({ resendCount: 0, lastSentAt: new Date(Date.now() - 25 * 3_600_000) });
      const logFn            = vi.fn().mockResolvedValue({ id: "log-r1", duplicate: false });
      const mockLogs = { checkIdempotency, getSendHistory, log: logFn } as any;
      const { mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("ENVIADO");

      expect(logFn).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: "fluxo:99999:PEDIDO_CRIADO:r1",
      }));
    });

    it("MAX_RESENDS atingido → IGNORADO_DUPLICIDADE", async () => {
      const resendTemplate = { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21, resend_allowed: 1, max_resends: 1, resend_after_h: 24 };
      setupProductionDb({ template: resendTemplate });

      const checkIdempotency = vi.fn().mockResolvedValue(true);
      const getSendHistory   = vi.fn().mockResolvedValue({ resendCount: 1, lastSentAt: new Date(Date.now() - 30 * 3_600_000) });
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency, getSendHistory });
      mockLogs.checkIdempotency = checkIdempotency;
      mockLogs.getSendHistory   = getSendHistory;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("IGNORADO_DUPLICIDADE");
      expect(r.reason).toContain("Limite de 1 reenvio");
    });

    it("intervalo de reenvio não atingido → IGNORADO_DUPLICIDADE com horas restantes", async () => {
      const resendTemplate = { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21, resend_allowed: 1, max_resends: 3, resend_after_h: 48 };
      setupProductionDb({ template: resendTemplate });

      const checkIdempotency = vi.fn().mockResolvedValue(true);
      const getSendHistory   = vi.fn().mockResolvedValue({ resendCount: 0, lastSentAt: new Date(Date.now() - 10 * 3_600_000) });
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency, getSendHistory });
      mockLogs.checkIdempotency = checkIdempotency;
      mockLogs.getSendHistory   = getSendHistory;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("IGNORADO_DUPLICIDADE");
      expect(r.reason).toContain("Intervalo de reenvio não atingido");
      expect(r.reason).toContain("48h");
    });
  });

  // ─── Grupo 5: Opt-out ─────────────────────────────────────────────────────
  describe("Opt-out (modo PRODUCAO)", () => {

    it("cliente com OPT_OUT_WHATSAPP=1 retorna IGNORADO_OPT_OUT", async () => {
      setupProductionDb({ customer: { phone: "11999990000", opt_out_whatsapp: 1 } });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("IGNORADO_OPT_OUT");
    });

    it("opt-out bypass é ignorado em DRY_RUN — short-circuit antes da resolução de telefone", async () => {
      setupDryRunDb();
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      // Mesmo que cliente fosse opt-out, em DRY_RUN o retorno é SIMULADO antes disso
      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("SIMULADO_DRY_RUN");
    });

    it("cliente sem telefone em MONT_CUSTOMERS nem PCCLIENT retorna IGNORADO_SEM_TELEFONE", async () => {
      setupProductionDb({
        customer: { phone: null, opt_out_whatsapp: 0 },
        pcclient: { telcelent: null, telent: null },
      });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("IGNORADO_SEM_TELEFONE");
    });

    it("fallback para PCCLIENT quando MONT_CUSTOMERS não tem telefone", async () => {
      setupProductionDb({
        customer: { phone: null, opt_out_whatsapp: 0 },
        pcclient: { telcelent: "11888880099", telent: null },
      });
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const { mockLogs, mockWp, mockGate } = makeDeps({ checkIdempotency });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("ENVIADO");
    });
  });

  // ─── Grupo 6: Evento e template inativos ──────────────────────────────────
  describe("Evento e template inativos", () => {

    it("ATIVO_MENSAGEM=0 retorna IGNORADO_EVENTO_INATIVO", async () => {
      mockQueryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 0, modo_envio: "PRODUCAO", telefones_teste: null };
        return null;
      });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_EVENTO_INATIVO");
    });

    it("evento config ausente (null) retorna IGNORADO_EVENTO_INATIVO", async () => {
      mockQueryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return null;
        return null;
      });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_EVENTO_INATIVO");
    });

    it("ACTIVE=0 no template retorna IGNORADO_TEMPLATE_INATIVO", async () => {
      setupProductionDb({ template: { id: "t1", body: "corpo", active: 0, send_hour_start: null, send_hour_end: null } });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_TEMPLATE_INATIVO");
    });

    it("template ausente (null) retorna IGNORADO_TEMPLATE_INATIVO", async () => {
      setupProductionDb({ template: null });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_TEMPLATE_INATIVO");
    });
  });

  // ─── Grupo 7: Dispatch Gate ───────────────────────────────────────────────
  describe("Dispatch Gate — horário e feriados", () => {

    it("fora do horário configurado retorna IGNORADO_REGRA_NAO_VALIDADA", async () => {
      setupProductionDb();
      const gateCheck = vi.fn().mockReturnValue({ allowed: false, reason: "Fora do horário de envio (08:00–21:00)" });
      const { mockLogs, mockWp } = makeDeps({ gateCheck });
      const mockGate = { check: gateCheck } as any;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_REGRA_NAO_VALIDADA");
    });

    it("gate liberado em horário válido permite o envio", async () => {
      setupProductionDb();
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const gateCheck = vi.fn().mockReturnValue({ allowed: true });
      const { mockLogs, mockWp } = makeDeps({ checkIdempotency, gateCheck });
      mockLogs.checkIdempotency = checkIdempotency;
      const mockGate = { check: gateCheck } as any;
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("ENVIADO");
    });
  });

  // ─── Grupo 8: Modo HOMOLOGACAO ────────────────────────────────────────────
  describe("Modo HOMOLOGACAO — redirecionamento para telefone de teste", () => {

    it("envia para o primeiro número de TELEFONES_TESTE, não para o real", async () => {
      mockQueryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 1, modo_envio: "HOMOLOGACAO", telefones_teste: "11888880001, 11888880002" };
        if (sql.includes("MONT_SYNC_CONFIG"))        return { config_value: "HOMOLOGACAO" };
        if (sql.includes("MONT_MSG_TEMPLATES"))       return { id: "t1", body: "Olá {{nome}}", active: 1, send_hour_start: 8, send_hour_end: 21 };
        if (sql.includes("MONT_CUSTOMERS"))           return { phone: "11999990000", opt_out_whatsapp: 0 };
        return null;
      });
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const send             = vi.fn().mockResolvedValue({ status: "ENVIADO", provider: "uazapiGO", messageId: "msg-hom" });
      const { mockLogs, mockGate } = makeDeps({ checkIdempotency, send });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, { send } as any, mockGate);

      const r = await svc.process(baseEvent, baseSnapshot);
      expect(r.status).toBe("ENVIADO");
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "11888880001" }));
      expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ to: "11999990000" }));
    });

    it("opt-out do cliente é ignorado em HOMOLOGACAO — número de teste tem precedência", async () => {
      mockQueryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 1, modo_envio: "HOMOLOGACAO", telefones_teste: "11888880001" };
        if (sql.includes("MONT_SYNC_CONFIG"))        return { config_value: "HOMOLOGACAO" };
        if (sql.includes("MONT_MSG_TEMPLATES"))       return { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21 };
        if (sql.includes("MONT_CUSTOMERS"))           return { phone: "11999990000", opt_out_whatsapp: 1 }; // opted out
        return null;
      });
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const send             = vi.fn().mockResolvedValue({ status: "ENVIADO" });
      const { mockLogs, mockGate } = makeDeps({ checkIdempotency, send });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, { send } as any, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("ENVIADO");
    });

    it("HOMOLOGACAO sem telefone de teste configurado retorna IGNORADO_SEM_TELEFONE", async () => {
      mockQueryOne.mockImplementation(async (sql: string) => {
        if (sql.includes("MONT_FLUXO_EVENT_CONFIG")) return { ativo_mensagem: 1, modo_envio: "HOMOLOGACAO", telefones_teste: "" };
        if (sql.includes("MONT_SYNC_CONFIG"))        return { config_value: "HOMOLOGACAO" };
        if (sql.includes("MONT_MSG_TEMPLATES"))       return { id: "t1", body: "Olá", active: 1, send_hour_start: 8, send_hour_end: 21 };
        if (sql.includes("MONT_CUSTOMERS"))           return { phone: "11999990000", opt_out_whatsapp: 0 };
        return null;
      });
      const { mockLogs, mockWp, mockGate } = makeDeps();
      const svc = new MessageTriggerService(mockLogs, mockWp, mockGate);

      expect((await svc.process(baseEvent, baseSnapshot)).status).toBe("IGNORADO_SEM_TELEFONE");
    });
  });

  // ─── Grupo 9: Renderização de template ───────────────────────────────────
  describe("Renderização de template", () => {

    it("substitui variáveis {{nome}} e {{numped}} corretamente", async () => {
      setupProductionDb({ template: { id: "t1", body: "Olá {{nome}}, seu pedido {{numped}} foi criado.", active: 1, send_hour_start: 8, send_hour_end: 21 } });
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const send             = vi.fn().mockResolvedValue({ status: "ENVIADO" });
      const { mockLogs, mockGate } = makeDeps({ checkIdempotency, send });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, { send } as any, mockGate);

      await svc.process(baseEvent, baseSnapshot);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        text: "Olá Cliente Teste, seu pedido 99999 foi criado.",
      }));
    });

    it("variável desconhecida permanece com placeholder {{var}}", async () => {
      setupProductionDb({ template: { id: "t1", body: "Código: {{codigoDesconhecido}}", active: 1, send_hour_start: 8, send_hour_end: 21 } });
      const checkIdempotency = vi.fn().mockResolvedValue(false);
      const send             = vi.fn().mockResolvedValue({ status: "ENVIADO" });
      const { mockLogs, mockGate } = makeDeps({ checkIdempotency, send });
      mockLogs.checkIdempotency = checkIdempotency;
      const svc = new MessageTriggerService(mockLogs, { send } as any, mockGate);

      await svc.process(baseEvent, baseSnapshot);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        text: "Código: {{codigoDesconhecido}}",
      }));
    });
  });
});
