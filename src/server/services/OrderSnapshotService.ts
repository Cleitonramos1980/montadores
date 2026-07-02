import { execDml, queryOne, queryRows } from "../db/db";
import type { WinthorPedidoRow } from "../oracle/WinthorPedidoStatusRepository";
import { FLUXO_PHASES } from "./fluxoPhases";

export type OrderSnapshot = {
  numped: string;
  codcli: string;
  nome_cliente: string;
  codfilial: string;
  condvenda: number;
  posicao: string | null;
  status_pedido: string | null;
  fluxo_status_atual: string;
  fluxo_status_anterior: string | null;
  fluxo_event_key_atual: string;
  fluxo_event_key_anterior: string | null;
  data_digitacao: Date | null;
  data_emissao_mapa: Date | null;
  data_inicio_conferencia: Date | null;
  data_fim_conferencia: Date | null;
  numnota: string | null;
  data_faturamento: Date | null;
  data_saida_nota: Date | null;
  data_entrega_real: Date | null;
  func_emissao_mapa: string | null;
  cod_separador: string | null;
  cod_conferente: string | null;
  faturado_por: string | null;
  ultima_sincronizacao: Date;
  atualizado_em: Date;
};

export type UpsertResult = {
  isNew: boolean;
  previousKey: string | null;
  changed: boolean;
  /**
   * True when DATA_FATURAMENTO transitions from null → set on an EXISTING order.
   * The FATURADO_AGUARDANDO_SAIDA phase is transient (DTFAT set, DTSAIDA null) and is
   * frequently skipped by the polling sync — the order lands directly in FINALIZADO.
   * This flag lets the sync emit the billing milestone even when the linear phase jumped.
   * Only fires on transition (not on isNew) to avoid back-fill spam for historical orders.
   */
  billingJustHappened: boolean;
};

export class OrderSnapshotService {
  async upsert(row: WinthorPedidoRow): Promise<UpsertResult> {
    const existing = await queryOne<{ fluxo_event_key_atual: string | null; data_faturamento: Date | null }>(
      "SELECT FLUXO_EVENT_KEY_ATUAL, DATA_FATURAMENTO FROM MONT_ORDER_SNAPSHOTS WHERE NUMPED = :numped",
      { numped: String(row.numped) },
    );
    const isNew = existing === null;
    const previousKey = existing?.fluxo_event_key_atual ?? null;
    const previousDataFaturamento = existing?.data_faturamento ?? null;
    const billingJustHappened = !isNew && previousDataFaturamento == null && row.data_faturamento != null;

    await execDml(
      `MERGE INTO MONT_ORDER_SNAPSHOTS tgt
       USING DUAL ON (tgt.NUMPED = :numped)
       WHEN MATCHED THEN UPDATE SET
         CODCLI                    = :codcli,
         NOME_CLIENTE              = :nomeCliente,
         CODFILIAL                 = :codfilial,
         CONDVENDA                 = :condvenda,
         POSICAO                   = :posicao,
         STATUS_PEDIDO             = :statusPedido,
         FLUXO_STATUS_ANTERIOR     = tgt.FLUXO_STATUS_ATUAL,
         FLUXO_STATUS_ATUAL        = :fluxoStatusAtual,
         FLUXO_EVENT_KEY_ANTERIOR  = tgt.FLUXO_EVENT_KEY_ATUAL,
         FLUXO_EVENT_KEY_ATUAL     = :fluxoEventKeyAtual,
         DATA_DIGITACAO            = :dataDigitacao,
         DATA_EMISSAO_MAPA         = :dataEmissaoMapa,
         DATA_INICIO_CONFERENCIA   = :dataInicioConferencia,
         DATA_FIM_CONFERENCIA      = :dataFimConferencia,
         NUMNOTA                   = :numnota,
         DATA_FATURAMENTO          = :dataFaturamento,
         DATA_SAIDA_NOTA           = :dataSaidaNota,
         FUNC_EMISSAO_MAPA         = :funcEmissaoMapa,
         COD_SEPARADOR             = :codSeparador,
         COD_CONFERENTE            = :codConferente,
         FATURADO_POR              = :faturadoPor,
         ULTIMA_SINCRONIZACAO      = SYSTIMESTAMP,
         ATUALIZADO_EM             = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (
         NUMPED, CODCLI, NOME_CLIENTE, CODFILIAL, CONDVENDA, POSICAO,
         STATUS_PEDIDO, FLUXO_STATUS_ATUAL, FLUXO_EVENT_KEY_ATUAL,
         DATA_DIGITACAO, DATA_EMISSAO_MAPA, DATA_INICIO_CONFERENCIA,
         DATA_FIM_CONFERENCIA, NUMNOTA, DATA_FATURAMENTO, DATA_SAIDA_NOTA,
         FUNC_EMISSAO_MAPA, COD_SEPARADOR, COD_CONFERENTE, FATURADO_POR,
         ULTIMA_SINCRONIZACAO, ATUALIZADO_EM
       ) VALUES (
         :numped, :codcli, :nomeCliente, :codfilial, :condvenda, :posicao,
         :statusPedido, :fluxoStatusAtual, :fluxoEventKeyAtual,
         :dataDigitacao, :dataEmissaoMapa, :dataInicioConferencia,
         :dataFimConferencia, :numnota, :dataFaturamento, :dataSaidaNota,
         :funcEmissaoMapa, :codSeparador, :codConferente, :faturadoPor,
         SYSTIMESTAMP, SYSTIMESTAMP
       )`,
      {
        numped:              String(row.numped),
        codcli:              row.codcli ?? null,
        nomeCliente:         row.nome_cliente ?? null,
        codfilial:           row.codfilial ?? null,
        condvenda:           row.condvenda ?? null,
        posicao:             row.posicao ?? null,
        statusPedido:        row.status_pedido ?? null,
        fluxoStatusAtual:    row.fluxo_status,
        fluxoEventKeyAtual:  row.fluxo_event_key,
        dataDigitacao:       row.data_digitacao ?? null,
        dataEmissaoMapa:     row.data_emissao_mapa ?? null,
        dataInicioConferencia: row.data_inicio_conferencia ?? null,
        dataFimConferencia:  row.data_fim_conferencia ?? null,
        numnota:             row.numnota ?? null,
        dataFaturamento:     row.data_faturamento ?? null,
        dataSaidaNota:       row.data_saida_nota ?? null,
        funcEmissaoMapa:     row.func_emissao_mapa ?? null,
        codSeparador:        row.cod_separador ?? null,
        codConferente:       row.cod_conferente ?? null,
        faturadoPor:         row.faturado_por ?? null,
      },
    );

    return {
      isNew,
      previousKey,
      changed: isNew || previousKey !== row.fluxo_event_key,
      billingJustHappened,
    };
  }

