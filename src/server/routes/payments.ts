import { Router } from "express";
import { AppError } from "../errors";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "../middleware/auth";
import { PaymentService } from "../services/PaymentService";
import { execDml, queryOne, queryRows } from "../db/db";
import { param, asyncRoute } from "../utils/route";

export const paymentsRouter = Router();

const payments = new PaymentService();

const financeiroRoles    = requireRole("FINANCEIRO", "ADMIN", "GESTOR");
const commissionWriteRoles = requireRole("ADMIN", "GESTOR");
const commissionReadRoles  = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "FINANCEIRO");
const winthorAdminRoles    = requireRole("ADMIN", "GESTOR");

// ── Payments ──────────────────────────────────────────────────────────────────

paymentsRouter.get("/payments", financeiroRoles, asyncRoute(async (req, res) => {
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  res.json(await payments.list(page, pageSize));
}));

paymentsRouter.get("/payments/export.csv", financeiroRoles, asyncRoute(async (_req, res) => {
  const all = await payments.listAll() as Record<string, unknown>[];
  const header = ["ID", "Pedido", "Montador", "Valor", "Status", "Programado para", "Pago em", "Criado em"].join(";");
  const rows = all.map((p) => [
    p.id, p.numped, p.provider_name,
    (p.amount != null ? String(p.amount) : "0").replace(".", ","),
    p.status, p.programmed_for ?? "", p.paid_at ?? "", p.created_at ?? "",
  ].join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pagamentos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + [header, ...rows].join("\r\n"));
}));

paymentsRouter.post("/payments/bulk-release", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    ids:           z.array(z.string()).min(1).max(50),
    justification: z.string().min(5),
  }).parse(req.body);
  const results = await Promise.allSettled(
    body.ids.map((id) => payments.release(id, req.user!.sub, body.justification)),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => r.status === "rejected" ? { id: body.ids[i], error: (r as PromiseRejectedResult).reason?.message ?? "Erro" } : null)
    .filter(Boolean);
  res.json({ succeeded, failed, total: body.ids.length });
}));

paymentsRouter.post("/payments/bulk-program", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    ids:           z.array(z.string()).min(1).max(50),
    programmedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(req.body);
  const results = await Promise.allSettled(
    body.ids.map((id) => payments.program(id, body.programmedFor, req.user!.sub)),
  );
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => r.status === "rejected" ? { id: body.ids[i], error: (r as PromiseRejectedResult).reason?.message ?? "Erro" } : null)
    .filter(Boolean);
  res.json({ succeeded, failed, total: body.ids.length });
}));

paymentsRouter.post("/payments/:id/release", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(5) }).parse(req.body);
  res.json(await payments.release(param(req.params.id), req.user!.sub, body.justification));
}));

paymentsRouter.post("/payments/:id/program", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({ programmedFor: z.string() }).parse(req.body);
  res.json(await payments.program(param(req.params.id), body.programmedFor, req.user!.sub));
}));

paymentsRouter.post("/payments/:id/pay", financeiroRoles, asyncRoute(async (req, res) =>
  res.json(await payments.pay(param(req.params.id), req.user!.sub))
));

paymentsRouter.patch("/payments/:id/amount", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    amount:        z.number().min(0),
    justification: z.string().min(10),
  }).parse(req.body);
  res.json(await payments.setAmount(param(req.params.id), body.amount, body.justification, req.user!.sub));
}));

paymentsRouter.get("/payments/:id/commission-detail", financeiroRoles, asyncRoute(async (req, res) => {
  const { CommissionCalculationService } = await import("../services/CommissionCalculationService");
  res.json(await new CommissionCalculationService().getCalcItems(param(req.params.id)));
}));

paymentsRouter.post("/payments/:id/recalculate", financeiroRoles, asyncRoute(async (req, res) => {
  const { CommissionCalculationService } = await import("../services/CommissionCalculationService");
  res.json(await new CommissionCalculationService().calculateForPayment(param(req.params.id), req.user!.sub));
}));

