import { queryRows, queryOne } from "../db/db";

export type AgendaCandidatoRow = {
  order_id: string | null;
  numped: string;
  codcli: string;
  nome_cliente: string;
  telefone: string | null;
  codfilial: string | null;
  numcar: string | null;
  numnota: string | null;
  data_faturamento: Date | null;
  data_saida_nota: Date | null;
  data_entrega_confirmada: Date | null;
  current_status: string | null;
  has_assembly: number | null;
  status_agenda: string | null;
  convite_enviado: number;
  data_envio_convite: Date | null;
  montagem_agendada: number;
};

export type AgendaQueryParams = {
  daysBack?: number;
  somenteEntregues?: boolean;
  somenteComMontagem?: boolean;
  codfilial?: string | null;
  numped?: string | null;
};

export class WinthorAgendaRepository {
  /**
   * Fonte: PCPEDC (WinThor) — sem filtro de VLMAODEOBRA.
   * Detecção de montagem via MONT_ORDERS.HAS_ASSEMBLY = 1 (se o pedido já foi sincronizado).
   * Sem MONT_ORDERS match: somenteComMontagem=false mostra o pedido; true o omite.
   * DTFECHA (PCCARREG) é o único gatilho de entrega confirmada.
   */
  async queryByMontOrders(params: AgendaQueryParams): Promise<AgendaCandidatoRow[]> {
    const daysBack           = params.daysBack ?? 60;
    const somenteEntregues   = params.somenteEntregues !== false;
    const somenteComMontagem = params.somenteComMontagem !== false;

    const extras: string[] = [];
    const binds: Record<string, unknown> = { daysBack };

    if (params.codfilial) { extras.push("AND P.CODFILIAL = :codfilial"); binds.codfilial = params.codfilial; }
    if (params.numped)    { extras.push("AND P.NUMPED    = :numped");    binds.numped    = params.numped; }
    if (somenteEntregues) { extras.push("AND CAR.DTFECHA IS NOT NULL"); }

    // Dois caminhos para detectar montagem:
    // 1) MONT_ORDERS.HAS_ASSEMBLY=1 (pedido já sincronizado)
    // 2) EXISTS produto com VLMAODEOBRA > 0 via PCPEDI (pedido não sincronizado ainda)
    if (somenteComMontagem) {
      extras.push(`AND (MO.HAS_ASSEMBLY = 1 OR EXISTS (
        SELECT 1 FROM PCPEDI I
        JOIN PCPRODUT PR ON PR.CODPROD = I.CODPROD
        WHERE I.NUMPED = P.NUMPED AND PR.VLMAODEOBRA > 0
      ))`);
    }

    const extraSql = extras.join("\n    ");

    const sql = `
WITH NF_BASE AS (
  SELECT
    NUMPED,
    MAX(NUMNOTA) KEEP (DENSE_RANK LAST ORDER BY NVL(DTFAT, DATE '1900-01-01'), NUMNOTA) AS NUMNOTA,
    MAX(DTFAT)   AS DTFAT,
    MAX(DTSAIDA) AS DTSAIDA
  FROM PCNFSAID
  GROUP BY NUMPED
)
SELECT
  MO.ID                                       AS ORDER_ID,
  TO_CHAR(P.NUMPED)                           AS NUMPED,
  TO_CHAR(P.CODCLI)                           AS CODCLI,
  C.CLIENTE                                   AS NOME_CLIENTE,
  COALESCE(C.TELCELENT, C.TELENT)             AS TELEFONE,
  P.CODFILIAL,
  TO_CHAR(P.NUMCAR)                           AS NUMCAR,
  NF.NUMNOTA,
  NF.DTFAT                                    AS DATA_FATURAMENTO,
  NF.DTSAIDA                                  AS DATA_SAIDA_NOTA,
  CAR.DTFECHA                                 AS DATA_ENTREGA_CONFIRMADA,
  MO.CURRENT_STATUS,
  MO.HAS_ASSEMBLY,
  CAND.STATUS_AGENDA,
  COALESCE(CAND.CONVITE_ENVIADO, 0)           AS CONVITE_ENVIADO,
  CAND.DATA_ENVIO_CONVITE,
  COALESCE(CAND.MONTAGEM_AGENDADA, 0)         AS MONTAGEM_AGENDADA
FROM PCPEDC P
INNER JOIN PCCLIENT C ON C.CODCLI = P.CODCLI
LEFT JOIN NF_BASE NF   ON NF.NUMPED  = P.NUMPED
LEFT JOIN PCCARREG CAR ON TO_CHAR(CAR.NUMCAR) = TO_CHAR(P.NUMCAR)
LEFT JOIN MONT_ORDERS MO   ON TO_CHAR(MO.NUMPED) = TO_CHAR(P.NUMPED)
LEFT JOIN MONT_AGENDA_CANDIDATOS CAND ON TO_CHAR(CAND.NUMPED) = TO_CHAR(P.NUMPED)
WHERE P.DATA >= TRUNC(SYSDATE) - :daysBack
  AND P.POSICAO NOT IN ('C')
  ${extraSql}
ORDER BY CAR.DTFECHA DESC NULLS LAST, P.DATA DESC
FETCH FIRST 200 ROWS ONLY`;

    return queryRows<AgendaCandidatoRow>(sql, binds);
  }

