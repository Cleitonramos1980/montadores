import { queryRows } from "../db/db";

export type PedidoItemRow = {
  numped: string;
  numseq: number;
  codprod: string;
  qt: number;
  pvenda: number;
  posicao: string | null;
  descricao: string | null;
  unidade: string | null;
};

export class WinthorPedidoItemRepository {
  /**
   * Returns PCPEDI items for a given order, joined with PCPRODUT for description/unit.
   * Excludes cancelled items (POSICAO = 'C').
   * Columns confirmed from WinthorAdapter.getOrderItems: QT, PVENDA, POSICAO, NUMSEQ.
   */
  async getItems(numped: string): Promise<PedidoItemRow[]> {
    return queryRows<PedidoItemRow>(
      `SELECT TO_CHAR(i.NUMPED) AS NUMPED, i.NUMSEQ, TO_CHAR(i.CODPROD) AS CODPROD,
              i.QT, i.PVENDA, i.POSICAO,
              p.DESCRICAO, p.UNIDADE
       FROM PCPEDI i
       LEFT JOIN PCPRODUT p ON p.CODPROD = i.CODPROD
       WHERE TO_CHAR(i.NUMPED) = TO_CHAR(:numped)
         AND NVL(i.POSICAO, 'A') != 'C'
       ORDER BY i.NUMSEQ`,
      { numped },
    );
  }
}
