/**
 * Testes unitários do marco de FATURAMENTO (billing milestone).
 *
 * Causa raiz coberta: a fase FATURADO_AGUARDANDO_SAIDA é transiente (DTFAT preenchida,
 * DTSAIDA ainda nula). Quando o polling captura o pedido já adiantado (ex.: FINALIZADO),
 * o evento linear da fase pula o faturamento. OrderSnapshotService.upsert agora detecta a
 * transição de DATA_FATURAMENTO (null → preenchida) e sinaliza billingJustHappened para que
 * o PedidoFluxoSyncService emita o evento/mensagem de faturamento explicitamente.
 *
 * Regras validadas:
 *  1. Transição null → preenchida em pedido EXISTENTE ⇒ billingJustHappened = true.
 *  2. DATA_FATURAMENTO já estava preenchida ⇒ false (não redispara).
 *  3. Pedido NOVO (isNew) já faturado ⇒ false (evita spam de back-fill histórico).
 *  4. Sem faturamento (row.data_faturamento null) ⇒ false.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/db/db", () => ({
  queryOne: vi.fn(),
  queryRows: vi.fn().mockResolvedValue([]),
  execDml:  vi.fn().mockResolvedValue(undefined),
}));

import { queryOne, execDml } from "../server/db/db";
import { OrderSnapshotService } from "../server/services/OrderSnapshotService";
import type { WinthorPedidoRow } from "../server/oracle/WinthorPedidoStatusRepository";

const mockQueryOne = vi.mocked(queryOne);
const mockExecDml  = vi.mocked(execDml);

function makeRow(overrides: Partial<WinthorPedidoRow> = {}): WinthorPedidoRow {
  return {
    numped:                  "77777",
    data_digitacao:          new Date("2026-06-01"),
    codcli:                  "347818",
    nome_cliente:            "Cliente Teste",
    codfilial:               "1",
    condvenda:               8,
    posicao:                 "F",
    status_pedido:           "FATURADO",
    data_emissao_mapa:       new Date("2026-06-02"),
    data_inicio_conferencia: new Date("2026-06-03"),
    data_fim_conferencia:    new Date("2026-06-03"),
    numnota:                 "123456",
    data_faturamento:        new Date("2026-06-04"),
    data_saida_nota:         null,
    fluxo_status:            "5 - FATURADO/AGUARDANDO SAIDA",
    fluxo_event_key:         "FATURADO_AGUARDANDO_SAIDA",
    func_emissao_mapa:       null,
    cod_separador:           null,
    cod_conferente:          null,
    faturado_por:            null,
    ...overrides,
  };
}

describe("OrderSnapshotService — marco de faturamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecDml.mockResolvedValue(undefined);
  });

  it("transição DATA_FATURAMENTO null → preenchida em pedido existente ⇒ billingJustHappened = true", async () => {
    // Pedido já existia em fase anterior, sem faturamento, e pulou direto para FINALIZADO
    mockQueryOne.mockResolvedValue({
      fluxo_event_key_atual: "CONFERIDO_AGUARDANDO_FATURAMENTO",
      data_faturamento:      null,
    } as any);

    const svc = new OrderSnapshotService();
    const row = makeRow({ fluxo_event_key: "FINALIZADO", data_saida_nota: new Date("2026-06-04") });
    const res = await svc.upsert(row);

    expect(res.isNew).toBe(false);
    expect(res.billingJustHappened).toBe(true);
    expect(res.changed).toBe(true);
  });

  it("DATA_FATURAMENTO já estava preenchida ⇒ não redispara (false)", async () => {
    mockQueryOne.mockResolvedValue({
      fluxo_event_key_atual: "FATURADO_AGUARDANDO_SAIDA",
      data_faturamento:      new Date("2026-06-04"),
    } as any);

    const svc = new OrderSnapshotService();
    const res = await svc.upsert(makeRow({ fluxo_event_key: "FINALIZADO" }));

    expect(res.billingJustHappened).toBe(false);
  });

  it("pedido NOVO já faturado ⇒ false (evita back-fill de histórico)", async () => {
    mockQueryOne.mockResolvedValue(null); // não existe snapshot anterior

    const svc = new OrderSnapshotService();
    const res = await svc.upsert(makeRow());

    expect(res.isNew).toBe(true);
    expect(res.billingJustHappened).toBe(false);
  });

  it("pedido sem faturamento (data_faturamento null) ⇒ false", async () => {
    mockQueryOne.mockResolvedValue({
      fluxo_event_key_atual: "EM_SEPARACAO_CONFERENCIA",
      data_faturamento:      null,
    } as any);

    const svc = new OrderSnapshotService();
    const res = await svc.upsert(makeRow({
      fluxo_event_key:  "CONFERIDO_AGUARDANDO_FATURAMENTO",
      data_faturamento: null,
      data_saida_nota:  null,
    }));

    expect(res.billingJustHappened).toBe(false);
  });
});