// ── PIX ───────────────────────────────────────────────────────────────────────

paymentsRouter.get("/pix/mode", financeiroRoles, asyncRoute(async (_req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  res.json({ mode: new PixPaymentService().getMode() });
}));

paymentsRouter.post("/payments/:id/pix", financeiroRoles, asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  res.status(201).json(await new PixPaymentService().requestPayment(param(req.params.id), req.user!.sub));
}));

// ── Commissions — count (public to all authed roles) ─────────────────────────

paymentsRouter.get("/commissions/count", asyncRoute(async (_req, res) => {
  const [prod, dept] = await Promise.all([
    queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_PRODUCT_COMMISSIONS WHERE ACTIVE = 1"),
    queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_DEPT_COMMISSIONS WHERE ACTIVE = 1"),
  ]);
  res.json({ count: Number(prod?.total ?? 0) + Number(dept?.total ?? 0) });
}));

paymentsRouter.get("/commissions", commissionReadRoles, asyncRoute(async (_req, res) =>
  res.json(await queryRows("SELECT * FROM MONT_PRODUCT_COMMISSIONS ORDER BY DESCRIPTION ASC"))
));

paymentsRouter.get("/commissions/departments", commissionReadRoles, asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  res.json(await queryRows(
    `SELECT TO_CHAR(CODEPTO) AS CODEPTO, DESCRICAO FROM PCDEPTO ORDER BY DESCRICAO`,
  ));
}));

paymentsRouter.get("/commissions/search", commissionReadRoles, asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const q      = String(req.query.q ?? "").trim();
  const coddeps = (Array.isArray(req.query.coddep) ? req.query.coddep : String(req.query.coddep ?? "").split(","))
    .map((v) => String(v).trim()).filter(Boolean).slice(0, 50);
  const all   = req.query.all === "1";
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  if (q.length < 2 && coddeps.length === 0) { res.json([]); return; }

  const configuredFilter   = all ? "" : "AND NOT EXISTS (SELECT 1 FROM MONT_PRODUCT_COMMISSIONS c WHERE c.CODPROD = TO_CHAR(p.CODPROD))";
  const searchFilter       = q.length >= 2 ? "AND (UPPER(p.DESCRICAO) LIKE UPPER(:q) OR TO_CHAR(p.CODPROD) LIKE :q2)" : "";
  const deptPlaceholders   = coddeps.map((_, i) => `:coddep${i}`);
  const departmentFilter   = deptPlaceholders.length ? `AND TO_CHAR(p.CODEPTO) IN (${deptPlaceholders.join(", ")})` : "";

  const binds: Record<string, unknown> = { limit };
  if (q.length >= 2) { binds.q = `%${q}%`; binds.q2 = `%${q}%`; }
  coddeps.forEach((v, i) => { binds[`coddep${i}`] = v; });

  res.json(await queryRows(
    `SELECT TO_CHAR(p.CODPROD) AS CODPROD, p.DESCRICAO,
            p.UNIDADE, TO_CHAR(p.CODEPTO) AS CODDEP,
            (SELECT c.COMMISSION_PERCENT FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS COMMISSION_PERCENT,
            (SELECT c.CALCULATION_TYPE FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS CALCULATION_TYPE,
            (SELECT c.FIXED_AMOUNT FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS FIXED_AMOUNT,
            (SELECT c.ACTIVE FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS COMMISSION_ACTIVE
     FROM PCPRODUT p
     WHERE 1 = 1 ${searchFilter} ${departmentFilter} ${configuredFilter}
     ORDER BY p.DESCRICAO
     FETCH FIRST :limit ROWS ONLY`,
    binds,
  ));
}));

// ── Commission upsert/delete/toggle ──────────────────────────────────────────

const commissionBodySchema = z.object({
  description:       z.string().min(2),
  calculationType:   z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).default("PERCENTAGE"),
  fixedAmount:       z.number().min(0).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  active:            z.boolean().default(true),
  notes:             z.string().optional(),
});

