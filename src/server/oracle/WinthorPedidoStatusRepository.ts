import { queryRows, queryOne } from "../db/db";

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
  private readonly phaseCase = `CASE
    WHEN P.DTEMISSAOMAPA IS NULL     THEN 'AGUARDANDO_MAPA_ESTOQUE'
    WHEN P.DTINICIALCHECKOUT IS NULL THEN 'MAPA_EMITIDO_AGUARDANDO_SEPARACAO'
    WHEN P.DTFINALCHECKOUT IS NULL   THEN 'EM_SEPARACAO_CONFERENCIA'
    WHEN NF.DTFAT IS NULL            THEN 'CONFERIDO_AGUARDANDO_FATURAMENTO'
    WHEN NF.DTSAIDA IS NULL          THEN 'FATURADO_AGUARDANDO_SAIDA'
    ELSE                                  'FINALIZADO'
  END`;

  private readonly nfBase = `WITH NF_BASE AS (
  SELECT NF.NUMPED, NF.CONDVENDA,
    MAX(NF.NUMNOTA) KEEP (DENSE_RANK LAST ORDER BY NVL(NF.DTFAT, DATE '1900-01-01'), NF.NUMNOTA) AS NUMNOTA,
    MAX(NF.DTFAT)   AS DTFAT,
    MAX(NF.DTSAIDA) AS DTSAIDA
  FROM PCNFSAID NF
  GROUP BY NF.NUMPED, NF.CONDVENDA
)`;

  // Fases 5-6 → só POSICAO='F'; fases 1-4 → exclui POSICAO IN ('F','C')
  private posicaoFilter(phaseKey: string): string {
    return ['FATURADO_AGUARDANDO_SAIDA', 'FINALIZADO'].includes(phaseKey)
      ? "AND POSICAO = 'F'"
      : "AND POSICAO NOT IN ('F', 'C')";
  }

  private posicaoFilterRaw(phaseKey: string): string {
    return ['FATURADO_AGUARDANDO_SAIDA', 'FINALIZADO'].includes(phaseKey)
      ? "AND P.POSICAO = 'F'"
      : "AND P.POSICAO NOT IN ('F', 'C')";
  }

  async queryByPhase(
    condvenda: number,
    daysBack: number,
    phaseKey: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const binds = { condvenda, daysBack, phaseKey, offset, pageSize };
    const bindsCnt = { condvenda, daysBack, phaseKey };
    const pf  = this.posicaoFilter(phaseKey);
    const pfr = this.posicaoFilterRaw(phaseKey);

    const [rows, countRow] = await Promise.all([
      queryRows<Record<string, unknown>>(
        `${this.nfBase},
CLASSIFIED AS (
  SELECT P.NUMPED, P.CODCLI, C.CLIENTE AS NOME_CLIENTE, P.CODFILIAL,
         NVL(P.POSICAO, '-') AS POSICAO,
         P.DATA           AS DATA_DIGITACAO,
         P.DTEMISSAOMAPA  AS DATA_EMISSAO_MAPA,
         NF.NUMNOTA, SYSDATE AS ULTIMA_SINCRONIZACAO,
         ${this.phaseCase} AS FLUXO_STATUS_ATUAL
  FROM PCPEDC P
  INNER JOIN PCCLIENT C ON C.CODCLI = P.CODCLI
  LEFT JOIN NF_BASE NF ON (NF.NUMPED = P.NUMPED AND NF.CONDVENDA = P.CONDVENDA)
  WHERE P.DATA >= TRUNC(SYSDATE) - :daysBack
    AND P.CONDVENDA = :condvenda
)
SELECT NUMPED, CODCLI, NOME_CLIENTE, CODFILIAL, POSICAO,
       DATA_DIGITACAO, DATA_EMISSAO_MAPA, NUMNOTA, ULTIMA_SINCRONIZACAO, FLUXO_STATUS_ATUAL
FROM CLASSIFIED
WHERE FLUXO_STATUS_ATUAL = :phaseKey
  ${pf}
ORDER BY DATA_DIGITACAO DESC, NUMPED DESC
OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        binds,
      ),
      queryOne<{ total: number }>(
        `${this.nfBase}
SELECT COUNT(*) AS TOTAL
FROM PCPEDC P
LEFT JOIN NF_BASE NF ON (NF.NUMPED = P.NUMPED AND NF.CONDVENDA = P.CONDVENDA)
WHERE P.DATA >= TRUNC(SYSDATE) - :daysBack
  AND P.CONDVENDA = :condvenda
  AND ${this.phaseCase} = :phaseKey
  ${pfr}`,
        bindsCnt,
      ),
    ]);

    return { rows, total: Number(countRow?.total ?? 0) };
  }

  async countsByPhase(condvenda: number, daysBack: number): Promise<Array<{ fluxo_event_key: string; cnt: number }>> {
    const sql = `
WITH NF_BASE AS (
  SELECT NF.NUMPED, NF.CONDVENDA,
    MAX(NF.DTFAT)   AS DTFAT,
    MAX(NF.DTSAIDA) AS DTSAIDA
  FROM PCNFSAID NF
  GROUP BY NF.NUMPED, NF.CONDVENDA
),
CLASSIFIED AS (
  SELECT NVL(P.POSICAO, '-') AS POSICAO,
    CASE
      WHEN P.DTEMISSAOMAPA IS NULL     THEN 'AGUARDANDO_MAPA_ESTOQUE'
      WHEN P.DTINICIALCHECKOUT IS NULL THEN 'MAPA_EMITIDO_AGUARDANDO_SEPARACAO'
      WHEN P.DTFINALCHECKOUT IS NULL   THEN 'EM_SEPARACAO_CONFERENCIA'
      WHEN NF.DTFAT IS NULL            THEN 'CONFERIDO_AGUARDANDO_FATURAMENTO'
      WHEN NF.DTSAIDA IS NULL          THEN 'FATURADO_AGUARDANDO_SAIDA'
      ELSE                                  'FINALIZADO'
    END AS FLUXO_EVENT_KEY
  FROM PCPEDC P
  LEFT JOIN NF_BASE NF ON (NF.NUMPED = P.NUMPED AND NF.CONDVENDA = P.CONDVENDA)
  WHERE P.DATA >= TRUNC(SYSDATE) - :daysBack
    AND P.CONDVENDA = :condvenda
)
SELECT FLUXO_EVENT_KEY, COUNT(*) AS CNT
FROM CLASSIFIED
WHERE
  (FLUXO_EVENT_KEY IN ('AGUARDANDO_MAPA_ESTOQUE', 'MAPA_EMITIDO_AGUARDANDO_SEPARACAO',
                        'EM_SEPARACAO_CONFERENCIA', 'CONFERIDO_AGUARDANDO_FATURAMENTO')
   AND POSICAO NOT IN ('F', 'C'))
  OR
  (FLUXO_EVENT_KEY IN ('FATURADO_AGUARDANDO_SAIDA', 'FINALIZADO')
   AND POSICAO = 'F')
GROUP BY FLUXO_EVENT_KEY`;
    return queryRows<{ fluxo_event_key: string; cnt: number }>(sql, { condvenda, daysBack });
  }

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
WHERE P.DATA >= :dataInicioPedido
  AND P.DATA < :dataFimPedido + 1
  AND P.CONDVENDA = :condvenda
  ${extraSql}
ORDER BY P.DATA DESC, P.NUMPED DESC`;

    return queryRows<WinthorPedidoRow>(sql, binds);
  }
}
