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

export class FlowService {
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

  async rulerStats() {
    const rows = await queryRows<{ current_status: string; cnt: number }>(
      `SELECT CURRENT_STATUS, COUNT(*) AS CNT
       FROM MONT_ORDERS
       GROUP BY CURRENT_STATUS
       ORDER BY CNT DESC`,
    );
    return {
      byStatus: Object.fromEntries(rows.map((r) => [r.current_status, Number(r.cnt)])),
      total:    rows.reduce((acc, r) => acc + Number(r.cnt), 0),
    };
  }
}