paymentsRouter.put("/commissions/:codprod", commissionWriteRoles, asyncRoute(async (req, res) => {
  const body    = commissionBodySchema.parse(req.body);
  const codprod = param(req.params.codprod);

  if (body.calculationType === "FIXED_AMOUNT" && (body.fixedAmount == null || body.fixedAmount < 0))
    throw Object.assign(new Error("Valor fixo é obrigatório e deve ser >= 0."), { status: 400 });
  if (body.calculationType === "PERCENTAGE" && (body.commissionPercent == null || body.commissionPercent <= 0))
    throw Object.assign(new Error("Percentual é obrigatório e deve ser > 0."), { status: 400 });

  const calcType  = body.calculationType;
  const fixedAmt  = calcType === "FIXED_AMOUNT" ? (body.fixedAmount ?? 0) : 0;
  const pct       = calcType === "PERCENTAGE"   ? (body.commissionPercent ?? 0) : 0;
  const existing  = await queryOne<{ id: string }>("SELECT ID FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod", { codprod });

  if (existing) {
    await execDml(
      `UPDATE MONT_PRODUCT_COMMISSIONS
       SET DESCRIPTION = :descr, CALCULATION_TYPE = :calctype,
           FIXED_AMOUNT = :fixedamt, COMMISSION_PERCENT = :pct,
           ACTIVE = :active, NOTES = :notes,
           UPDATED_BY = :updatedby, UPDATED_AT = SYSTIMESTAMP
       WHERE CODPROD = :codprod`,
      { descr: body.description, calctype: calcType, fixedamt: fixedAmt, pct,
        active: body.active ? 1 : 0, notes: body.notes ?? null, updatedby: req.user!.sub, codprod },
    );
  } else {
    await execDml(
      `INSERT INTO MONT_PRODUCT_COMMISSIONS
         (ID, CODPROD, DESCRIPTION, VLMAODEOBRA, CALCULATION_TYPE, FIXED_AMOUNT,
          COMMISSION_PERCENT, ACTIVE, NOTES, CREATED_BY, UPDATED_BY)
       VALUES (:id, :codprod, :descr, 0, :calctype, :fixedamt,
               :pct, :active, :notes, :createdby, :updatedby)`,
      { id: uuidv4(), codprod, descr: body.description, calctype: calcType,
        fixedamt: fixedAmt, pct, active: body.active ? 1 : 0,
        notes: body.notes ?? null, createdby: req.user!.sub, updatedby: req.user!.sub },
    );
  }
  res.json({ ok: true, codprod });
}));

paymentsRouter.delete("/commissions/:codprod", commissionWriteRoles, asyncRoute(async (req, res) => {
  await execDml("DELETE FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod", { codprod: param(req.params.codprod) });
  res.json({ ok: true });
}));

paymentsRouter.patch("/commissions/:codprod/toggle", commissionWriteRoles, asyncRoute(async (req, res) => {
  await execDml(
    `UPDATE MONT_PRODUCT_COMMISSIONS
     SET ACTIVE = CASE WHEN ACTIVE = 1 THEN 0 ELSE 1 END,
         UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :userId
     WHERE CODPROD = :codprod`,
    { codprod: param(req.params.codprod), userId: req.user!.sub },
  );
  res.json({ ok: true });
}));

// ── Department commissions ────────────────────────────────────────────────────

const deptBodySchema = z.object({
  description:       z.string().min(1),
  calculationType:   z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).default("PERCENTAGE"),
  fixedAmount:       z.number().min(0).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  active:            z.boolean().default(true),
  notes:             z.string().optional(),
});

paymentsRouter.get("/commissions/dept", commissionReadRoles, asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (isOracleEnabled()) {
    res.json(await queryRows(
      `SELECT d.CODEPTO, NVL(dep.DESCRICAO, d.DESCRIPTION) AS DESCRIPTION,
              d.CALCULATION_TYPE, d.COMMISSION_PERCENT, d.FIXED_AMOUNT,
              d.ACTIVE, d.NOTES, d.CREATED_AT, d.UPDATED_AT
       FROM MONT_DEPT_COMMISSIONS d
       LEFT JOIN PCDEPTO dep ON TO_CHAR(dep.CODEPTO) = d.CODEPTO
       ORDER BY NVL(dep.DESCRICAO, d.DESCRIPTION) ASC`,
    ));
  } else {
    res.json(await queryRows("SELECT * FROM MONT_DEPT_COMMISSIONS ORDER BY DESCRIPTION ASC"));
  }
}));

