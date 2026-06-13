import { queryOne, queryRows } from "../db/db";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function resolveProviderId(email: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email)",
    { email },
  );
  return row?.id ?? null;
}

function buildDateFilter(
  filters: HistoricoFilters,
  binds: Record<string, unknown>,
  col = "COALESCE(a.FINISHED_AT, a.STARTED_AT, a.CREATED_AT)",
): string {
  const parts: string[] = [];

  if (filters.periodo === "HOJE") {
    parts.push(`TRUNC(${col}) = TRUNC(SYSDATE)`);
  } else if (filters.periodo === "ONTEM") {
    parts.push(`TRUNC(${col}) = TRUNC(SYSDATE - 1)`);
  } else if (filters.periodo === "SEMANA") {
    parts.push(`${col} >= TRUNC(SYSDATE, 'IW')`);
  } else if (filters.periodo === "MES") {
    parts.push(`${col} >= TRUNC(SYSDATE, 'MM')`);
  } else if (filters.periodo === "PERSONALIZADO") {
    if (filters.dataInicio) {
      parts.push(`${col} >= TO_TIMESTAMP(:dataInicio, 'YYYY-MM-DD')`);
      binds.dataInicio = filters.dataInicio;
    }
    if (filters.dataFim) {
      parts.push(`${col} < TO_TIMESTAMP(:dataFim, 'YYYY-MM-DD') + 1`);
      binds.dataFim = filters.dataFim;
    }
  }
  return parts.map((p) => `AND ${p}`).join(" ");
}

// ─── types ────────────────────────────────────────────────────────────────────

export type HistoricoFilters = {
  periodo?: "HOJE" | "ONTEM" | "SEMANA" | "MES" | "PERSONALIZADO";
  dataInicio?: string;
  dataFim?: string;
  statusMontagem?: string;
  statusPagamento?: string;
  comReclamacao?: boolean;
  page?: number;
  pageSize?: number;
};

// ─── service ─────────────────────────────────────────────────────────────────

export class MontadorHistoricoService {

  async resumo(email: string, filters: HistoricoFilters = {}) {
    const providerId = await resolveProviderId(email);
    if (!providerId) return null;

    const binds: Record<string, unknown> = { providerId };
    const dateClause = buildDateFilter(filters, binds);

    const row = await queryOne<Record<string, unknown>>(
      `SELECT
         COUNT(DISTINCT a.ID)                                                     AS total_montagens,
         NVL(SUM(itens.total_qty), 0)                                             AS total_produtos,
         COUNT(DISTINCT o.CUSTOMER_ID)                                            AS total_clientes,
         SUM(CASE WHEN a.STATUS = 'FINALIZADA' THEN 1 ELSE 0 END)                AS finalizadas,
         SUM(CASE WHEN a.STATUS = 'CANCELADA'  THEN 1 ELSE 0 END)                AS canceladas,
         SUM(CASE WHEN r.CLASSIFICATION = 'POSITIVO' THEN 1 ELSE 0 END)          AS aprovadas,
         SUM(CASE WHEN r.COMPLAINT_REASON IS NOT NULL THEN 1 ELSE 0 END)         AS com_reclamacao,
         SUM(CASE WHEN r.ID IS NULL AND a.STATUS = 'FINALIZADA' THEN 1 ELSE 0 END) AS aguardando_avaliacao,
         SUM(CASE WHEN sac.STATUS IN ('ABERTO','EM_ANALISE') THEN 1 ELSE 0 END)  AS sac_aberto,
         NVL(ROUND(AVG(r.SCORE), 1), 0)                                          AS nota_media,
         NVL(SUM(CASE WHEN p.STATUS = 'LIBERADO'  THEN 1 ELSE 0 END), 0)        AS pgto_liberado,
         NVL(SUM(CASE WHEN p.STATUS = 'BLOQUEADO' THEN 1 ELSE 0 END), 0)        AS pgto_bloqueado,
         NVL(SUM(CASE WHEN p.STATUS = 'PROGRAMADO' THEN 1 ELSE 0 END), 0)       AS pgto_programado,
         NVL(SUM(CASE WHEN p.STATUS = 'PAGO'      THEN 1 ELSE 0 END), 0)        AS pgto_pago,
         NVL(SUM(CASE WHEN p.STATUS = 'AGUARDANDO_FINALIZACAO' THEN 1 ELSE 0 END), 0) AS pgto_aguardando,
         NVL(SUM(CASE WHEN ph.foto_count > 0 THEN 0 ELSE 1 END * CASE WHEN a.STATUS = 'FINALIZADA' THEN 1 ELSE 0 END), 0) AS sem_foto,
         NVL(SUM(ph.foto_count), 0)                                              AS total_fotos
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
       LEFT JOIN MONT_CUSTOMER_REVIEWS r
         ON r.ASSEMBLY_JOB_ID = a.ID AND r.SERVICE_TYPE = 'MONTAGEM'
       LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
       LEFT JOIN MONT_SAC_CASES sac ON sac.ASSEMBLY_JOB_ID = a.ID
       LEFT JOIN (
         SELECT ASSEMBLY_JOB_ID, COUNT(*) AS total_qty
         FROM MONT_ASSEMBLY_PHOTOS
         GROUP BY ASSEMBLY_JOB_ID
       ) ph ON ph.ASSEMBLY_JOB_ID = a.ID
       LEFT JOIN (
         SELECT ORDER_ID, SUM(QUANTITY) AS total_qty
         FROM MONT_ORDER_ITEMS WHERE REQUIRES_ASSEMBLY = 1
         GROUP BY ORDER_ID
       ) itens ON itens.ORDER_ID = a.ORDER_ID
       WHERE a.PROVIDER_ID = :providerId
       ${dateClause}`,
      binds,
    );

    return row;
  }