  async findByNumped(numped: string): Promise<OrderSnapshot | null> {
    return queryOne<OrderSnapshot>(
      "SELECT * FROM MONT_ORDER_SNAPSHOTS WHERE NUMPED = :numped",
      { numped },
    );
  }

  async dashboardSummary(): Promise<Array<{ key: string; label: string; count: number; order: number }>> {
    const rows = await queryRows<{ fluxo_event_key_atual: string; cnt: number }>(
      `SELECT FLUXO_EVENT_KEY_ATUAL, COUNT(*) AS CNT
       FROM MONT_ORDER_SNAPSHOTS
       GROUP BY FLUXO_EVENT_KEY_ATUAL`,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.fluxo_event_key_atual, Number(r.cnt)]));
    return FLUXO_PHASES.map((p) => ({
      key:   p.key,
      label: p.label,
      count: byKey[p.key] ?? 0,
      order: p.order,
    }));
  }

  async listByPhase(
    fluxoKey: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ rows: OrderSnapshot[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryRows<OrderSnapshot>(
        `SELECT NUMPED, CODCLI, NOME_CLIENTE, CODFILIAL,
                POSICAO, FLUXO_STATUS_ATUAL, FLUXO_EVENT_KEY_ATUAL,
                DATA_DIGITACAO, DATA_EMISSAO_MAPA, NUMNOTA,
                DATA_FATURAMENTO, DATA_SAIDA_NOTA, ULTIMA_SINCRONIZACAO
         FROM MONT_ORDER_SNAPSHOTS
         WHERE FLUXO_EVENT_KEY_ATUAL = :fluxoKey
         ORDER BY ULTIMA_SINCRONIZACAO DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        { fluxoKey, offset, pageSize },
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS TOTAL FROM MONT_ORDER_SNAPSHOTS WHERE FLUXO_EVENT_KEY_ATUAL = :fluxoKey`,
        { fluxoKey },
      ),
    ]);
    return { rows, total: Number(countRow?.total ?? 0) };
  }

  async getDetail(numped: string): Promise<{
    snapshot: OrderSnapshot | null;
    events: unknown[];
    messages: unknown[];
  }> {
    const [snapshot, events, messages] = await Promise.all([
      this.findByNumped(numped),
      queryRows(
        `SELECT ID, EVENT_KEY, FLUXO_STATUS_ANTERIOR, FLUXO_STATUS_NOVO,
                FLUXO_EVENT_KEY_ANTERIOR, FLUXO_EVENT_KEY_NOVO, ORIGEM, CRIADO_EM
         FROM MONT_FLUXO_EVENTS WHERE NUMPED = :numped
         ORDER BY CRIADO_EM DESC
         FETCH FIRST 30 ROWS ONLY`,
        { numped },
      ),
      queryRows(
        `SELECT ID, EVENT_KEY, STATUS, DESTINO, CANAL, MODO_ENVIO, ENVIADO_EM, CRIADO_EM
         FROM MONT_MESSAGE_LOGS WHERE NUMPED = :numped
         ORDER BY CRIADO_EM DESC
         FETCH FIRST 30 ROWS ONLY`,
        { numped },
      ),
    ]);
    return { snapshot, events, messages };
  }
}
