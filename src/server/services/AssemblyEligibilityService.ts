import { queryRows } from "../db/db";
import { isOracleEnabled } from "../db/oracle";
import { features } from "../config";
import { WinthorPedidoItemRepository } from "../oracle/WinthorPedidoItemRepository";
import { EventService } from "./EventService";

export type EligibleProduct = {
  codprod: string;
  descricao: string | null;
  quantity: number;
  pvenda: number;
  unidade: string | null;
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
    private readonly events = new EventService(),
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
         FROM MONT_PRODUCT_COMMISSIONS WHERE ACTIVE = 1
         AND (VIGENCIA_INICIO IS NULL OR VIGENCIA_INICIO <= SYSDATE)
         AND (VIGENCIA_FIM IS NULL OR VIGENCIA_FIM >= SYSDATE)`,
      ),
      queryRows<DeptRule>(
        `SELECT ID, CODEPTO, CALCULATION_TYPE, COMMISSION_PERCENT, FIXED_AMOUNT
         FROM MONT_DEPT_COMMISSIONS WHERE ACTIVE = 1
         AND (VIGENCIA_INICIO IS NULL OR VIGENCIA_INICIO <= SYSDATE)
         AND (VIGENCIA_FIM IS NULL OR VIGENCIA_FIM >= SYSDATE)`,
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
      const deptRule = (features.deptCommissionRules && codepto) ? deptRuleMap.get(codepto) : undefined;
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
        pvenda,
        unidade: item.unidade ?? null,
        ruleSource: prodRule ? "product" : "department",
        ruleId: rule.id,
        calculationType: rule.calculation_type,
        commissionPercent: Number(rule.commission_percent),
        fixedAmount: rule.fixed_amount != null ? Number(rule.fixed_amount) : null,
        estimatedCommission,
      });
    }

    const result: EligibilityResult = {
      numped,
      eligible: eligibleProducts.length > 0,
      eligibleProducts,
      ineligibleProducts,
      totalEstimatedCommission,
      dataSource: "winthor_pcpedi",
    };

    await this.events.emit({
      type: "ORDER_ELIGIBILITY_CHECKED",
      numped,
      origin: "SISTEMA",
      metadata: {
        eligible: result.eligible,
        eligibleCount: eligibleProducts.length,
        ineligibleCount: ineligibleProducts.length,
        totalEstimatedCommission,
        dataSource: result.dataSource,
      },
      idempotencyKey: `eligibility:${numped}:${Date.now()}`,
    }).catch(() => {}); // observability — não bloqueia fluxo principal

    return result;
  }
}