  async list(email: string, filters: HistoricoFilters = {}) {
    const providerId = await resolveProviderId(email);
    if (!providerId) return { rows: [], total: 0, page: 1, pageSize: 20 };

    const page     = Math.max(1, filters.page     ?? 1);
    const pageSize = Math.min(50, filters.pageSize ?? 20);
    const offset   = (page - 1) * pageSize;

    const binds: Record<string, unknown> = { providerId };
    const dateClause    = buildDateFilter(filters, binds);
    const whereClauses: string[] = [];

    if (filters.statusMontagem) {
      whereClauses.push("AND a.STATUS = :statusMontagem");
      binds.statusMontagem = filters.statusMontagem;
    }
    if (filters.statusPagamento) {
      whereClauses.push("AND p.STATUS = :statusPagamento");
      binds.statusPagamento = filters.statusPagamento;
    }
    if (filters.comReclamacao === true) {
      whereClauses.push("AND r.COMPLAINT_REASON IS NOT NULL");
    }

    const dynamicWhere = whereClauses.join(" ") + " " + dateClause;

    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS TOTAL
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       LEFT JOIN MONT_CUSTOMER_REVIEWS r
         ON r.ASSEMBLY_JOB_ID = a.ID AND r.SERVICE_TYPE = 'MONTAGEM'
       LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
       WHERE a.PROVIDER_ID = :providerId ${dynamicWhere}`,
      binds,
    );

    binds.offset   = offset;
    binds.pageSize = pageSize;

    const rows = await queryRows<Record<string, unknown>>(
      `SELECT
         a.ID, a.STATUS, a.STARTED_AT, a.FINISHED_AT, a.NOTES,
         o.NUMPED, o.CITY, o.UF,
         c.NAME  AS CUSTOMER_NAME,
         c.PHONE AS CUSTOMER_PHONE,
         s.SCHEDULED_DATE, s.SCHEDULED_PERIOD,
         r.SCORE, r.CLASSIFICATION, r.REVIEW_COMMENT, r.COMPLAINT_REASON,
         p.ID              AS PAYMENT_ID,
         p.STATUS          AS PAYMENT_STATUS,
         p.AMOUNT          AS PAYMENT_AMOUNT,
         p.BLOCKED_REASON  AS PAYMENT_BLOCKED_REASON,
         p.PROGRAMMED_FOR  AS PAYMENT_PROGRAMMED_FOR,
         p.PAID_AT         AS PAYMENT_PAID_AT,
         sac.ID            AS SAC_ID,
         sac.STATUS        AS SAC_STATUS,
         sac.REASON        AS SAC_REASON,
         (SELECT COUNT(*) FROM MONT_ASSEMBLY_PHOTOS ph WHERE ph.ASSEMBLY_JOB_ID = a.ID) AS PHOTO_COUNT,
         (SELECT NVL(SUM(i.QUANTITY), 0)
          FROM MONT_ORDER_ITEMS i
          WHERE i.ORDER_ID = a.ORDER_ID AND i.REQUIRES_ASSEMBLY = 1) AS ITEM_QTY
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
       LEFT JOIN MONT_CUSTOMER_REVIEWS r
         ON r.ASSEMBLY_JOB_ID = a.ID AND r.SERVICE_TYPE = 'MONTAGEM'
       LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
       LEFT JOIN MONT_SAC_CASES sac ON sac.ASSEMBLY_JOB_ID = a.ID
       WHERE a.PROVIDER_ID = :providerId
       ${dynamicWhere}
       ORDER BY COALESCE(a.FINISHED_AT, a.STARTED_AT, a.CREATED_AT) DESC NULLS LAST
       OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
      binds,
    );

