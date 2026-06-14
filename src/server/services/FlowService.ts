import { eventTypes } from "../../shared/domain";
import { queryRows } from "../db/db";

const customerFacing = new Set([
  "PEDIDO_CRIADO",
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "FATURADO",
  "SAIU_PARA_ENTREGA",
  "ENTREGA_REALIZADA",
  "MONTAGEM_NECESSARIA",
  "MONTAGEM_AGENDADA",
  "MONTAGEM_INICIADA",
  "MONTAGEM_FINALIZADA",
  "AVALIACAO_CLIENTE_RECEBIDA",
  "SAC_CASO_ABERTO",
  "PAGAMENTO_LIBERADO",
]);

const CUSTOMER_FACING_STEPS = [
  "PEDIDO_CRIADO",
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "FATURADO",
  "SAIU_PARA_ENTREGA",
  "ENTREGA_REALIZADA",
  "MONTAGEM_NECESSARIA",
  "MONTAGEM_AGENDADA",
  "MONTAGEM_INICIADA",
  "MONTAGEM_FINALIZADA",
  "AVALIACAO_CLIENTE_RECEBIDA",
  "SAC_CASO_ABERTO",
  "PAGAMENTO_LIBERADO",
] as const;

export class FlowService {
  async rulerStats(): Promise<{ eventType: string; count: number }[]> {
    // Early-pipeline steps sourced directly from WinThor tables for accurate counts.
    // Montagem steps come from MONT_ORDER_EVENTS (app-managed).
    const [winthorRows, eventRows] = await Promise.all([
      queryRows<{ step_type: string; cnt: number }>(
        `SELECT 'PEDIDO_CRIADO' AS STEP_TYPE, COUNT(*) AS CNT FROM PCPEDC
         UNION ALL
         SELECT 'SEPARACAO_INICIADA', COUNT(*) FROM PCPEDC WHERE TRIM(POSICAO) IN ('E','Q','F')
         UNION ALL
         SELECT 'CONFERENCIA_FINALIZADA', COUNT(*) FROM PCPEDC WHERE TRIM(POSICAO) IN ('Q','F')
         UNION ALL
         SELECT 'FATURADO', COUNT(*) FROM PCPEDC WHERE TRIM(POSICAO) = 'F'
         UNION ALL
         SELECT 'SAIU_PARA_ENTREGA', COUNT(DISTINCT p.NUMPED)
           FROM PCPEDC p JOIN PCCARREG c ON c.NUMCAR = p.NUMCAR
           WHERE c.DTSAIDA IS NOT NULL AND p.NUMCAR IS NOT NULL
         UNION ALL
         SELECT 'ENTREGA_REALIZADA', COUNT(DISTINCT n.NUMPED)
           FROM PCNFSAID n WHERE n.DTCANHOTO IS NOT NULL`,
      ),
      queryRows<{ type: string; cnt: number }>(
        `SELECT e.TYPE, COUNT(DISTINCT e.NUMPED) AS CNT
         FROM MONT_ORDER_EVENTS e
         WHERE e.TYPE IN ('MONTAGEM_NECESSARIA','MONTAGEM_AGENDADA','MONTAGEM_INICIADA',
                          'MONTAGEM_FINALIZADA','AVALIACAO_CLIENTE_RECEBIDA',
                          'SAC_CASO_ABERTO','PAGAMENTO_LIBERADO')
         GROUP BY e.TYPE`,
      ),
    ]);

    const countMap = new Map<string, number>();
    for (const r of winthorRows) countMap.set(r.step_type, Number(r.cnt));
    for (const r of eventRows) countMap.set(r.type, Number(r.cnt));

    return CUSTOMER_FACING_STEPS.map((et) => ({ eventType: et, count: countMap.get(et) ?? 0 }));
  }

  async ruler() {
    const orders = await queryRows<{
      id: string;
      numped: string;
      current_status: string;
      customer_name: string;
      created_at: string;
    }>(
      `SELECT o.ID, o.NUMPED, o.CURRENT_STATUS, c.NAME AS CUSTOMER_NAME, o.CREATED_AT
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       ORDER BY o.CREATED_AT DESC
       FETCH FIRST 50 ROWS ONLY`,
    );

    return Promise.all(
      orders.map(async (order) => {
        const events = await queryRows<{
          type: string;
          origin: string;
          created_at: string;
          title?: string;
          description?: string;
        }>(
          `SELECT e.TYPE, e.ORIGIN, e.CREATED_AT, t.TITLE, t.DESCRIPTION
           FROM MONT_ORDER_EVENTS e
           LEFT JOIN MONT_ORDER_TIMELINE t ON t.EVENT_ID = e.ID
           WHERE e.NUMPED = :numped
           ORDER BY e.CREATED_AT ASC`,
          { numped: order.numped },
        );

        const occurred = new Set(events.map((e) => e.type));
        return {
          ...order,
          progress: eventTypes
            .filter((et) => customerFacing.has(et))
            .map((et) => ({
              eventType: et,
              done: occurred.has(et),
              sentToCustomer: events.some((e) => e.type === et && e.origin !== "SISTEMA"),
              occurredAt: events.find((e) => e.type === et)?.created_at ?? null,
            })),
          history: events,
        };
      }),
    );
  }
}