paymentsRouter.put("/commissions/dept/:codepto", commissionWriteRoles, asyncRoute(async (req, res) => {
  const body    = deptBodySchema.parse(req.body);
  const codepto = param(req.params.codepto);

  if (body.calculationType === "FIXED_AMOUNT" && (body.fixedAmount == null || body.fixedAmount < 0))
    throw Object.assign(new Error("Valor fixo obrigatório e deve ser >= 0."), { status: 400 });
  if (body.calculationType === "PERCENTAGE" && (body.commissionPercent == null || body.commissionPercent <= 0))
    throw Object.assign(new Error("Percentual obrigatório e deve ser > 0."), { status: 400 });

  const calcType = body.calculationType;
  const fixedAmt = calcType === "FIXED_AMOUNT" ? (body.fixedAmount ?? 0) : 0;
  const pct      = calcType === "PERCENTAGE"   ? (body.commissionPercent ?? 0) : 0;
  const existing = await queryOne<{ id: string }>("SELECT ID FROM MONT_DEPT_COMMISSIONS WHERE CODEPTO = :codepto", { codepto });

  if (existing) {
    await execDml(
      `UPDATE MONT_DEPT_COMMISSIONS
       SET DESCRIPTION = :descr, CALCULATION_TYPE = :calctype, FIXED_AMOUNT = :fixedamt,
           COMMISSION_PERCENT = :pct, ACTIVE = :active, NOTES = :notes,
           UPDATED_BY = :updatedby, UPDATED_AT = SYSTIMESTAMP
       WHERE CODEPTO = :codepto`,
      { descr: body.description, calctype: calcType, fixedamt: fixedAmt, pct,
        active: body.active ? 1 : 0, notes: body.notes ?? null, updatedby: req.user!.sub, codepto },
    );
  } else {
    await execDml(
      `INSERT INTO MONT_DEPT_COMMISSIONS
         (ID, CODEPTO, DESCRIPTION, CALCULATION_TYPE, FIXED_AMOUNT, COMMISSION_PERCENT,
          ACTIVE, NOTES, CREATED_BY, UPDATED_BY)
       VALUES (:id, :codepto, :descr, :calctype, :fixedamt, :pct,
               :active, :notes, :createdby, :updatedby)`,
      { id: uuidv4(), codepto, descr: body.description, calctype: calcType,
        fixedamt: fixedAmt, pct, active: body.active ? 1 : 0,
        notes: body.notes ?? null, createdby: req.user!.sub, updatedby: req.user!.sub },
    );
  }
  res.json({ ok: true, codepto });
}));

paymentsRouter.delete("/commissions/dept/:codepto", commissionWriteRoles, asyncRoute(async (req, res) => {
  await execDml("DELETE FROM MONT_DEPT_COMMISSIONS WHERE CODEPTO = :codepto", { codepto: param(req.params.codepto) });
  res.json({ ok: true });
}));

paymentsRouter.patch("/commissions/dept/:codepto/toggle", commissionWriteRoles, asyncRoute(async (req, res) => {
  await execDml(
    `UPDATE MONT_DEPT_COMMISSIONS
     SET ACTIVE = CASE WHEN ACTIVE = 1 THEN 0 ELSE 1 END,
         UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :userId
     WHERE CODEPTO = :codepto`,
    { codepto: param(req.params.codepto), userId: req.user!.sub },
  );
  res.json({ ok: true });
}));

// ── WinThor integration ───────────────────────────────────────────────────────

paymentsRouter.get("/integration/winthor", asyncRoute(async (_req, res) => {
  const { WinthorSyncService } = await import("../services/WinthorSyncService");
  res.json(await new WinthorSyncService().failures());
}));

