import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth";
import { isOracleEnabled, isOraclePoolInitialized } from "../db/oracle";
import { httpUrl } from "../utils/validators";
import { AuthService } from "../services/AuthService";
import { AssemblyService } from "../services/AssemblyService";
import { OrderService } from "../services/OrderService";
import { PaymentService } from "../services/PaymentService";
import { ProviderService } from "../services/ProviderService";
import { ReviewService } from "../services/ReviewService";
import { SacService } from "../services/SacService";
import { SchedulingService } from "../services/SchedulingService";
import { TokenService } from "../services/TokenService";
import { WinthorSyncService } from "../services/WinthorSyncService";
import { FlowService } from "../services/FlowService";
import { MessageTemplateService } from "../services/MessageTemplateService";
import { MontadorHistoricoService } from "../services/MontadorHistoricoService";
import { EvaluationLinkService } from "../services/EvaluationLinkService";

export const api = Router();

const auth = new AuthService();
const orders = new OrderService();
const providers = new ProviderService();
const scheduling = new SchedulingService();
const assembly = new AssemblyService();
const reviews = new ReviewService();
const sac = new SacService();
const payments = new PaymentService();
const winthor = new WinthorSyncService();
const tokens = new TokenService();
const flow = new FlowService();
const messageTemplates = new MessageTemplateService();
const evalLinks = new EvaluationLinkService();

// Guardas de papel — espelham os routers dedicados (payments.ts / providers.ts).
// Necessárias porque este router é montado primeiro e sombreia aquelas rotas.
const adminGestor = requireRole("ADMIN", "GESTOR");
const financeiro  = requireRole("FINANCEIRO", "ADMIN", "GESTOR");
const operacao    = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA");
const staff       = requireRole("ADMIN", "GESTOR", "OPERACAO", "FINANCEIRO", "LOGISTICA", "SAC");

const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : String(value ?? "");

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

// ── Public routes (no auth) ───────────────────────────────────────────────────

api.get("/health", asyncRoute(async (_req, res) => {
  let db: "disabled" | "ok" | "error" = "disabled";
  if (isOracleEnabled()) {
    if (!isOraclePoolInitialized()) {
      db = "error";
    } else {
      // Executa uma query real (não só a flag do pool) para detectar conexões mortas.
      try {
        const { queryOne } = await import("../db/db");
        await queryOne("SELECT 1 AS OK FROM DUAL");
        db = "ok";
      } catch {
        db = "error";
      }
    }
  }
  res.json({ ok: true, service: "app-montadores", db });
}));

// Readiness — para orquestradores (Docker/K8s/LB). Responde 503 quando o banco não
// está pronto, para que a instância seja reciclada/retirada do balanceamento (o /health
// é liveness e sempre responde 200). 'disabled' (Oracle não configurado) conta como pronto.
api.get("/ready", asyncRoute(async (_req, res) => {
  if (!isOracleEnabled()) { res.json({ ready: true, db: "disabled" }); return; }
  try {
    const { queryOne } = await import("../db/db");
    await queryOne("SELECT 1 AS OK FROM DUAL");
    res.json({ ready: true, db: "ok" });
  } catch {
    res.status(503).json({ ready: false, db: "error" });
  }
}));

api.get("/public/branding", (_req, res) => {
  res.json({
    companyName: process.env.COMPANY_NAME ?? "App Montadores",
    primaryColor: process.env.BRAND_COLOR ?? "#1F2855",
  });
});

api.post("/auth/login", asyncRoute(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  res.json(await auth.login(body.email, body.password));
}));

api.get("/public/journey/:token", asyncRoute(async (req, res) => {
  const token = await tokens.validate(param(req.params.token), "JORNADA_CLIENTE");
  res.json(await orders.detail(token.order_id));
}));

api.get("/public/slots/:token", asyncRoute(async (req, res) => {
  const token = await tokens.validate(param(req.params.token), "JORNADA_CLIENTE");
  res.json(await scheduling.availableSlots(token.order_id));
}));

api.post("/public/schedule/:token", asyncRoute(async (req, res) => {
  const token = await tokens.validate(param(req.params.token), "JORNADA_CLIENTE");
  const body = z.object({ providerId: z.string(), date: z.string(), period: z.string() }).parse(req.body);
  res.status(201).json(await scheduling.schedule(token.order_id, body.providerId, body.date, body.period));
}));

