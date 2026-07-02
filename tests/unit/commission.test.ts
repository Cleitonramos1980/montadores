import { describe, expect, it } from "vitest";

// Pure calculation logic extracted for testing — no DB dependency
type Rule = { calculation_type: string; commission_percent: number; fixed_amount: number | null };

function calcItemCommission(valorBase: number, rule: Rule): number {
  if (rule.calculation_type === "FIXED" && rule.fixed_amount != null) {
    return rule.fixed_amount;
  }
  return parseFloat(((valorBase * rule.commission_percent) / 100).toFixed(2));
}

function totalCommission(items: Array<{ valorBase: number; rule: Rule }>): number {
  return parseFloat(items.reduce((sum, i) => sum + calcItemCommission(i.valorBase, i.rule), 0).toFixed(2));
}

describe("commission calculation logic", () => {
  const pctRule: Rule = { calculation_type: "PERCENTAGE", commission_percent: 10, fixed_amount: null };
  const fixedRule: Rule = { calculation_type: "FIXED", commission_percent: 0, fixed_amount: 150 };

  it("percentage rule calculates correctly", () => {
    expect(calcItemCommission(1000, pctRule)).toBe(100);
    expect(calcItemCommission(250, pctRule)).toBe(25);
  });

  it("fixed rule ignores valorBase", () => {
    expect(calcItemCommission(9999, fixedRule)).toBe(150);
    expect(calcItemCommission(0, fixedRule)).toBe(150);
  });

  it("rounds to 2 decimal places", () => {
    const rule: Rule = { calculation_type: "PERCENTAGE", commission_percent: 7, fixed_amount: null };
    expect(calcItemCommission(100, rule)).toBe(7);
    expect(calcItemCommission(333.33, rule)).toBe(23.33);
  });

  it("total aggregates multiple items", () => {
    const items = [
      { valorBase: 1000, rule: pctRule },   // 100
      { valorBase: 500,  rule: pctRule },   // 50
      { valorBase: 200,  rule: fixedRule }, // 150
    ];
    expect(totalCommission(items)).toBe(300);
  });

  it("zero base with percentage yields zero commission", () => {
    expect(calcItemCommission(0, pctRule)).toBe(0);
  });

  it("handles empty item list", () => {
    expect(totalCommission([])).toBe(0);
  });
});
