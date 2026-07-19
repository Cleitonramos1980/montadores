import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { httpUrl } from "../utils/validators";
import { AssemblyService } from "../services/AssemblyService";
import { SchedulingService } from "../services/SchedulingService";
import { MontadorHistoricoService } from "../services/MontadorHistoricoService";
import { AgendaEntregaService } from "../services/AgendaEntregaService";
import { queryOne, queryRows } from "../db/db";
import { param, asyncRoute } from "../utils/route";

export const assemblyRouter = Router();

const assembly   = new AssemblyService();
const scheduling = new SchedulingService();
const montadorHistorico = new MontadorHistoricoService();
const agendaEntrega     = new AgendaEntregaService();

const assemblyOpRoles = requireRole("MONTADOR", "ADMIN", "GESTOR", "OPERACAO");
const agendaRoles     = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA");
const operacaoRoles   = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA");
// Listagem de jobs traz PII do cliente (nome/telefone/endereço): MONTADOR vê só os seus
// (filtro por provider), o staff operacional vê todos — CONSULTA fica de fora.
const jobsReadRoles   = requireRole("MONTADOR", "ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "SAC", "FINANCEIRO");

// Garante que MONTADOR só acessa seu próprio job — admin/gestor/operacao podem acessar qualquer um
async function assertMontadorOwnsJob(req: Request, jobId: string): Promise<void> {
  const user = req.user!;
  const isStrictMontador = user.roles.includes("MONTADOR") &&
    !user.roles.includes("ADMIN") &&
    !user.roles.includes("GESTOR") &&
    !user.roles.includes("OPERACAO");
  if (!isStrictMontador) return;

  const provider = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
    { email: user.email },
  );
  if (!provider) throw new NotFoundError("Montador");

  const job = await queryOne<{ provider_id: string }>(
    "SELECT PROVIDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :jobId",
    { jobId },
  );
  if (!job) throw new NotFoundError("Montagem");
  if (job.provider_id !== provider.id) throw new ForbiddenError("Acesso negado: montagem pertence a outro montador.");
}

// ── Scheduling (somente operação/admin — clientes usam /public/schedule/:token) ─

assemblyRouter.get("/orders/:id/slots", operacaoRoles, asyncRoute(async (req, res) =>
  res.json(await scheduling.availableSlots(param(req.params.id)))
));

assemblyRouter.post("/orders/:id/schedule", operacaoRoles, asyncRoute(async (req, res) => {
  const body = z.object({ providerId: z.string(), date: z.string(), period: z.string() }).parse(req.body);
  res.status(201).json(await scheduling.schedule(param(req.params.id), body.providerId, body.date, body.period));
}));

// ── Assembly lifecycle ────────────────────────────────────────────────────────

assemblyRouter.post("/assembly/:jobId/start", assemblyOpRoles, asyncRoute(async (req, res) => {
  const jobId = param(req.params.jobId);
  await assertMontadorOwnsJob(req, jobId);
  res.json(await assembly.start(jobId));
}));

const MAX_PHOTOS_PER_JOB = 20;

assemblyRouter.post("/assembly/:jobId/photos", assemblyOpRoles, asyncRoute(async (req, res) => {
  const jobId = param(req.params.jobId);
  await assertMontadorOwnsJob(req, jobId);

  const photoCount = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS CNT FROM MONT_ASSEMBLY_PHOTOS WHERE ASSEMBLY_JOB_ID = :jobId",
    { jobId },
  );
  if (Number(photoCount?.cnt ?? 0) >= MAX_PHOTOS_PER_JOB) {
    throw new Error(`Limite de ${MAX_PHOTOS_PER_JOB} fotos por montagem atingido.`);
  }

  const body = z.object({ fileUrl: httpUrl, photoType: z.string().optional() }).parse(req.body);
  res.status(201).json(await assembly.addPhoto(jobId, body.fileUrl, body.photoType));
}));

assemblyRouter.post("/assembly/:jobId/finish", assemblyOpRoles, asyncRoute(async (req, res) => {
  const jobId = param(req.params.jobId);
  await assertMontadorOwnsJob(req, jobId);
  res.json(await assembly.finish(jobId));
}));