api.post("/public/sac/:token", asyncRoute(async (req, res) => {
  const token = await tokens.validate(param(req.params.token), "JORNADA_CLIENTE");
  const body = z.object({ reason: z.string().min(3), description: z.string().min(3) }).parse(req.body);
  res.status(201).json(await sac.open(token.order_id, body.reason, body.description));
}));

api.post("/public/reviews/:token/assembly", asyncRoute(async (req, res) => {
  const { queryOne: qo } = await import("../db/db");
  const token = await tokens.validate(param(req.params.token), "JORNADA_CLIENTE");
  const body = z.object({
    score: z.number().int().min(0).max(10),
    comment: z.string().optional(),
    complaintReason: z.string().optional(),
  }).parse(req.body);
  const job = await qo<{ id: string }>(
    "SELECT ID FROM MONT_ASSEMBLY_JOBS WHERE ORDER_ID = :orderId AND STATUS IN ('FINALIZADA','EM_EXECUCAO','AGENDADA') ORDER BY CREATED_AT DESC",
    { orderId: token.order_id },
  );
  if (!job) throw new AppError("Nenhuma montagem ativa encontrada para avaliação.", 404, "NOT_FOUND");
  res.status(201).json(await reviews.reviewAssembly(token.order_id, job.id, body.score, body.comment, body.complaintReason));
}));

// Public — provider self-registration (no auth required)
api.post("/public/providers/register", asyncRoute(async (req, res) => {
  const body = z.object({
    name:          z.string().min(3),
    tradeName:     z.string().optional(),
    document:      z.string().min(5),
    phone:         z.string().min(8),
    whatsapp:      z.string().optional(),
    email:         z.string().email().optional().or(z.literal("")),
    city:          z.string().min(2),
    uf:            z.string().length(2),
    cep:           z.string().optional(),
    regions:       z.array(z.string()).default([]),
    serviceTypes:  z.array(z.string()).default([]),
    productTypes:  z.array(z.string()).default([]),
    capacityPerDay: z.number().int().positive().default(1),
    pixKey:        z.string().optional(),
    pixKeyType:    z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await providers.register(body));
}));

// Public — evaluation survey (no auth required)
api.get("/public/eval/:token", asyncRoute(async (req, res) => {
  const link = await evalLinks.getByToken(param(req.params.token));
  if (!link) { res.status(404).json({ error: "Link de avaliação não encontrado." }); return; }
  if (link.expiresAt < new Date()) { res.status(410).json({ error: "Link de avaliação expirado." }); return; }
  res.json({ token: link.token, config: link.config, order: link.order });
}));

api.post("/public/eval/:token/respond", asyncRoute(async (req, res) => {
  const link = await evalLinks.getByToken(param(req.params.token));
  if (!link) { res.status(404).json({ error: "Link não encontrado." }); return; }
  const body = z.object({
    answers: z.array(z.object({
      questionId: z.string(),
      valueNumber: z.number().optional(),
      valueText: z.string().optional(),
    })).default([]),
    comment: z.string().optional(),
  }).parse(req.body);
  const { execDml: dml } = await import("../db/db");
  const { randomUUID } = await import("node:crypto");
  const responseId = randomUUID();
  try {
    await dml(
      `INSERT INTO MONT_EVAL_RESPONSES (ID, LINK_ID, CONFIG_ID, NUMPED, PHASE, EVAL_COMMENT, CREATED_AT)
       VALUES (:id, :linkId, :configId, :numped, :phase, :comment, SYSTIMESTAMP)`,
      { id: responseId, linkId: link.linkId, configId: link.configId, numped: link.numped ?? null, phase: link.phase, comment: body.comment ?? null },
    );
    for (const a of body.answers) {
      await dml(
        `INSERT INTO MONT_EVAL_ANSWERS (ID, RESPONSE_ID, QUESTION_ID, VALUE_NUMBER, VALUE_TEXT, CREATED_AT)
         VALUES (SYS_GUID(), :responseId, :questionId, :valueNumber, :valueText, SYSTIMESTAMP)`,
        { responseId, questionId: a.questionId, valueNumber: a.valueNumber ?? null, valueText: a.valueText ?? null },
      );
    }
    await evalLinks.markUsed(link.linkId);
  } catch {
    // Absorb DB errors — do not expose as 500
    res.status(400).json({ error: "Não foi possível salvar as respostas." }); return;
  }
  res.json({ ok: true });
}));

// ── All routes below require valid JWT ────────────────────────────────────────

api.use(authMiddleware);

// Current user
api.get("/auth/me", asyncRoute(async (req, res) => res.json(await auth.me(req.user!.sub))));

// Dashboard
api.get("/dashboard", asyncRoute(async (_req, res) => res.json(await orders.dashboard())));

// Orders
api.post("/orders/demo", asyncRoute(async (_req, res) => res.status(201).json(await orders.createDemoOrder())));
api.get("/orders", asyncRoute(async (req, res) =>
  res.json(await orders.list({
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    offset: req.query.offset as string | undefined,
  }))
));
api.get("/orders/:id", asyncRoute(async (req, res) => res.json(await orders.detail(param(req.params.id)))));
api.post("/orders/:id/public-token", operacao, asyncRoute(async (req, res) => res.status(201).json(await tokens.create(param(req.params.id), "JORNADA_CLIENTE"))));

// Providers
api.post("/providers", asyncRoute(async (req, res) => {
  const body = z.object({
    name:          z.string().min(3),
    tradeName:     z.string().optional(),
    document:      z.string().min(5),
    phone:         z.string().min(8),
    whatsapp:      z.string().optional(),
    email:         z.string().email().optional().or(z.literal("")),
    city:          z.string().optional(),
    uf:            z.string().max(2).optional(),
    cep:           z.string().optional(),
    regions:       z.array(z.string()).default([]),
    serviceTypes:  z.array(z.string()).default([]),
    productTypes:  z.array(z.string()).default([]),
    capacityPerDay: z.number().int().positive().default(1),
    codfornec:     z.string().optional(),
    pixKey:        z.string().optional(),
    pixKeyType:    z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await providers.register(body));
}));
api.get("/providers", asyncRoute(async (_req, res) => res.json(await providers.list())));
// WinThor supplier search — must be before /:id to avoid conflict
api.get("/providers/winthor/search", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) { res.json([]); return; }
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { WinthorAdapter } = await import("../oracle/WinthorAdapter");
  const wt = new WinthorAdapter();
  res.json(await wt.searchSuppliers(q));
}));