  async diagnostico(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    // 1. PCPEDC.NUMCAR
    try {
      await queryOne("SELECT NUMCAR FROM PCPEDC WHERE ROWNUM = 1");
      result.pcpedc_numcar = true;
    } catch (e) {
      result.pcpedc_numcar = (e as Error).message.includes("ORA-00904") ? "NÃO EXISTE" : (e as Error).message;
    }

    // 2. PCCARREG.DTFECHA
    try {
      await queryOne("SELECT DTFECHA FROM PCCARREG WHERE ROWNUM = 1");
      result.pccarreg_dtfecha = true;
    } catch (e) {
      result.pccarreg_dtfecha = (e as Error).message.includes("ORA-00904") ? "NÃO EXISTE" : (e as Error).message;
    }

    // 3. PCPRODUT.VLMAODEOBRA (informativo — não usado na query principal)
    try {
      await queryOne("SELECT VLMAODEOBRA FROM PCPRODUT WHERE ROWNUM = 1");
      result.pcprodut_vlmaodeobra = true;
    } catch (e) {
      result.pcprodut_vlmaodeobra = (e as Error).message.includes("ORA-00904") ? "NÃO EXISTE" : (e as Error).message;
    }

    // 4. MONT_ORDERS com HAS_ASSEMBLY=1 (detectados pelo sync do sistema)
    try {
      result.mont_orders_has_assembly = await queryOne(
        "SELECT COUNT(*) AS TOTAL FROM MONT_ORDERS WHERE HAS_ASSEMBLY = 1",
      );
    } catch (e) { result.mont_orders_has_assembly_erro = (e as Error).message; }

    // 5. Carregamentos fechados nos últimos 60 dias
    try {
      result.carregamentos_fechados_60d = await queryOne(
        "SELECT COUNT(*) AS TOTAL FROM PCCARREG WHERE DTFECHA >= TRUNC(SYSDATE) - 60",
      );
    } catch (e) { result.carregamentos_fechados_60d_erro = (e as Error).message; }

    // 6. Pedidos PCPEDC nos últimos 60 dias (total)
    try {
      result.pcpedc_total_60d = await queryOne(
        "SELECT COUNT(*) AS TOTAL FROM PCPEDC WHERE DATA >= TRUNC(SYSDATE) - 60 AND POSICAO NOT IN ('C')",
      );
    } catch (e) { result.pcpedc_total_60d_erro = (e as Error).message; }

    // 7. Pedidos PCPEDC com NUMCAR preenchido (últimos 60 dias)
    try {
      result.pcpedc_com_numcar_60d = await queryOne(
        "SELECT COUNT(*) AS TOTAL FROM PCPEDC WHERE DATA >= TRUNC(SYSDATE) - 60 AND NUMCAR IS NOT NULL AND POSICAO NOT IN ('C')",
      );
    } catch (e) { result.pcpedc_com_numcar_60d_erro = (e as Error).message; }

    // 8. Amostra do join PCPEDC→PCCARREG com DTFECHA preenchido
    try {
      result.amostra_join_dtfecha = await queryRows(
        `SELECT TO_CHAR(P.NUMPED) AS NUMPED, TO_CHAR(P.NUMCAR) AS NUMCAR, CAR.DTFECHA
         FROM PCPEDC P
         INNER JOIN PCCARREG CAR ON TO_CHAR(CAR.NUMCAR) = TO_CHAR(P.NUMCAR)
         WHERE CAR.DTFECHA IS NOT NULL
           AND P.DATA >= TRUNC(SYSDATE) - 60
         ORDER BY CAR.DTFECHA DESC
         FETCH FIRST 5 ROWS ONLY`,
      );
    } catch (e) { result.amostra_join_dtfecha_erro = (e as Error).message; }

    // 9. MONT_ORDERS com HAS_ASSEMBLY=1 + PCPEDC join (conta quantos batem)
    try {
      result.orders_join_pcpedc = await queryOne(
        `SELECT COUNT(*) AS TOTAL
         FROM MONT_ORDERS MO
         INNER JOIN PCPEDC P ON TO_CHAR(P.NUMPED) = TO_CHAR(MO.NUMPED)
         WHERE MO.HAS_ASSEMBLY = 1`,
      );
    } catch (e) { result.orders_join_pcpedc_erro = (e as Error).message; }

    // 10. Pedidos entregues (join completo sem filtro montagem) — últimos 60 dias
    try {
      result.entregues_sem_filtro_montagem = await queryRows(
        `SELECT TO_CHAR(P.NUMPED) AS NUMPED, TO_CHAR(P.NUMCAR) AS NUMCAR,
                CAR.DTFECHA, MO.HAS_ASSEMBLY
         FROM PCPEDC P
         INNER JOIN PCCLIENT C ON C.CODCLI = P.CODCLI
         LEFT JOIN PCCARREG CAR ON TO_CHAR(CAR.NUMCAR) = TO_CHAR(P.NUMCAR)
         LEFT JOIN MONT_ORDERS MO ON TO_CHAR(MO.NUMPED) = TO_CHAR(P.NUMPED)
         WHERE P.DATA >= TRUNC(SYSDATE) - 60
           AND P.POSICAO NOT IN ('C')
           AND CAR.DTFECHA IS NOT NULL
         ORDER BY CAR.DTFECHA DESC
         FETCH FIRST 5 ROWS ONLY`,
      );
    } catch (e) { result.entregues_sem_filtro_montagem_erro = (e as Error).message; }

    return result;
  }
}