// Assembly jobs list — montadores only see their own jobs
assemblyRouter.get("/assembly/jobs", jobsReadRoles, asyncRoute(async (req: Request, res: Response) => {
  const isMontador = req.user!.roles.includes("MONTADOR") &&
    !req.user!.roles.includes("ADMIN") &&
    !req.user!.roles.includes("GESTOR");
  const statusFilter     = req.query.status     ? String(req.query.status)     : null;
  const providerIdFilter = req.query.providerId ? String(req.query.providerId) : null;

  const whereParts: string[] = [];
  const binds: Record<string, unknown> = {};

  if (isMontador) {
    const provider = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!provider) { res.json([]); return; }
    whereParts.push("a.PROVIDER_ID = :providerId");
    binds.providerId = provider.id;
  } else if (providerIdFilter) {
    whereParts.push("a.PROVIDER_ID = :providerId");
    binds.providerId = providerIdFilter;
  }

  if (statusFilter) {
    whereParts.push("a.STATUS = :status");
    binds.status = statusFilter;
  }

  const whereClause = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";
  const rows = await queryRows(
    `SELECT a.*, o.NUMPED, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
            c.ADDRESS_JSON, pr.NAME AS PROVIDER_NAME,
            s.SCHEDULED_DATE, s.SCHEDULED_PERIOD,
            (SELECT COUNT(*) FROM MONT_ASSEMBLY_PHOTOS ph WHERE ph.ASSEMBLY_JOB_ID = a.ID) AS PHOTO_COUNT
     FROM MONT_ASSEMBLY_JOBS a
     JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
     JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
     LEFT JOIN MONT_PROVIDERS pr ON pr.ID = a.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
     ${whereClause}
     ORDER BY a.CREATED_AT DESC FETCH FIRST 100 ROWS ONLY`,
    binds,
  );
  res.json(rows);
}));

// Provider invoice upload
assemblyRouter.post("/assembly/:jobId/invoice", asyncRoute(async (req, res) => {
  const body  = z.object({ invoiceUrl: httpUrl }).parse(req.body);
  const jobId = param(req.params.jobId);
  const job   = await queryOne<{ id: string; provider_id: string }>(
    "SELECT ID, PROVIDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :jobId AND STATUS = 'FINALIZADA'",
    { jobId },
  );
  if (!job) throw new AppError("Montagem não encontrada ou ainda não finalizada.", 404, "NOT_FOUND");

  const isMontador = req.user!.roles.includes("MONTADOR") &&
    !req.user!.roles.includes("ADMIN") &&
    !req.user!.roles.includes("GESTOR");
  if (isMontador) {
    const prov = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!prov || prov.id !== job.provider_id) throw new AppError("Acesso negado.", 403, "FORBIDDEN");
  }

  const { execDml } = await import("../db/db");
  await execDml(
    `UPDATE MONT_PROVIDER_PAYMENTS
     SET INVOICE_URL = :url, INVOICE_SUBMITTED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP
     WHERE ASSEMBLY_JOB_ID = :jobId`,
    { url: body.invoiceUrl, jobId },
  );
  res.json({ ok: true });
}));