api.get("/providers/:id", asyncRoute(async (req, res) => res.json(await providers.getById(param(req.params.id)))));
api.post("/providers/:id/approve", adminGestor, asyncRoute(async (req, res) =>
  res.json(await providers.approve(param(req.params.id), req.user!.sub, req.body.justification ?? "Aprovado pela operação"))
));
api.post("/providers/:id/reject", adminGestor, asyncRoute(async (req, res) =>
  res.json(await providers.reject(param(req.params.id), req.user!.sub, req.body.justification ?? "Reprovado pela operação"))
));
api.post("/providers/:id/suspend", adminGestor, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.suspend(param(req.params.id), req.user!.sub, body.justification));
}));
api.post("/providers/:id/reactivate", adminGestor, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.reactivate(param(req.params.id), req.user!.sub, body.justification));
}));

// Scheduling — operação interna (nunca acessível a MONTADOR: evitaria auto-atribuição)
api.get("/orders/:id/slots", operacao, asyncRoute(async (req, res) => res.json(await scheduling.availableSlots(param(req.params.id)))));
api.post("/orders/:id/schedule", operacao, asyncRoute(async (req, res) => {
  const body = z.object({ providerId: z.string(), date: z.string(), period: z.string() }).parse(req.body);
  res.status(201).json(await scheduling.schedule(param(req.params.id), body.providerId, body.date, body.period));
}));

// Resolves the calling provider's ID when the user holds only the MONTADOR role.
// Returns null for ADMIN / GESTOR — they may operate any job.
async function resolveAssemblyProviderGuard(req: any): Promise<string | null> {
  const { roles, email } = req.user as { roles: string[]; email: string };
  const isPrivileged = roles.includes("ADMIN") || roles.includes("GESTOR") || roles.includes("OPERACAO");
  if (isPrivileged) return null;
  if (!roles.includes("MONTADOR")) return null;
  const { queryOne: qo } = await import("../db/db");
  const provider = await qo<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
    { email },
  );
  // If no matching provider record, return a sentinel that will never match any job PROVIDER_ID
  return provider?.id ?? "__NOT_FOUND__";
}