    return {
      rows,
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  }

  async detail(email: string, jobId: string) {
    const providerId = await resolveProviderId(email);
    if (!providerId) return null;

    const job = await queryOne<Record<string, unknown>>(
      `SELECT
         a.ID, a.STATUS, a.STARTED_AT, a.FINISHED_AT, a.NOTES, a.CREATED_AT AS JOB_CREATED_AT,
         o.NUMPED, o.CITY, o.UF, o.CURRENT_STATUS AS ORDER_STATUS,
         c.NAME  AS CUSTOMER_NAME,
         c.PHONE AS CUSTOMER_PHONE,
         c.ADDRESS_JSON,
         s.SCHEDULED_DATE, s.SCHEDULED_PERIOD,
         r.SCORE, r.CLASSIFICATION, r.REVIEW_COMMENT, r.COMPLAINT_REASON,
         p.ID              AS PAYMENT_ID,
         p.STATUS          AS PAYMENT_STATUS,
         p.AMOUNT          AS PAYMENT_AMOUNT,
         p.BLOCKED_REASON  AS PAYMENT_BLOCKED_REASON,
         p.PROGRAMMED_FOR  AS PAYMENT_PROGRAMMED_FOR,
         p.PAID_AT         AS PAYMENT_PAID_AT,
         p.INVOICE_URL,
         p.INVOICE_SUBMITTED_AT,
         sac.ID            AS SAC_ID,
         sac.STATUS        AS SAC_STATUS,
         sac.REASON        AS SAC_REASON,
         sac.DESCRIPTION   AS SAC_DESCRIPTION
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
       LEFT JOIN MONT_CUSTOMER_REVIEWS r
         ON r.ASSEMBLY_JOB_ID = a.ID AND r.SERVICE_TYPE = 'MONTAGEM'
       LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
       LEFT JOIN MONT_SAC_CASES sac ON sac.ASSEMBLY_JOB_ID = a.ID
       WHERE a.ID = :jobId AND a.PROVIDER_ID = :providerId`,
      { jobId, providerId },
    );

    if (!job) return null;

    const photos = await queryRows<{ id: string; file_url: string; photo_type: string; created_at: unknown }>(
      `SELECT ID, FILE_URL, PHOTO_TYPE, CREATED_AT
       FROM MONT_ASSEMBLY_PHOTOS
       WHERE ASSEMBLY_JOB_ID = :jobId
       ORDER BY CREATED_AT ASC`,
      { jobId },
    );

    const items = await queryRows<{ product_id: string; description: string; quantity: number; assembly_cost: number }>(
      `SELECT PRODUCT_ID, DESCRIPTION, QUANTITY, ASSEMBLY_COST
       FROM MONT_ORDER_ITEMS
       WHERE ORDER_ID = (SELECT ORDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :jobId)
         AND REQUIRES_ASSEMBLY = 1`,
      { jobId },
    );

    const events = await queryRows<{ type: string; created_at: unknown; origin: string }>(
      `SELECT TYPE, CREATED_AT, ORIGIN
       FROM MONT_ORDER_EVENTS
       WHERE ASSEMBLY_ID = :jobId
       ORDER BY CREATED_AT ASC`,
      { jobId },
    );

    return { ...job, photos, items, events };
  }
}