// Provider history — all finished jobs for the authenticated montador
assemblyRouter.get("/assembly/provider/history", asyncRoute(async (req, res) => {
  const isMontador = req.user!.roles.includes("MONTADOR") &&
    !req.user!.roles.includes("ADMIN") &&
    !req.user!.roles.includes("GESTOR");

  let providerIdFilter = "";
  let binds: Record<string, unknown> = {};

  if (isMontador) {
    const provider = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!provider) { res.json([]); return; }
    providerIdFilter = "AND a.PROVIDER_ID = :providerId";
    binds = { providerId: provider.id };
  }

  const jobs = await queryRows<Record<string, unknown>>(
    `SELECT a.ID, a.STATUS, a.STARTED_AT, a.FINISHED_AT,
            o.NUMPED, o.TOTAL_AMOUNT,
            c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE, c.ADDRESS_JSON,
            pr.NAME AS PROVIDER_NAME, pr.ID AS PROVIDER_ID,
            s.SCHEDULED_DATE, s.SCHEDULED_PERIOD,
            p.ID AS PAYMENT_ID, p.AMOUNT AS PAYMENT_AMOUNT,
            p.STATUS AS PAYMENT_STATUS, p.INVOICE_URL, p.INVOICE_SUBMITTED_AT,
            (SELECT COUNT(*) FROM MONT_ASSEMBLY_PHOTOS ph WHERE ph.ASSEMBLY_JOB_ID = a.ID) AS PHOTO_COUNT
     FROM MONT_ASSEMBLY_JOBS a
     JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
     JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
     LEFT JOIN MONT_PROVIDERS pr ON pr.ID = a.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
     LEFT JOIN MONT_PROVIDER_PAYMENTS p ON p.ASSEMBLY_JOB_ID = a.ID
     WHERE a.STATUS = 'FINALIZADA' ${providerIdFilter}
     ORDER BY a.FINISHED_AT DESC NULLS LAST
     FETCH FIRST 200 ROWS ONLY`,
    binds,
  );

  const result = await Promise.all(
    jobs.map(async (job) => {
      const items = await queryRows(
        `SELECT ji.CODPROD AS PRODUCT_ID, ji.DESCRICAO AS DESCRIPTION,
                ji.QUANTITY, ji.CALCULATED_AMOUNT AS ASSEMBLY_COST,
                ji.VALOR_UNITARIO, ji.RULE_SOURCE, ji.COMMISSION_PERCENT
         FROM MONT_ASSEMBLY_JOB_ITEMS ji
         WHERE ji.ASSEMBLY_JOB_ID = :jobId`,
        { jobId: job.id },
      );
      return { ...job, items };
    }),
  );
  res.json(result);
}));

// Provider dashboard summary (App Montador)
assemblyRouter.get("/assembly/provider/dashboard", asyncRoute(async (req, res) => {
  const userId   = req.user!.sub;
  // Sem .catch(()=>null): um erro de banco não deve virar dashboard zerado (o montador
  // acharia que não tem saldo/jobs). queryOne já retorna null se não houver provider.
  const provider = await queryOne<{ id: string }>(
    "SELECT p.ID FROM MONT_PROVIDERS p JOIN MONT_USERS u ON u.EMAIL = p.EMAIL WHERE u.ID = :userId",
    { userId },
  );
  if (!provider) { res.json({ providerId: null, weekJobs: 0, pendingBalance: 0, expiringDocs: 0 }); return; }

  const providerId   = provider.id;
  const today        = new Date().toISOString().slice(0, 10);
  const weekEnd      = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const certDeadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [weekRow, balanceRow, docsRow] = await Promise.all([
    queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS CNT FROM MONT_ASSEMBLY_JOBS j
       JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = j.SCHEDULE_ID
       WHERE j.PROVIDER_ID = :providerId AND j.STATUS NOT IN ('CANCELADA','FINALIZADA')
         AND s.SCHEDULED_DATE BETWEEN :today AND :weekEnd`,
      { providerId, today, weekEnd },
    ),
    queryOne<{ total: number }>(
      `SELECT NVL(SUM(AMOUNT),0) AS TOTAL FROM MONT_PROVIDER_PAYMENTS
       WHERE PROVIDER_ID = :providerId AND STATUS IN ('AGUARDANDO_FINALIZACAO','AGUARDANDO_AVALIACAO_CLIENTE','LIBERADO')`,
      { providerId },
    ),
    queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_CERTIFICATIONS
       WHERE PROVIDER_ID = :providerId AND STATUS NOT IN ('EXPIRADO','REPROVADO')
         AND VALID_UNTIL IS NOT NULL AND VALID_UNTIL <= TO_DATE(:deadline, 'YYYY-MM-DD')`,
      { providerId, deadline: certDeadline },
    ).catch(() => ({ cnt: 0 })),
  ]);

  res.json({
    providerId,
    weekJobs:       Number(weekRow?.cnt    ?? 0),
    pendingBalance: Number(balanceRow?.total ?? 0),
    expiringDocs:   Number(docsRow?.cnt    ?? 0),
  });
}));

// ── Montador — Minhas Montagens ───────────────────────────────────────────────

const historicoFiltersSchema = z.object({
  periodo:         z.enum(["HOJE", "ONTEM", "SEMANA", "MES", "PERSONALIZADO"]).optional(),
  dataInicio:      z.string().optional(),
  dataFim:         z.string().optional(),
  statusMontagem:  z.string().optional(),
  statusPagamento: z.string().optional(),
  comReclamacao:   z.enum(["true", "false"]).optional(),
  page:            z.coerce.number().int().min(1).optional(),
  pageSize:        z.coerce.number().int().min(1).max(50).optional(),
});