// Assembly
api.post("/assembly/:jobId/start", asyncRoute(async (req, res) => {
  const guard = await resolveAssemblyProviderGuard(req);
  res.json(await assembly.start(param(req.params.jobId), guard));
}));
api.post("/assembly/:jobId/photos", asyncRoute(async (req, res) => {
  const body = z.object({ fileUrl: httpUrl, photoType: z.string().optional() }).parse(req.body);
  const guard = await resolveAssemblyProviderGuard(req);
  res.status(201).json(await assembly.addPhoto(param(req.params.jobId), body.fileUrl, body.photoType, guard));
}));
api.post("/assembly/:jobId/finish", asyncRoute(async (req, res) => {
  const guard = await resolveAssemblyProviderGuard(req);
  res.json(await assembly.finish(param(req.params.jobId), guard));
}));

// Assembly jobs list — montadores only see their own jobs
api.get("/assembly/jobs", asyncRoute(async (req, res) => {
  const { queryRows: qr, queryOne: qo } = await import("../db/db");
  const isMontador = req.user!.roles.includes("MONTADOR") && !req.user!.roles.includes("ADMIN") && !req.user!.roles.includes("GESTOR");

  let providerFilter = "";
  let binds: Record<string, unknown> = {};

  if (isMontador) {
    const provider = await qo<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!provider) {
      res.json([]);
      return;
    }
    providerFilter = "AND a.PROVIDER_ID = :providerId";
    binds = { providerId: provider.id };
  }

  const rows = await qr(
    `SELECT a.*, o.NUMPED, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
            c.ADDRESS_JSON, pr.NAME AS PROVIDER_NAME,
            s.SCHEDULED_DATE, s.SCHEDULED_PERIOD,
            (SELECT COUNT(*) FROM MONT_ASSEMBLY_PHOTOS ph WHERE ph.ASSEMBLY_JOB_ID = a.ID) AS PHOTO_COUNT
     FROM MONT_ASSEMBLY_JOBS a
     JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
     JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
     LEFT JOIN MONT_PROVIDERS pr ON pr.ID = a.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = a.SCHEDULE_ID
     WHERE 1 = 1 ${providerFilter}
     ORDER BY a.CREATED_AT DESC FETCH FIRST 100 ROWS ONLY`,
    binds,
  );
  res.json(rows);
}));

// Provider invoice upload
api.post("/assembly/:jobId/invoice", asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const body = z.object({ invoiceUrl: httpUrl }).parse(req.body);
  const jobId = param(req.params.jobId);

  const job = await qo<{ id: string; provider_id: string }>(
    "SELECT ID, PROVIDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :jobId AND STATUS = 'FINALIZADA'",
    { jobId },
  );
  if (!job) throw new AppError("Montagem não encontrada ou ainda não finalizada.", 404, "NOT_FOUND");

  // Ensure requester is owner (montador) or admin/gestor
  const isMontador = req.user!.roles.includes("MONTADOR") && !req.user!.roles.includes("ADMIN") && !req.user!.roles.includes("GESTOR");
  if (isMontador) {
    const { queryOne: qoProv } = await import("../db/db");
    const prov = await qoProv<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!prov || prov.id !== job.provider_id) throw new AppError("Acesso negado.", 403, "FORBIDDEN");
  }

  await dml(
    `UPDATE MONT_PROVIDER_PAYMENTS
     SET INVOICE_URL = :url, INVOICE_SUBMITTED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP
     WHERE ASSEMBLY_JOB_ID = :jobId`,
    { url: body.invoiceUrl, jobId },
  );

  res.json({ ok: true });
}));

