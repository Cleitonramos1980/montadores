import { queryRows } from "../db/db";

export type WinthorPedidoRow = {
  numped: string;
  data_digitacao: Date | null;
  codcli: string;
  nome_cliente: string;
  codfilial: string;
  condvenda: number;
  posicao: string | null;
  status_pedido: string | null;
  data_emissao_mapa: Date | null;
  data_inicio_conferencia: Date | null;
  data_fim_conferencia: Date | null;
  numnota: string | null;
  data_faturamento: Date | null;
  data_saida_nota: Date | null;
  fluxo_status: string;
  fluxo_event_key: string;
  func_emissao_mapa: string | null;
  cod_separador: string | null;
  cod_conferente: string | null;
  faturado_por: string | null;
};

export type PedidoQueryParams = {
  dataInicioPedido: Date;
  dataFimPedido: Date;
  condvenda?: number;
  codfilial?: string | null;
  numped?: string | null;
  posicao?: string | null;
};

export class WinthorPedidoStatusRepository {
  async query(params: PedidoQueryParams): Promise<WinthorPedidoRow[]> {
    const binds: Record<string, unknown> = {
      dataInicioPedido: params.dataInicioPedido,
      dataFimPedido:    params.dataFimPedido,
      condvenda:        params.condvenda ?? 8,
    };

    // Build optional WHERE clauses
    const extras: string[] = [];
    if (params.codfilial) { extras.push("AND P.CODFILIAL = :codfilial"); binds.codfilial = params.codfilial; }
    if (params.numped)    { extras.push("AND P.NUMPED = :numped");     binds.numped = params.numped; }
    if (params.posicao)   { extras.push("AND P.POSICAO = :posicao");   binds.posicao = params.posicao; }

    const extraSql = extras.join("\n    ");

    const sql = `
WITH NF_BASE AS (
  SELECT
    NF.NUMPED,
    NF.CONDVENDA,
    MAX(NF.NUMNOTA) KEEP (DENSE_RANK LAST ORDER BY NVL(NF.DTFAT, DATE '1900-01-01'), NF.NUMNOTA) AS NUMNOTA,
    MAX(NF.DTFAT)   AS DTFAT,
    MAX(NF.DTSAIDA) AS DTSAIDA,
    MAX(NF.FUNCLANC) KEEP (DENSE_RANK LAST ORDER BY NVL(NF.DTFAT, DATE '1900-01-01'), NF.NUMNOTA) AS FUNCLANC
  FROM PCNFSAID NF
  GROUP BY NF.NUMPED, NF.CONDVENDA
)
SELECT
  P.NUMPED,
  P.DATA           AS DATA_DIGITACAO,
  P.CODCLI,
  C.CLIENTE        AS NOME_CLIENTE,
  P.CODFILIAL,
  P.CONDVENDA,
  P.POSICAO,
  DECODE(P.POSICAO, 'L','LIBERADO', 'M','MONTADO', 'F','FATURADO', 'P','PENDENTE', P.POSICAO) AS STATUS_PEDIDO,
  P.DTEMISSAOMAPA    - (1/24) AS DATA_EMISSAO_MAPA,
  P.DTINICIALCHECKOUT- (1/24) AS DATA_INICIO_CONFERENCIA,
  P.DTFINALCHECKOUT  - (1/24) AS DATA_FIM_CONFERENCIA,
  NF.NUMNOTA,
  NF.DTFAT         AS DATA_FATURAMENTO,
  NF.DTSAIDA       AS DATA_SAIDA_NOTA,
  CASE
    WHEN P.DTEMISSAOMAPA IS NULL         THEN '1 - AGUARDANDO MAPA/ESTOQUE'
    WHEN P.DTINICIALCHECKOUT IS NULL     THEN '2 - MAPA EMITIDO/AGUARDANDO SEPARACAO'
    WHEN P.DTFINALCHECKOUT IS NULL       THEN '3 - EM SEPARACAO/CONFERENCIA'
    WHEN NF.DTFAT IS NULL                THEN '4 - CONFERIDO/AGUARDANDO FATURAMENTO'
    WHEN NF.DTSAIDA IS NULL              THEN '5 - FATURADO/AGUARDANDO SAIDA'
    ELSE                                      '6 - FINALIZADO'
  END AS FLUXO_STATUS,
  CASE
    WHEN P.DTEMISSAOMAPA IS NULL         THEN 'AGUARDANDO_MAPA_ESTOQUE'
    WHEN P.DTINICIALCHECKOUT IS NULL     THEN 'MAPA_EMITIDO_AGUARDANDO_SEPARACAO'
    WHEN P.DTFINALCHECKOUT IS NULL       THEN 'EM_SEPARACAO_CONFERENCIA'
    WHEN NF.DTFAT IS NULL                THEN 'CONFERIDO_AGUARDANDO_FATURAMENTO'
    WHEN NF.DTSAIDA IS NULL              THEN 'FATURADO_AGUARDANDO_SAIDA'
    ELSE                                      'FINALIZADO'
  END AS FLUXO_EVENT_KEY,
  P.CODFUNCEMISSAOMAPA AS FUNC_EMISSAO_MAPA,
  P.CODFUNCSEP         AS COD_SEPARADOR,
  P.CODFUNCCONF        AS COD_CONFERENTE,
  NF.FUNCLANC          AS FATURADO_POR
FROM PCPEDC P
INNER JOIN PCCLIENT C ON C.CODCLI = P.CODCLI
LEFT JOIN NF_BASE NF ON (NF.NUMPED = P.NUMPED AND NF.CONDVENDA = P.CONDVENDA)
WHERE P.CONDVENDA = :condvenda
  -- Inclui o pedido se a digitação OU qualquer transição de fase (mapa, separação,
  -- conferência, faturamento, saída) caiu na janela. Antes filtrava só por P.DATA
  -- (digitação): pedido que evoluía após N dias nunca mais era sincronizado, perdendo
  -- eventos/mensagens. O sync é idempotente (diff de snapshot), então incluir mais
  -- pedidos não gera eventos duplicados.
  AND (
       (P.DATA              >= :dataInicioPedido AND P.DATA              < :dataFimPedido + 1)
    OR (P.DTEMISSAOMAPA     >= :dataInicioPedido AND P.DTEMISSAOMAPA     < :dataFimPedido + 1)
    OR (P.DTINICIALCHECKOUT >= :dataInicioPedido AND P.DTINICIALCHECKOUT < :dataFimPedido + 1)
    OR (P.DTFINALCHECKOUT   >= :dataInicioPedido AND P.DTFINALCHECKOUT   < :dataFimPedido + 1)
    OR (NF.DTFAT            >= :dataInicioPedido AND NF.DTFAT            < :dataFimPedido + 1)
    OR (NF.DTSAIDA          >= :dataInicioPedido AND NF.DTSAIDA          < :dataFimPedido + 1)
  )
  ${extraSql}
ORDER BY P.DATA DESC, P.NUMPED DESC`;

    return queryRows<WinthorPedidoRow>(sql, binds);
  }
}
