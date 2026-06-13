import { queryRows } from "../db/db";
import { isOracleEnabled } from "../db/oracle";
import { WinthorPedidoItemRepository } from "../oracle/WinthorPedidoItemRepository";

export type EligibleProduct = {
  codprod: string;
  descricao: string | null;
  quantity: number;
  ruleSource: "product" | "department";
  ruleId: string;
  calculationType: string;
  commissionPercent: number;
  fixedAmount: number | null;
  estimatedCommission: number;
};

export type IneligibleProduct = {
  codprod: string;
  descricao: string | null;
};

export type EligibilityResult = {
  numped: string;
  eligible: boolean;
  eligibleProducts: EligibleProduct[];
  ineligibleProducts: IneligibleProduct[];
  totalEstimatedCommission: number;
  dataSource: "winthor_pcpedi" | "oracle_disabled";
};

type ProductRule = {
  id: string;
  codprod: string;
  calculation_type: string;
  commission_percent: number;
  fixed_amount: number | null;
};

type DeptRule = {
  id: string;
  codepto: string;
  calculation_type: string;
  commission_percent: number;
  fixed_amount: number | null;
};

type ProdutRow = {
  codprod: string;
  codepto: string | null;
};

export class AssemblyEligibilityService {
  constructor(
    private readonly itemRepo = new WinthorPedidoItemRepository(),
  ) {}

  async checkEligibility(numped: string): Promise<EligibilityResult> {
    if (!isOracleEnabled()) {
      return {
        numped,
        eligible: true,
        eligibleProducts: [],
        ineligibleProducts: [],
        totalEstimatedCommission: 0,
        dataSource: "oracle_disabled",
      };
    }

    const [items, productRules, deptRules] = await Promise.all([
      this.itemRepo.getItems(numped),
      queryRows<ProductRule>(
        `SELECT ID, CODPROD, CALCULATION_TYPE, COMMISSION_PERCENT, FIXED_AMOUNT
         FROM MONT_PRODUCT_COMMISSIONS WHERE ACTIVE = 1`,
      ),
      queryRows<DeptRule>(
        `SELECT ID, CODEPTO, CALCULATION_TYPE, COMMISSION_PERCENT, FIXED_AMOUNT
         FROM MONT_DEPT_COMMISSIONS WHERE ACTIVE = 1`,
      ),
    ]);

    const productRuleMap = new Map(productRules.map((r) => [String(r.codprod), r]));
    const deptRuleMap    = new Map(deptRules.map((r) => [String(r.codepto), r]));

    // Fetch department for each product in this order (via PCPRODUT)
    const codprods = [...new Set(items.map((i) => String(i.codprod)))];
    let produtMap = new Map<string, string>(); // codprod → codepto
    if (codprods.length > 0) {
      const produtRows = await queryRows<ProdutRow>(
        `SELECT TO_CHAR(CODPROD) AS CODPROD, TO_CHAR(CODEPTO) AS CODEPTO
         FROM PCPRODUT
         WHERE CODPROD IN (${codprods.map((_, i) => `:cp${i}`).join(",")})`,
        Object.fromEntries(codprods.map((cp, i) => [`cp${i}`, cp])),
      );
      produtMap = new Map(produtRows.map((r) => [String(r.codprod), String(r.codepto ?? "")]));
    }

    const eligibleProducts: EligibleProduct[] = [];
    const ineligibleProducts: IneligibleProduct[] = [];
    let totalEstimatedCommission = 0;

    for (const item of items) {
      const codprod  = String(item.codprod);
      const codepto  = produtMap.get(codprod) ?? "";
      const prodRule = productRuleMap.get(codprod);
      const deptRule = codepto ? deptRuleMap.get(codepto) : undefined;
      const rule     = prodRule ?? deptRule;

      if (!rule) {
        ineligibleProducts.push({ codprod, descricao: item.descricao ?? null });
        continue;
      }

      const qt     = Number(item.qt ?? 0);
      const pvenda = Number(item.pvenda ?? 0);
      let estimatedCommission = 0;

      if (rule.calculation_type === "FIXED_AMOUNT") {
        estimatedCommission = qt * Number(rule.fixed_amount ?? 0);
      } else {
        estimatedCommission = qt * pvenda * (Number(rule.commission_percent) / 100);
      }

      totalEstimatedCommission += estimatedCommission;
      eligibleProducts.push({
        codprod,
        descricao: item.descricao ?? null,
        quantity: qt,
        ruleSource: prodRule ? "product" : "department",
        ruleId: rule.id,
        calculationType: rule.calculation_type,
        commissionPercent: Number(rule.commission_percent),
        fixedAmount: rule.fixed_amount != null ? Number(rule.fixed_amount) : null,
        estimatedCommission,
      });
    }

    return {
      numped,
      eligible: eligibleProducts.length > 0,
      eligibleProducts,
      ineligibleProducts,
      totalEstimatedCommission,
      dataSource: "winthor_pcpedi",
    };
  }
}