// Provider history — all finished jobs for the authenticated montador
api.get("/assembly/provider/history", asyncRoute(async (req, res) => {
  const { queryRows: qr, queryOne: qo } = await import("../db/db");
  const isMontador = req.user!.roles.includes("MONTADOR") && !req.user!.roles.includes("ADMIN") && !req.user!.roles.includes("GESTOR");

  let providerIdFilter = "";
  let binds: Record<string, unknown> = {};

  if (isMontador) {
    const provider = await qo<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!provider) { res.json([]); return; }
    providerIdFilter = "AND a.PROVIDER_ID = :providerId";
    binds = { providerId: provider.id };
  }

  const jobs = await qr<any>(
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

  // Fetch items for each job
  const { queryRows: qrItems } = await import("../db/db");
  const result = await Promise.all(
    jobs.map(async (job: any) => {
      const items = await qrItems<any>(
        `SELECT i.PRODUCT_ID, i.DESCRIPTION, i.QUANTITY, i.ASSEMBLY_COST
         FROM MONT_ORDER_ITEMS i
         JOIN MONT_ORDERS o ON o.ID = i.ORDER_ID
         JOIN MONT_ASSEMBLY_JOBS a ON a.ORDER_ID = o.ID
         WHERE a.ID = :jobId AND i.REQUIRES_ASSEMBLY = 1`,
        { jobId: job.id },
      );
      return { ...job, items };
    }),
  );

  res.json(result);
}));

// Reviews
api.post("/orders/:id/reviews/assembly", asyncRoute(async (req, res) => {
  const body = z.object({
    assemblyJobId: z.string(),
    score: z.number().int().min(0).max(10),
    comment: z.string().optional(),
    complaintReason: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await reviews.reviewAssembly(param(req.params.id), body.assemblyJobId, body.score, body.comment, body.complaintReason));
}));
api.post("/orders/:id/reviews/atendimento", asyncRoute(async (req, res) => {
  const body = z.object({
    score: z.number().int().min(0).max(10),
    comment: z.string().optional(),
    complaintReason: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await reviews.reviewAtendimento(param(req.params.id), body.score, body.comment, body.complaintReason));
}));
api.post("/orders/:id/reviews/entrega", asyncRoute(async (req, res) => {
  const body = z.object({
    score: z.number().int().min(0).max(10),
    comment: z.string().optional(),
    complaintReason: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await reviews.reviewEntrega(param(req.params.id), body.score, body.comment, body.complaintReason));
}));
api.get("/reviews", asyncRoute(async (_req, res) => res.json(await reviews.list())));

api.get("/reviews/atendimento/pendentes", asyncRoute(async (req, res) => {
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).parse(req.query);
  res.json(await reviews.listAtendimentoPendentes(page, pageSize));
}));

api.post("/reviews/atendimento/:numped/marcar-enviado", asyncRoute(async (req, res) => {
  const { numped } = z.object({ numped: z.string().min(1) }).parse(req.params);
  res.status(201).json(await reviews.marcarAtendimentoEnviado(numped));
}));

// Message templates — leitura para staff, escrita só ADMIN/GESTOR (conteúdo enviado ao cliente)
api.get("/message-templates", staff, asyncRoute(async (_req, res) => res.json(await messageTemplates.list())));
api.put("/message-templates/:eventType", adminGestor, asyncRoute(async (req, res) => {
  const body = z.object({
    channel:        z.enum(["WHATSAPP", "SMS", "EMAIL"]),
    subject:        z.string().optional(),
    body:           z.string().min(5),
    active:         z.boolean(),
    recipient:      z.enum(["CLIENTE", "FORNECEDOR", "INTERNO"]).optional(),
    ctaLabel:       z.string().max(200).optional(),
    ctaUrlVar:      z.string().max(100).optional(),
    antifraudeType: z.string().max(40).optional(),
    resendAllowed:  z.number().int().min(0).max(1).optional(),
    resendAfterH:   z.number().int().min(1).max(720).optional(),
    maxResends:     z.number().int().min(0).max(10).optional(),
    sendHourStart:  z.number().int().min(0).max(23).optional(),
    sendHourEnd:    z.number().int().min(0).max(23).optional(),
  }).parse(req.body);
  res.json(await messageTemplates.upsert({
    eventType:      param(req.params.eventType),
    channel:        body.channel,
    subject:        body.subject,
    body:           body.body,
    active:         body.active,
    recipient:      body.recipient,
    ctaLabel:       body.ctaLabel,
    ctaUrlVar:      body.ctaUrlVar,
    antifraudeType: body.antifraudeType,
    resendAllowed:  body.resendAllowed,
    resendAfterH:   body.resendAfterH,
    maxResends:     body.maxResends,
    sendHourStart:  body.sendHourStart,
    sendHourEnd:    body.sendHourEnd,
    userId:         req.user!.sub,
  }));
}));

// Flow ruler
api.get("/flow-ruler", asyncRoute(async (_req, res) => res.json(await flow.ruler())));

// SAC
api.get("/sac", asyncRoute(async (_req, res) => res.json(await sac.list())));
api.get("/sac/:id", asyncRoute(async (req, res) => res.json(await sac.getById(param(req.params.id)))));
api.post("/orders/:id/sac", asyncRoute(async (req, res) => {
  const body = z.object({
    reason: z.string().min(3),
    description: z.string().min(3),
    assemblyJobId: z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await sac.open(param(req.params.id), body.reason, body.description, body.assemblyJobId));
}));
api.post("/sac/:id/assign", asyncRoute(async (req, res) => res.json(await sac.assign(param(req.params.id), req.user!.sub))));
api.post("/sac/:id/note", asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().min(3) }).parse(req.body);
  res.json(await sac.addNote(param(req.params.id), body.note, req.user!.sub));
}));
api.post("/sac/:id/resolve", asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().optional() }).parse(req.body);
  res.json(await sac.resolve(param(req.params.id), body.note ?? "", req.user!.sub));
}));
api.post("/sac/:id/close", asyncRoute(async (req, res) => {
  const body = z.object({ note: z.string().min(5) }).parse(req.body);
  res.json(await sac.close(param(req.params.id), body.note, req.user!.sub));
}));