paymentsRouter.post("/integration/winthor/orders/:numped/sync", winthorAdminRoles, asyncRoute(async (req, res) => {
  const { WinthorSyncService } = await import("../services/WinthorSyncService");
  res.status(202).json(await new WinthorSyncService().syncOrder(param(req.params.numped), req.user!.sub));
}));

paymentsRouter.post("/integration/winthor/sync-batch", winthorAdminRoles, asyncRoute(async (req, res) => {
  const { WinthorSyncService } = await import("../services/WinthorSyncService");
  const body  = z.object({ since: z.string().optional() }).parse(req.body);
  const _sinceDate = body.since ? new Date(body.since) : null;
  const since = (_sinceDate && !isNaN(_sinceDate.getTime())) ? _sinceDate : new Date(Date.now() - 24 * 60 * 60 * 1000);
  res.status(202).json(await new WinthorSyncService().syncOrdersBatch(since, req.user!.sub));
}));

paymentsRouter.post("/integration/failures/:id/retry", asyncRoute(async (req, res) => {
  const id      = param(req.params.id);
  const failure = await queryOne<{ id: string; retry_count: number }>(
    "SELECT ID, RETRY_COUNT FROM MONT_INTEGRATION_FAILURES WHERE ID = :id AND RESOLVED_AT IS NULL",
    { id },
  );
  if (!failure) { res.status(404).json({ error: "Falha não encontrada ou já resolvida." }); return; }
  await execDml(
    "UPDATE MONT_INTEGRATION_FAILURES SET RETRY_COUNT = RETRY_COUNT + 1, RESOLVED_AT = SYSTIMESTAMP WHERE ID = :id",
    { id },
  );
  res.json({ ok: true, retryCount: Number(failure.retry_count) + 1 });
}));

// ── WinThor read-only lookup ──────────────────────────────────────────────────

paymentsRouter.get("/winthor/orders", asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }

  const _sinceRaw = req.query.since ? new Date(String(req.query.since)) : null;
  const since = (_sinceRaw && !isNaN(_sinceRaw.getTime())) ? _sinceRaw : new Date(Date.now() - 90 * 24 * 3600000);
  const posicao       = String(req.query.posicao  ?? "").trim();
  const q             = String(req.query.q        ?? "").trim();
  const offset        = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const limit         = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const onlyAssembly  = req.query.hasAssembly === "1";

  const where: string[] = ["p.DATA >= :since"];
  const binds: Record<string, unknown> = { since, offset, limit };

  if (posicao === "NULL") {
    where.push("(p.POSICAO IS NULL OR p.POSICAO = ' ')");
  } else if (posicao) {
    where.push("p.POSICAO = :posicao");
    binds.posicao = posicao;
  }
  if (q) {
    where.push("(TO_CHAR(p.NUMPED) LIKE :q OR UPPER(c.CLIENTE) LIKE UPPER(:q2))");
    binds.q  = `%${q}%`;
    binds.q2 = `%${q}%`;
  }
  if (onlyAssembly) {
    where.push(`EXISTS (
      SELECT 1 FROM PCPEDI i2
      JOIN PCPRODUT pr2 ON pr2.CODPROD = i2.CODPROD
      WHERE i2.NUMPED = p.NUMPED AND pr2.VLMAODEOBRA > 0
    )`);
  }

  res.json(await queryRows(
    `SELECT p.NUMPED, p.DATA, p.CODCLI, c.CLIENTE,
            p.CODFILIAL, p.VLTOTAL, p.DTENTREGA,
            p.POSICAO, p.NUMCAR, p.DTFAT, p.CHAVENFE,
            CASE WHEN EXISTS (
              SELECT 1 FROM PCPEDI i2
              JOIN PCPRODUT pr2 ON pr2.CODPROD = i2.CODPROD
              WHERE i2.NUMPED = p.NUMPED AND pr2.VLMAODEOBRA > 0
            ) THEN 1 ELSE 0 END AS HAS_ASSEMBLY,
            (SELECT mo.ID FROM MONT_ORDERS mo
             WHERE mo.NUMPED = TO_CHAR(p.NUMPED) AND ROWNUM = 1) AS SYNCED_ID
     FROM PCPEDC p
     LEFT JOIN PCCLIENT c ON c.CODCLI = p.CODCLI
     WHERE ${where.join(" AND ")}
     ORDER BY p.DATA DESC
     OFFSET :offset ROWS FETCH FIRST :limit ROWS ONLY`,
    binds,
  ));
}));