assemblyRouter.get("/montador/minhas-montagens/resumo", asyncRoute(async (req, res) => {
  const filters = historicoFiltersSchema.parse(req.query);
  const resumo  = await montadorHistorico.resumo(req.user!.email, {
    ...filters,
    comReclamacao: filters.comReclamacao === "true",
  });
  if (!resumo) { res.status(404).json({ error: "Montador não encontrado." }); return; }
  res.json(resumo);
}));

assemblyRouter.get("/montador/minhas-montagens", asyncRoute(async (req, res) => {
  const filters = historicoFiltersSchema.parse(req.query);
  res.json(await montadorHistorico.list(req.user!.email, {
    ...filters,
    comReclamacao: filters.comReclamacao === "true",
  }));
}));

assemblyRouter.get("/montador/minhas-montagens/:jobId", asyncRoute(async (req, res) => {
  const detail = await montadorHistorico.detail(req.user!.email, param(req.params.jobId));
  if (!detail) { res.status(404).json({ error: "Montagem não encontrada." }); return; }
  res.json(detail);
}));

// ── Agenda Inteligente ────────────────────────────────────────────────────────

assemblyRouter.get("/agenda/candidatos", agendaRoles, asyncRoute(async (req, res) => {
  const { somenteEntregues, somenteSemConvite, somenteElegiveis, daysBack, codfilial, numped } = z.object({
    somenteEntregues:  z.coerce.number().int().min(0).max(1).default(1),
    somenteSemConvite: z.coerce.number().int().min(0).max(1).default(0),
    somenteElegiveis:  z.coerce.number().int().min(0).max(1).default(1),
    daysBack:          z.coerce.number().int().min(1).max(365).default(60),
    codfilial:         z.string().optional(),
    numped:            z.string().optional(),
  }).parse(req.query);
  res.json(await agendaEntrega.list({
    daysBack,
    somenteEntregues:  somenteEntregues === 1,
    somenteSemConvite: somenteSemConvite === 1,
    somenteElegiveis:  somenteElegiveis === 1,
    codfilial,
    numped,
  }));
}));

assemblyRouter.post("/agenda/sync", agendaRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    modo:     z.enum(["DRY_RUN", "HOMOLOGACAO", "PRODUCAO"]).default("DRY_RUN"),
    daysBack: z.coerce.number().int().min(1).max(365).default(60),
  }).parse(req.body);
  res.status(201).json(await agendaEntrega.sync({ modo: body.modo, daysBack: body.daysBack }));
}));

assemblyRouter.get("/agenda/diagnostico", agendaRoles, asyncRoute(async (_req, res) =>
  res.json(await agendaEntrega.diagnostico())
));

assemblyRouter.get("/agenda/stats", agendaRoles, asyncRoute(async (_req, res) =>
  res.json(await agendaEntrega.getSummaryStats())
));

assemblyRouter.get("/agenda/providers-match", agendaRoles, asyncRoute(async (req, res) => {
  const { ProviderMatchingService } = await import("../services/ProviderMatchingService");
  const svc = new ProviderMatchingService();
  res.json(await svc.match({
    clientLat:  req.query.lat  ? (v => isNaN(v) ? undefined : v)(parseFloat(String(req.query.lat)))  : undefined,
    clientLon:  req.query.lon  ? (v => isNaN(v) ? undefined : v)(parseFloat(String(req.query.lon)))  : undefined,
    clientCity: req.query.city ? String(req.query.city)  : undefined,
    clientUf:   req.query.uf   ? String(req.query.uf)    : undefined,
  }));
}));

assemblyRouter.post("/agenda/candidatos/:numped/montagem-agendada", agendaRoles, asyncRoute(async (req, res) => {
  await agendaEntrega.marcarMontagemAgendada(param(req.params.numped), new Date());
  res.json({ ok: true });
}));

assemblyRouter.post("/agenda/migrate-dryrun-keys", agendaRoles, asyncRoute(async (_req, res) => {
  res.json(await agendaEntrega.migrateDryRunKeys());
}));