// Payments
api.get("/payments", financeiro, asyncRoute(async (_req, res) => res.json(await payments.list())));
api.post("/payments/:id/release", financeiro, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(5) }).parse(req.body);
  res.json(await payments.release(param(req.params.id), req.user!.sub, body.justification));
}));
api.post("/payments/:id/program", financeiro, asyncRoute(async (req, res) => {
  const body = z.object({ programmedFor: z.string() }).parse(req.body);
  res.json(await payments.program(param(req.params.id), body.programmedFor, req.user!.sub));
}));
api.post("/payments/:id/pay", financeiro, asyncRoute(async (req, res) => res.json(await payments.pay(param(req.params.id), req.user!.sub))));
api.patch("/payments/:id/amount", financeiro, asyncRoute(async (req, res) => {
  const body = z.object({
    amount:        z.number().min(0),
    justification: z.string().min(10),
  }).parse(req.body);
  res.json(await payments.setAmount(param(req.params.id), body.amount, body.justification, req.user!.sub));
}));

// WinThor integration
api.get("/integration/winthor", asyncRoute(async (_req, res) => res.json(await winthor.failures())));
api.post("/integration/winthor/orders/:numped/sync", adminGestor, asyncRoute(async (req, res) =>
  res.status(202).json(await winthor.syncOrder(param(req.params.numped), req.user!.sub))
));
api.post("/integration/winthor/sync-batch", adminGestor, asyncRoute(async (req, res) => {
  const body = z.object({ since: z.string().optional() }).parse(req.body);
  const since = body.since ? new Date(body.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  res.status(202).json(await winthor.syncOrdersBatch(since, req.user!.sub));
}));

// WinThor lookup (read-only)

// List PCPEDC with pagination, filters and sync status
api.get("/winthor/orders", staff, asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { queryRows: qr } = await import("../db/db");

  const since = req.query.since
    ? new Date(String(req.query.since))
    : new Date(Date.now() - 90 * 24 * 3600000);
  const posicao  = String(req.query.posicao  ?? "").trim();
  const q        = String(req.query.q        ?? "").trim();
  const offset   = Number(req.query.offset   ?? 0);
  const limit    = Math.min(Number(req.query.limit ?? 100), 500);
  const onlyAssembly = req.query.hasAssembly === "1";

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
    binds.q = `%${q}%`;
    binds.q2 = `%${q}%`;
  }
  if (onlyAssembly) {
    where.push(`EXISTS (
      SELECT 1 FROM PCPEDI i2
      JOIN PCPRODUT pr2 ON pr2.CODPROD = i2.CODPROD
      WHERE i2.NUMPED = p.NUMPED AND pr2.VLMAODEOBRA > 0
    )`);
  }

  const rows = await qr<any>(
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
  );
  res.json(rows);
}));