paymentsRouter.get("/winthor/orders/:numped", asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) throw new Error("Oracle não disponível.");
  const { WinthorAdapter } = await import("../oracle/WinthorAdapter");
  const adapter  = new WinthorAdapter();
  const numped   = param(req.params.numped);
  const [orderRows, items, invoices] = await Promise.all([
    adapter.getOrderByNumber(numped),
    adapter.getOrderItems(numped),
    adapter.getInvoiceByOrder(numped),
  ]);
  if (!orderRows.length) throw new AppError("Pedido não encontrado no WinThor.", 404, "NOT_FOUND");
  const synced = await queryOne<{ id: string }>("SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped", { numped });
  res.json({ order: orderRows[0], items, invoice: invoices[0] ?? null, synced_id: synced?.id ?? null });
}));

paymentsRouter.get("/winthor/customers/:codcli", asyncRoute(async (req, res) => {
  const { WinthorAdapter } = await import("../oracle/WinthorAdapter");
  const customer = await new WinthorAdapter().getCustomerById(param(req.params.codcli));
  res.json(customer[0] ?? null);
}));

// ── Audit logs ────────────────────────────────────────────────────────────────

paymentsRouter.get("/audit-logs", requireRole("ADMIN", "GESTOR"), asyncRoute(async (_req, res) =>
  res.json(await queryRows("SELECT * FROM MONT_AUDIT_LOGS ORDER BY CREATED_AT DESC FETCH FIRST 200 ROWS ONLY"))
));

// ── System health ─────────────────────────────────────────────────────────────

paymentsRouter.get("/system/health", asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  let dbLatencyMs: number | null = null;
  let dbStatus: "ok" | "disabled" | "error" = "disabled";

  if (isOracleEnabled()) {
    const t0 = Date.now();
    try {
      await queryOne("SELECT 1 AS X FROM DUAL", {});
      dbLatencyMs = Date.now() - t0;
      dbStatus = "ok";
    } catch { dbStatus = "error"; }
  }

  // Distingue "zero falhas" de "não foi possível consultar": em erro devolve null,
  // não 0/[] (senão o painel de saúde mostraria verde justamente quando a base de
  // falhas está inacessível). failuresError sinaliza o problema explicitamente.
  let failuresError = false;
  const [failureCount, lastSyncRow, recentFailures] = await Promise.all([
    queryOne<{ cnt: number }>("SELECT COUNT(*) AS CNT FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL", {}).catch(() => { failuresError = true; return null; }),
    queryOne<{ iniciado_em: string; run_status: string; pedidos_encontrados: number; eventos_gerados: number }>(
      "SELECT INICIADO_EM, RUN_STATUS, PEDIDOS_ENCONTRADOS, EVENTOS_GERADOS FROM MONT_SYNC_RUNS ORDER BY INICIADO_EM DESC FETCH FIRST 1 ROWS ONLY", {},
    ).catch(() => null),
    queryRows("SELECT OPERATION, ERROR_MESSAGE, CREATED_AT FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL ORDER BY CREATED_AT DESC FETCH FIRST 5 ROWS ONLY", {}).catch(() => { failuresError = true; return null; }),
  ]);

  res.json({
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    openFailures: failureCount ? Number((failureCount as Record<string, unknown>).cnt ?? 0) : null,
    lastSync: lastSyncRow ?? null,
    recentFailures: recentFailures ?? null,
    failuresQueryError: failuresError,
  });
}));
