import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercita o CommissionCalculationService REAL (não uma cópia da lógica).
// As dependências de banco (db/db, db/oracle) são mockadas como nos demais
// testes unitários; o repositório de itens do WinThor e a auditoria são
// injetados via construtor para não tocar no Oracle real.
vi.mock("../../src/server/db/db", () => ({
  queryOne:  vi.fn(),
  queryRows: vi.fn(),
  execDml:   vi.fn(),
}));
vi.mock("../../src/server/db/oracle", () => ({
  isOracleEnabled: vi.fn(() => true),
}));

import { CommissionCalculationService } from "../../src/server/services/CommissionCalculationService";
import { queryOne, queryRows } from "../../src/server/db/db";

type Rule = {
  id: string;
  codprod: string;
  calculation_type: "PERCENTAGE" | "FIXED_AMOUNT";
  commission_percent: number;
  fixed_amount: number | null;
};
type Item = { codprod: string; qt: number; pvenda: number };

const PAYMENT = {
  id: "pay-1", status: "PENDENTE", amount: 0,
  provider_id: "prov-1", assembly_job_id: "job-1", order_id: "ord-1",
  numped: "12345", codcli: "999",
};

// Prepara os mocks: pagamento (queryOne) + regras ativas (queryRows).
function stubDb(rules: Rule[]) {
  vi.mocked(queryOne).mockResolvedValue(PAYMENT as never);
  vi.mocked(queryRows).mockResolvedValue(rules as never);
}

// Cria o serviço com repositório de itens e auditoria dublados.
function makeService(items: Item[]) {
  const itemRepo = { getItems: vi.fn().mockResolvedValue(items) };
  const audit = { log: vi.fn().mockResolvedValue("audit-id") };
  return new CommissionCalculationService(itemRepo as never, audit as never);
}

describe("CommissionCalculationService.calculateForPayment", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("aplica regra percentual sobre qt * pvenda", async () => {
    stubDb([
      { id: "r1", codprod: "100", calculation_type: "PERCENTAGE", commission_percent: 10, fixed_amount: null },
    ]);
    const svc = makeService([{ codprod: "100", qt: 1, pvenda: 1000 }]);

    const res = await svc.calculateForPayment("pay-1");

    expect(res.dataSource).toBe("winthor_pcpedi");
    expect(res.itemsCalculated).toBe(1);
    expect(res.itemsSemRegra).toBe(0);
    expect(res.totalCommission).toBeCloseTo(100, 2);
    const item = res.items.find((i) => i.codprod === "100")!;
    expect(item.calculation_type).toBe("PERCENTAGE");
    expect(item.valor_base).toBeCloseTo(1000, 2);
    expect(item.commission_amount).toBeCloseTo(100, 2);
  });

  it("aplica regra de valor fixo multiplicada pela quantidade", async () => {
    stubDb([
      { id: "r2", codprod: "200", calculation_type: "FIXED_AMOUNT", commission_percent: 0, fixed_amount: 150 },
    ]);
    const svc = makeService([{ codprod: "200", qt: 2, pvenda: 9999 }]);

    const res = await svc.calculateForPayment("pay-1");

    const item = res.items.find((i) => i.codprod === "200")!;
    expect(item.calculation_type).toBe("FIXED_AMOUNT");
    // Valor fixo ignora pvenda; base é a quantidade e o total é qt * fixed_amount.
    expect(item.commission_amount).toBeCloseTo(300, 2);
    expect(res.totalCommission).toBeCloseTo(300, 2);
  });

  it("soma comissões de múltiplos itens ao nível de centavos", async () => {
    stubDb([
      { id: "r1", codprod: "100", calculation_type: "PERCENTAGE",   commission_percent: 10,  fixed_amount: null },
      { id: "r3", codprod: "300", calculation_type: "PERCENTAGE",   commission_percent: 7.5, fixed_amount: null },
      { id: "r2", codprod: "200", calculation_type: "FIXED_AMOUNT", commission_percent: 0,   fixed_amount: 15.5 },
    ]);
    const items: Item[] = [
      { codprod: "100", qt: 3, pvenda: 9.99 },  // base 29.97 * 10%  = 2.997
      { codprod: "300", qt: 1, pvenda: 100 },   // base 100   * 7.5% = 7.50
      { codprod: "200", qt: 2, pvenda: 40 },    // fixo 15.5  * 2     = 31.00
    ];
    const svc = makeService(items);

    const res = await svc.calculateForPayment("pay-1");

    const expected = (3 * 9.99) * 0.10 + 100 * 0.075 + 2 * 15.5; // 41.497
    expect(res.items).toHaveLength(3);
    expect(res.itemsCalculated).toBe(3);
    expect(res.totalCommission).toBeCloseTo(expected, 2);
  });

  it("marca item sem regra de comissão sem somar valor", async () => {
    stubDb([
      { id: "r1", codprod: "100", calculation_type: "PERCENTAGE", commission_percent: 10, fixed_amount: null },
    ]);
    const svc = makeService([
      { codprod: "100", qt: 1, pvenda: 500 },   // 50.00
      { codprod: "888", qt: 1, pvenda: 999 },   // sem regra
    ]);

    const res = await svc.calculateForPayment("pay-1");

    expect(res.itemsSemRegra).toBe(1);
    const semRegra = res.items.find((i) => i.codprod === "888")!;
    expect(semRegra.commission_amount).toBe(0);
    expect(semRegra.rule_id).toBeNull();
    expect(semRegra.note).toBe("Produto sem comissão configurada");
    expect(res.totalCommission).toBeCloseTo(50, 2);
  });
});