// Single order detail with items and sync status
api.get("/winthor/orders/:numped", staff, asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) throw new Error("Oracle não disponível.");
  const adapter = new (await import("../oracle/WinthorAdapter")).WinthorAdapter();
  const numped = param(req.params.numped);
  const [orderRows, items, invoices] = await Promise.all([
    adapter.getOrderByNumber(numped),
    adapter.getOrderItems(numped),
    adapter.getInvoiceByOrder(numped),
  ]);
  if (!orderRows.length) throw new AppError("Pedido não encontrado no WinThor.", 404, "NOT_FOUND");
  const { queryOne: qo } = await import("../db/db");
  const synced = await qo<{ id: string }>(
    "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
    { numped },
  );
  res.json({ order: orderRows[0], items, invoice: invoices[0] ?? null, synced_id: synced?.id ?? null });
}));
api.get("/winthor/customers/:codcli", staff, asyncRoute(async (req, res) => {
  const adapter = new (await import("../oracle/WinthorAdapter")).WinthorAdapter();
  const customer = await adapter.getCustomerById(param(req.params.codcli));
  res.json(customer[0] ?? null);
}));

// ── Product Commissions ───────────────────────────────────────────────────────

// List all configured commissions (MONT_PRODUCT_COMMISSIONS)
api.get("/commissions", asyncRoute(async (_req, res) => {
  const { queryRows: qr } = await import("../db/db");
  res.json(await qr(
    `SELECT * FROM MONT_PRODUCT_COMMISSIONS ORDER BY DESCRIPTION ASC`,
  ));
}));

// Search PCPRODUT for assembly products (VLMAODEOBRA > 0) not yet configured
api.get("/commissions/search", asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { queryRows: qr } = await import("../db/db");
  const q     = String(req.query.q ?? "").trim();
  const all   = req.query.all === "1";           // include already configured
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const searchFilter = q
    ? "(UPPER(p.DESCRICAO) LIKE UPPER(:q) OR TO_CHAR(p.CODPROD) LIKE :q2)"
    : "1=1";
  const configuredFilter = all
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM MONT_PRODUCT_COMMISSIONS c WHERE c.CODPROD = TO_CHAR(p.CODPROD))";

  const binds: Record<string, unknown> = { limit };
  if (q) { binds.q = `%${q}%`; binds.q2 = `%${q}%`; }

  res.json(await qr(
    `SELECT TO_CHAR(p.CODPROD) AS CODPROD, p.DESCRICAO, p.VLMAODEOBRA,
            p.UNIDADE, p.CODEPTO,
            (SELECT c.COMMISSION_PERCENT FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS COMMISSION_PERCENT,
            (SELECT c.ACTIVE FROM MONT_PRODUCT_COMMISSIONS c
             WHERE c.CODPROD = TO_CHAR(p.CODPROD) AND ROWNUM = 1) AS COMMISSION_ACTIVE
     FROM PCPRODUT p
     WHERE p.VLMAODEOBRA > 0
       AND ${searchFilter}
       ${configuredFilter}
     ORDER BY p.DESCRICAO
     FETCH FIRST :limit ROWS ONLY`,
    binds,
  ));
}));

// Upsert commission for a product
api.put("/commissions/:codprod", adminGestor, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const body = z.object({
    description:       z.string().min(2),
    vlmaodeobra:       z.number().min(0).default(0),
    commissionPercent: z.number().min(0.01).max(100),
    active:            z.boolean().default(true),
    notes:             z.string().optional(),
  }).parse(req.body);

  const codprod = param(req.params.codprod);
  const existing = await qo<{ id: string }>(
    "SELECT ID FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod",
    { codprod },
  );

  if (existing) {
    await dml(
      `UPDATE MONT_PRODUCT_COMMISSIONS
       SET DESCRIPTION = :desc, VLMAODEOBRA = :vlm,
           COMMISSION_PERCENT = :pct, ACTIVE = :active,
           NOTES = :notes, UPDATED_BY = :userId, UPDATED_AT = SYSTIMESTAMP
       WHERE CODPROD = :codprod`,
      { desc: body.description, vlm: body.vlmaodeobra, pct: body.commissionPercent,
        active: body.active ? 1 : 0, notes: body.notes ?? null,
        userId: req.user!.sub, codprod },
    );
  } else {
    await dml(
      `INSERT INTO MONT_PRODUCT_COMMISSIONS
         (ID, CODPROD, DESCRIPTION, VLMAODEOBRA, COMMISSION_PERCENT, ACTIVE, NOTES, CREATED_BY, UPDATED_BY)
       VALUES (:id, :codprod, :desc, :vlm, :pct, :active, :notes, :userId, :userId)`,
      { id: uuidv4(), codprod, desc: body.description, vlm: body.vlmaodeobra,
        pct: body.commissionPercent, active: body.active ? 1 : 0,
        notes: body.notes ?? null, userId: req.user!.sub },
    );
  }
  res.json({ ok: true, codprod });
}));

