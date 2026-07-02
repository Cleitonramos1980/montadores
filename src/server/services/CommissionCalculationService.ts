import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows } from "../db/db";
import { isOracleEnabled } from "../db/oracle";
import { WinthorPedidoItemRepository } from "../oracle/WinthorPedidoItemRepository";
import { AuditService } from "./AuditService";

export type CalcItemRow = {
  id: string;
  payment_id: string;
  numped: string;
  codprod: string;
  descricao: string | null;
  unidade: string | null;
  qt_vendida: number;
  pvenda: number;
  valor_base: number;
  calculation_type: string | null;
  fixed_amount: number | null;
  percentage_rate: number | null;
  commission_amount: number;
  rule_id: string | null;
  note: string | null;
};

type CommissionRule = {
  id: string;
  codprod: string;
  calculation_type: string;
  commission_percent: number;
  fixed_amount: number | null;
};

export type CalcResult = {
  paymentId: string;
  numped: string;
  totalCommission: number;
  itemsCalculated: number;
  itemsSemRegra: number;
  items: CalcItemRow[];
  dataSource: "winthor_pcpedi" | "sem_dados_oracle";
};

export class CommissionCalculationService {
  constructor(
    private readonly itemRepo = new WinthorPedidoItemRepository(),
    private readonly audit   = new AuditService(),
  ) {}

  async calculateForPayment(paymentId: string, userId?: string): Promise<CalcResult> {
    const payment = await queryOne<{
      id: string; status: string; amount: number;
      assembly_job_id: string; order_id: string;
      numped: string; codcli: string; provider_id: string;
    }>(
      `SELECT p.ID, p.STATUS, p.AMOUNT, p.PROVIDER_ID, p.ASSEMBLY_JOB_ID,
              a.ORDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_PROVIDER_PAYMENTS p
       JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE p.ID = :id`,
      { id: paymentId },
    );
    if (!payment) throw new AppError("Pagamento não encontrado.", 404, "NOT_FOUND");
    if (payment.status === "PAGO") throw new Error("Pagamento já realizado. Recálculo não permitido automaticamente.");

    // Load active commission rules into a map by CODPROD
    const rules = await queryRows<CommissionRule>(
      `SELECT ID, CODPROD, CALCULATION_TYPE, COMMISSION_PERCENT, FIXED_AMOUNT
       FROM MONT_PRODUCT_COMMISSIONS
       WHERE ACTIVE = 1`,
    );
    const ruleMap = new Map<string, CommissionRule>();
    for (const r of rules) ruleMap.set(String(r.codprod), r);

    const calcItems: CalcItemRow[] = [];
    let totalCommission = 0;
    let dataSource: CalcResult["dataSource"] = "sem_dados_oracle";

    if (isOracleEnabled()) {
      const pcpediItems = await this.itemRepo.getItems(payment.numped);
      dataSource = "winthor_pcpedi";

      for (const item of pcpediItems) {
        const codprod = String(item.codprod);
        const qt      = Number(item.qt ?? 0);
        const pvenda  = Number(item.pvenda ?? 0);
        const rule    = ruleMap.get(codprod);

        if (!rule) {
          calcItems.push({
            id: uuid(), payment_id: paymentId, numped: payment.numped,
            codprod, descricao: item.descricao ?? null, unidade: item.unidade ?? null,
            qt_vendida: qt, pvenda, valor_base: 0,
            calculation_type: null, fixed_amount: null, percentage_rate: null,
            commission_amount: 0, rule_id: null,
            note: "Produto sem comissão configurada",
          });
          continue;
        }

        let commissionAmount = 0;
        let valorBase = 0;

        if (rule.calculation_type === "FIXED_AMOUNT") {
          const fixedAmt = Number(rule.fixed_amount ?? 0);
          commissionAmount = qt * fixedAmt;
          valorBase        = qt;
        } else {
          // PERCENTAGE
          valorBase        = qt * pvenda;
          commissionAmount = valorBase * (Number(rule.commission_percent) / 100);
        }

        totalCommission += commissionAmount;
        calcItems.push({
          id: uuid(), payment_id: paymentId, numped: payment.numped,
          codprod, descricao: item.descricao ?? null, unidade: item.unidade ?? null,
          qt_vendida: qt, pvenda, valor_base: valorBase,
          calculation_type: rule.calculation_type,
          fixed_amount: rule.calculation_type === "FIXED_AMOUNT" ? Number(rule.fixed_amount) : null,
          percentage_rate: rule.calculation_type === "PERCENTAGE" ? Number(rule.commission_percent) : null,
          commission_amount: commissionAmount,
          rule_id: rule.id, note: null,
        });
      }
    }

    // Delete previous calc items for this payment
    await execDml("DELETE FROM MONT_COMMISSION_CALC_ITEMS WHERE PAYMENT_ID = :pid", { pid: paymentId });

    // Insert new calc items
    for (const item of calcItems) {
      await execDml(
        `INSERT INTO MONT_COMMISSION_CALC_ITEMS
           (ID, PAYMENT_ID, NUMPED, CODPROD, DESCRICAO, UNIDADE,
            QT_VENDIDA, PVENDA, VALOR_BASE,
            CALCULATION_TYPE, FIXED_AMOUNT, PERCENTAGE_RATE,
            COMMISSION_AMOUNT, RULE_ID, NOTE)
         VALUES
           (:id, :paymentId, :numped, :codprod, :descricao, :unidade,
            :qtVendida, :pvenda, :valorBase,
            :calculationType, :fixedAmount, :percentageRate,
            :commissionAmount, :ruleId, :note)`,
        {
          id:              item.id,
          paymentId:       item.payment_id,
          numped:          item.numped,
          codprod:         item.codprod,
          descricao:       item.descricao,
          unidade:         item.unidade,
          qtVendida:       item.qt_vendida,
          pvenda:          item.pvenda,
          valorBase:       item.valor_base,
          calculationType: item.calculation_type,
          fixedAmount:     item.fixed_amount,
          percentageRate:  item.percentage_rate,
          commissionAmount: item.commission_amount,
          ruleId:          item.rule_id,
          note:            item.note,
        },
      );
    }

    // Update payment AMOUNT only when we had real PCPEDI data and found items with commission
    if (dataSource === "winthor_pcpedi" && calcItems.length > 0) {
      await execDml(
        "UPDATE MONT_PROVIDER_PAYMENTS SET AMOUNT = :amount, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { amount: totalCommission, id: paymentId },
      );
    }

    await this.audit.log({
      actorUserId: userId,
      action:      "COMMISSION_RECALCULATED",
      entityType:  "provider_payment",
      entityId:    paymentId,
      previous:    { amount: payment.amount },
      next:        { amount: totalCommission, dataSource, items: calcItems.length },
    });

    const itemsCalculated = calcItems.filter((i) => i.commission_amount > 0).length;
    const itemsSemRegra   = calcItems.filter((i) => i.note === "Produto sem comissão configurada").length;

    return { paymentId, numped: payment.numped, totalCommission, itemsCalculated, itemsSemRegra, items: calcItems, dataSource };
  }

  async getCalcItems(paymentId: string): Promise<CalcItemRow[]> {
    return queryRows<CalcItemRow>(
      `SELECT * FROM MONT_COMMISSION_CALC_ITEMS WHERE PAYMENT_ID = :pid ORDER BY CODPROD`,
      { pid: paymentId },
    );
  }
}