// Toggle active or delete commission
api.delete("/commissions/:codprod", adminGestor, asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml(
    "DELETE FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod",
    { codprod: param(req.params.codprod) },
  );
  res.json({ ok: true });
}));

api.patch("/commissions/:codprod/toggle", adminGestor, asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml(
    `UPDATE MONT_PRODUCT_COMMISSIONS
     SET ACTIVE = CASE WHEN ACTIVE = 1 THEN 0 ELSE 1 END,
         UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :userId
     WHERE CODPROD = :codprod`,
    { codprod: param(req.params.codprod), userId: req.user!.sub },
  );
  res.json({ ok: true });
}));

// Audit logs
api.get("/audit-logs", adminGestor, asyncRoute(async (_req, res) => {
  const { queryRows: qr } = await import("../db/db");
  const rows = await qr(`SELECT * FROM MONT_AUDIT_LOGS ORDER BY CREATED_AT DESC FETCH FIRST 200 ROWS ONLY`);
  res.json(rows);
}));

// ── Montador — Minhas Montagens ───────────────────────────────────────────────

const montadorHistorico = new MontadorHistoricoService();

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

api.get("/montador/minhas-montagens/resumo", asyncRoute(async (req, res) => {
  const filters = historicoFiltersSchema.parse(req.query);
  const resumo  = await montadorHistorico.resumo(req.user!.email, {
    ...filters,
    comReclamacao: filters.comReclamacao === "true",
  });
  if (!resumo) { res.status(404).json({ error: "Montador não encontrado." }); return; }
  res.json(resumo);
}));

api.get("/montador/minhas-montagens", asyncRoute(async (req, res) => {
  const filters = historicoFiltersSchema.parse(req.query);
  const result  = await montadorHistorico.list(req.user!.email, {
    ...filters,
    comReclamacao: filters.comReclamacao === "true",
  });
  res.json(result);
}));

api.get("/montador/minhas-montagens/:jobId", asyncRoute(async (req, res) => {
  const jobId  = param(req.params.jobId);
  const detail = await montadorHistorico.detail(req.user!.email, jobId);
  if (!detail) { res.status(404).json({ error: "Montagem não encontrada." }); return; }
  res.json(detail);
}));

// Search — orders and providers
api.get("/search", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2 || !isOraclePoolInitialized()) {
    res.json({ orders: [], providers: [] }); return;
  }
  const { queryRows: qr } = await import("../db/db");
  const like = `%${q.toUpperCase()}%`;
  try {
    const [orderRows, providerRows] = await Promise.all([
      qr<{ id: string; numped: string; status: string }>(
        `SELECT ID, NUMPED, STATUS FROM MONT_ORDERS WHERE UPPER(NUMPED) LIKE :q FETCH FIRST 20 ROWS ONLY`,
        { q: like },
      ),
      qr<{ id: string; name: string; document: string }>(
        `SELECT ID, NAME, DOCUMENT FROM MONT_PROVIDERS WHERE (UPPER(NAME) LIKE :qn OR UPPER(DOCUMENT) LIKE :qd) AND ACTIVE = 1 FETCH FIRST 20 ROWS ONLY`,
        { qn: like, qd: like },
      ),
    ]);
    res.json({ orders: orderRows, providers: providerRows });
  } catch {
    res.json({ orders: [], providers: [] });
  }
}));

// Notifications
api.get("/notifications/summary", asyncRoute(async (_req, res) => {
  if (!isOraclePoolInitialized()) { res.json({ pending: 0, unread: 0 }); return; }
  const { queryOne: qo } = await import("../db/db");
  const row = await qo<{ cnt: number }>(
    "SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PENDENTE'",
    {},
  );
  res.json({ pending: row?.cnt ?? 0, unread: 0 });
}));

// Settings
api.get("/settings/branding", (_req, res) => {
  res.json({
    companyName: process.env.COMPANY_NAME ?? "App Montadores",
    primaryColor: process.env.BRAND_COLOR ?? "#1F2855",
  });
});
