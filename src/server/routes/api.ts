import { createWriteStream } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { config } from "../config";
import multer from "multer";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth";
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
import { AgendaEntregaService } from "../services/AgendaEntregaService";
import { AssemblyEligibilityService } from "../services/AssemblyEligibilityService";
import { ProviderNotificationService } from "../services/ProviderNotificationService";
import { EvaluationConfigService } from "../services/EvaluationConfigService";
import { EvaluationLinkService } from "../services/EvaluationLinkService";
import { EvaluationResponseService } from "../services/EvaluationResponseService";
import { queryOne } from "../db/db";

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
const eligibility = new AssemblyEligibilityService();

const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : String(value ?? "");

// File upload — multer disk storage
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, join(process.cwd(), "uploads")),
    filename: (_req, file, cb) => {
      const ext = file.originalname.slice(file.originalname.lastIndexOf(".")) || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Somente imagens são permitidas.") as any, false);
  },
});

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

// ── Rate limiting — 200 req/min per IP ────────────────────────────────────────
const _rateLimitMap = new Map<string, number[]>();

api.use((req: Request, res: Response, next: NextFunction): void => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (_rateLimitMap.get(ip) ?? []).filter((t) => t > windowStart);
  if (timestamps.length >= 200) {
    res.status(429).json({ error: "Taxa de requisições excedida. Tente novamente em breve." });
    return;
  }
  timestamps.push(now);
  _rateLimitMap.set(ip, timestamps);
  next();
});

// ── Public routes (no auth) ───────────────────────────────────────────────────

api.get("/health", asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  let db: "ok" | "disabled" | "error" = "disabled";
  if (isOracleEnabled()) {
    try {
      const { queryOne: qo } = await import("../db/db");
      await qo("SELECT 1 AS X FROM DUAL", {});
      db = "ok";
    } catch {
      db = "error";
    }
  }
  res.json({ ok: db !== "error", service: "app-montadores", db });
}));

api.post("/auth/login", asyncRoute(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  res.json(await auth.login(body.email, body.password));
}));

api.get("/public/branding", (_req, res) => {
  res.json({
    companyName:  config.branding.companyName,
    logoUrl:      config.branding.logoUrl || null,
    primaryColor: config.branding.primaryColor,
    supportPhone: config.branding.supportPhone || null,
  });
});

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
  res.status(201).json(await scheduling.schedule(token.order_id, body.providerId, body.date, body.period, "CLIENTE"));
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
  if (!job) throw new Error("Nenhuma montagem ativa encontrada para avaliação.");
  res.status(201).json(await reviews.reviewAssembly(token.order_id, job.id, body.score, body.comment, body.complaintReason));
}));

api.post("/auth/forgot-password", asyncRoute(async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  res.json(await auth.forgotPassword(body.email));
}));

// ── Avaliação pública — links configurados (sem autenticação) ─────────────────
const _evalLinkSvcPublic = new EvaluationLinkService();
const _evalRespSvcPublic = new EvaluationResponseService();

api.get("/public/eval/:token", asyncRoute(async (req, res) => {
  const linkInfo = await _evalLinkSvcPublic.getByToken(param(req.params.token));
  if (!linkInfo) { res.status(404).json({ error: "Link de avaliação inválido." }); return; }
  if (linkInfo.usedAt) { res.status(410).json({ error: "Esta avaliação já foi respondida.", alreadyAnswered: true }); return; }
  if (new Date() > linkInfo.expiresAt) { res.status(410).json({ error: "Este link de avaliação expirou.", expired: true }); return; }
  res.json(linkInfo);
}));

api.post("/public/eval/:token/respond", asyncRoute(async (req, res) => {
  const token = param(req.params.token);
  const body = z.object({
    answers: z.array(z.object({
      questionId:  z.string(),
      valueText:   z.string().max(4000).optional(),
      valueNumber: z.coerce.number().optional(),
    })).min(1),
    comment: z.string().max(4000).optional(),
  }).parse(req.body);
  const ip        = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];
  res.status(201).json(await _evalRespSvcPublic.submit(token, {
    answers:   body.answers,
    comment:   body.comment,
    ip,
    userAgent,
  }));
}));

api.post("/auth/reset-password", asyncRoute(async (req, res) => {
  const body = z.object({ token: z.string().min(10), password: z.string().min(6) }).parse(req.body);
  await auth.resetPassword(body.token, body.password);
  res.json({ ok: true, message: "Senha alterada com sucesso." });
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

// ── All routes below require valid JWT ────────────────────────────────────────

api.use(authMiddleware);

// Current user
api.get("/auth/me", asyncRoute(async (req, res) => res.json(await auth.me(req.user!.sub))));

// File upload
api.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "Nenhum arquivo enviado." }); return; }
  res.json({ url: `/api/uploads/${req.file.filename}`, filename: req.file.filename });
});

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
api.get("/orders/:id/eligible-products", asyncRoute(async (req, res) => {
  const order = await queryOne<{ numped: string }>(
    "SELECT NUMPED FROM MONT_ORDERS WHERE ID = :id",
    { id: param(req.params.id) },
  );
  if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
  res.json(await eligibility.checkEligibility(order.numped));
}));
api.post("/orders/:id/public-token", asyncRoute(async (req, res) => res.status(201).json(await tokens.create(param(req.params.id), "JORNADA_CLIENTE"))));

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

api.get("/providers/:id/profile", asyncRoute(async (req, res) => {
  const { queryOne: qo, queryRows: qr } = await import("../db/db");
  const id = param(req.params.id);
  const [provider, avgScore, totalJobs, payments] = await Promise.all([
    providers.getById(id),
    qo<{ avg_score: number | null }>(
      `SELECT ROUND(AVG(r.SCORE), 1) AS AVG_SCORE
       FROM MONT_CUSTOMER_REVIEWS r
       JOIN MONT_ASSEMBLY_JOBS j ON j.ORDER_ID = r.ORDER_ID
       WHERE j.PROVIDER_ID = :id AND r.SERVICE_TYPE = 'MONTAGEM'`,
      { id },
    ),
    qo<{ total: number; finished: number; in_progress: number }>(
      `SELECT COUNT(*) AS TOTAL,
              SUM(CASE WHEN STATUS = 'FINALIZADA' THEN 1 ELSE 0 END) AS FINISHED,
              SUM(CASE WHEN STATUS = 'EM_EXECUCAO' THEN 1 ELSE 0 END) AS IN_PROGRESS
       FROM MONT_ASSEMBLY_JOBS WHERE PROVIDER_ID = :id`,
      { id },
    ),
    qo<{ total_paid: number; total_pending: number }>(
      `SELECT SUM(CASE WHEN STATUS = 'PAGO' THEN AMOUNT ELSE 0 END) AS TOTAL_PAID,
              SUM(CASE WHEN STATUS != 'PAGO' THEN AMOUNT ELSE 0 END) AS TOTAL_PENDING
       FROM MONT_PROVIDER_PAYMENTS WHERE PROVIDER_ID = :id`,
      { id },
    ),
  ]);
  res.json({
    ...provider,
    stats: {
      avgScore:    avgScore?.avg_score ?? null,
      totalJobs:   Number(totalJobs?.total ?? 0),
      finishedJobs: Number(totalJobs?.finished ?? 0),
      inProgressJobs: Number(totalJobs?.in_progress ?? 0),
      totalPaid:   Number(payments?.total_paid ?? 0),
      totalPending: Number(payments?.total_pending ?? 0),
    },
  });
}));

api.get("/providers/:id", asyncRoute(async (req, res) => res.json(await providers.getById(param(req.params.id)))));
api.post("/providers/:id/approve", asyncRoute(async (req, res) =>
  res.json(await providers.approve(param(req.params.id), req.user!.sub, req.body.justification ?? "Aprovado pela operação"))
));
api.post("/providers/:id/reject", asyncRoute(async (req, res) =>
  res.json(await providers.reject(param(req.params.id), req.user!.sub, req.body.justification ?? "Reprovado pela operação"))
));
api.post("/providers/:id/suspend", asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.suspend(param(req.params.id), req.user!.sub, body.justification));
}));
api.post("/providers/:id/reactivate", asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.reactivate(param(req.params.id), req.user!.sub, body.justification));
}));

// Scheduling
api.get("/orders/:id/slots", asyncRoute(async (req, res) => res.json(await scheduling.availableSlots(param(req.params.id)))));
api.post("/orders/:id/schedule", asyncRoute(async (req, res) => {
  const body = z.object({ providerId: z.string(), date: z.string(), period: z.string() }).parse(req.body);
  res.status(201).json(await scheduling.schedule(param(req.params.id), body.providerId, body.date, body.period, "OPERACAO"));
}));

// Assembly
api.post("/assembly/:jobId/start", asyncRoute(async (req, res) => res.json(await assembly.start(param(req.params.jobId)))));
api.post("/assembly/:jobId/photos", asyncRoute(async (req, res) => {
  const body = z.object({ fileUrl: z.string().min(3), photoType: z.string().optional() }).parse(req.body);
  res.status(201).json(await assembly.addPhoto(param(req.params.jobId), body.fileUrl, body.photoType));
}));
api.post("/assembly/:jobId/finish", asyncRoute(async (req, res) => res.json(await assembly.finish(param(req.params.jobId)))));

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
  const body = z.object({ invoiceUrl: z.string().url().min(5) }).parse(req.body);
  const jobId = param(req.params.jobId);

  const job = await qo<{ id: string; provider_id: string }>(
    "SELECT ID, PROVIDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :jobId AND STATUS = 'FINALIZADA'",
    { jobId },
  );
  if (!job) throw new Error("Montagem não encontrada ou ainda não finalizada.");

  // Ensure requester is owner (montador) or admin/gestor
  const isMontador = req.user!.roles.includes("MONTADOR") && !req.user!.roles.includes("ADMIN") && !req.user!.roles.includes("GESTOR");
  if (isMontador) {
    const { queryOne: qoProv } = await import("../db/db");
    const prov = await qoProv<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
      { email: req.user!.email },
    );
    if (!prov || prov.id !== job.provider_id) throw new Error("Acesso negado.");
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

// Message templates
api.get("/message-templates", asyncRoute(async (_req, res) => res.json(await messageTemplates.list())));
api.put("/message-templates/:eventType", requireRole("ADMIN", "GESTOR"), asyncRoute(async (req, res) => {
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
api.get("/sac", asyncRoute(async (req, res) => {
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);
  res.json(await sac.list(page, pageSize));
}));
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

// Payments — requires FINANCEIRO, ADMIN or GESTOR role
const financeiroRoles = requireRole("FINANCEIRO", "ADMIN", "GESTOR");

// Commissions — write requires ADMIN or GESTOR; read is open to operational roles
const commissionWriteRoles = requireRole("ADMIN", "GESTOR");
const commissionReadRoles  = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "FINANCEIRO");

// Agenda — requires operational access
const agendaRoles = requireRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA");

// Audit — restricted to management roles
const auditRoles = requireRole("ADMIN", "GESTOR");

api.get("/payments", financeiroRoles, asyncRoute(async (req, res) => {
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  res.json(await payments.list(page, pageSize));
}));

api.get("/payments/export.csv", financeiroRoles, asyncRoute(async (_req, res) => {
  const all = await payments.listAll() as any[];
  const header = ["ID","Pedido","Montador","Valor","Status","Programado para","Pago em","Criado em"].join(";");
  const rows = all.map((p: any) => [
    p.id, p.numped, p.provider_name,
    String(p.amount).replace(".", ","),
    p.status, p.programmed_for ?? "", p.paid_at ?? "", p.created_at ?? "",
  ].join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pagamentos-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send("﻿" + [header, ...rows].join("\r\n"));
}));
api.post("/payments/:id/release", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(5) }).parse(req.body);
  res.json(await payments.release(param(req.params.id), req.user!.sub, body.justification));
}));
api.post("/payments/:id/program", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({ programmedFor: z.string() }).parse(req.body);
  res.json(await payments.program(param(req.params.id), body.programmedFor, req.user!.sub));
}));
api.post("/payments/:id/pay", financeiroRoles, asyncRoute(async (req, res) => res.json(await payments.pay(param(req.params.id), req.user!.sub))));

// Commission detail items for a payment
api.get("/payments/:id/commission-detail", financeiroRoles, asyncRoute(async (req, res) => {
  const { CommissionCalculationService } = await import("../services/CommissionCalculationService");
  const svc = new CommissionCalculationService();
  res.json(await svc.getCalcItems(param(req.params.id)));
}));

// Recalculate commission for a payment (not allowed for PAGO)
api.post("/payments/:id/recalculate", financeiroRoles, asyncRoute(async (req, res) => {
  const { CommissionCalculationService } = await import("../services/CommissionCalculationService");
  const svc = new CommissionCalculationService();
  res.json(await svc.calculateForPayment(param(req.params.id), req.user!.sub));
}));

// WinThor integration
api.get("/integration/winthor", asyncRoute(async (_req, res) => res.json(await winthor.failures())));
api.post("/integration/winthor/orders/:numped/sync", asyncRoute(async (req, res) =>
  res.status(202).json(await winthor.syncOrder(param(req.params.numped), req.user!.sub))
));
api.post("/integration/winthor/sync-batch", asyncRoute(async (req, res) => {
  const body = z.object({ since: z.string().optional() }).parse(req.body);
  const since = body.since ? new Date(body.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  res.status(202).json(await winthor.syncOrdersBatch(since, req.user!.sub));
}));

// WinThor lookup (read-only)

// List PCPEDC with pagination, filters and sync status
api.get("/winthor/orders", asyncRoute(async (req, res) => {
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
api.get("/winthor/orders/:numped", asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) throw new Error("Oracle não disponível.");
  const adapter = new (await import("../oracle/WinthorAdapter")).WinthorAdapter();
  const numped = param(req.params.numped);
  const [orderRows, items, invoices] = await Promise.all([
    adapter.getOrderByNumber(numped),
    adapter.getOrderItems(numped),
    adapter.getInvoiceByOrder(numped),
  ]);
  if (!orderRows.length) throw new Error("Pedido não encontrado no WinThor.");
  const { queryOne: qo } = await import("../db/db");
  const synced = await qo<{ id: string }>(
    "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
    { numped },
  );
  res.json({ order: orderRows[0], items, invoice: invoices[0] ?? null, synced_id: synced?.id ?? null });
}));
api.get("/winthor/customers/:codcli", asyncRoute(async (req, res) => {
  const adapter = new (await import("../oracle/WinthorAdapter")).WinthorAdapter();
  const customer = await adapter.getCustomerById(param(req.params.codcli));
  res.json(customer[0] ?? null);
}));

// ── Product Commissions ───────────────────────────────────────────────────────

// Count active commission rules (product + department) — used by Agenda empty state
api.get("/commissions/count", asyncRoute(async (_req, res) => {
  const { queryOne: qo } = await import("../db/db");
  const [prod, dept] = await Promise.all([
    qo<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_PRODUCT_COMMISSIONS WHERE ACTIVE = 1"),
    qo<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_DEPT_COMMISSIONS WHERE ACTIVE = 1"),
  ]);
  res.json({ count: Number(prod?.total ?? 0) + Number(dept?.total ?? 0) });
}));

// List all configured commissions (MONT_PRODUCT_COMMISSIONS)
api.get("/commissions", commissionReadRoles, asyncRoute(async (_req, res) => {
  const { queryRows: qr } = await import("../db/db");
  res.json(await qr(
    `SELECT * FROM MONT_PRODUCT_COMMISSIONS ORDER BY DESCRIPTION ASC`,
  ));
}));

// Search PCPRODUT — no VLMAODEOBRA filter (column may not exist); requires search term
api.get("/commissions/departments", commissionReadRoles, asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { queryRows: qr } = await import("../db/db");

  res.json(await qr(
    `SELECT TO_CHAR(CODEPTO) AS CODEPTO, DESCRICAO
     FROM PCDEPTO
     ORDER BY DESCRICAO`,
  ));
}));

api.get("/commissions/search", commissionReadRoles, asyncRoute(async (req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { queryRows: qr } = await import("../db/db");
  const q = String(req.query.q ?? "").trim();
  const coddeps = (Array.isArray(req.query.coddep) ? req.query.coddep : String(req.query.coddep ?? "").split(","))
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 50);
  const all = req.query.all === "1";
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  // Require a product term or a department to avoid fetching all products in PCPRODUT.
  if (q.length < 2 && coddeps.length === 0) { res.json([]); return; }

  const configuredFilter = all
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM MONT_PRODUCT_COMMISSIONS c WHERE c.CODPROD = TO_CHAR(p.CODPROD))";

  const searchFilter = q.length >= 2
    ? "AND (UPPER(p.DESCRICAO) LIKE UPPER(:q) OR TO_CHAR(p.CODPROD) LIKE :q2)"
    : "";
  const departmentPlaceholders = coddeps.map((_, idx) => `:coddep${idx}`);
  const departmentFilter = departmentPlaceholders.length
    ? `AND TO_CHAR(p.CODEPTO) IN (${departmentPlaceholders.join(", ")})`
    : "";

  const binds: Record<string, unknown> = { limit };
  if (q.length >= 2) {
    binds.q = `%${q}%`;
    binds.q2 = `%${q}%`;
  }
  coddeps.forEach((coddep, idx) => {
    binds[`coddep${idx}`] = coddep;
  });

  res.json(await qr(
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
     WHERE 1 = 1
       ${searchFilter}
       ${departmentFilter}
       ${configuredFilter}
     ORDER BY p.DESCRICAO
     FETCH FIRST :limit ROWS ONLY`,
    binds,
  ));
}));

// Upsert commission for a product — supports FIXED_AMOUNT and PERCENTAGE types
api.put("/commissions/:codprod", commissionWriteRoles, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const body = z.object({
    description:       z.string().min(2),
    calculationType:   z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).default("PERCENTAGE"),
    fixedAmount:       z.number().min(0).optional(),
    commissionPercent: z.number().min(0).max(100).optional(),
    active:            z.boolean().default(true),
    notes:             z.string().optional(),
  }).parse(req.body);

  if (body.calculationType === "FIXED_AMOUNT" && (body.fixedAmount == null || body.fixedAmount < 0)) {
    throw Object.assign(new Error("Valor fixo é obrigatório e deve ser >= 0."), { status: 400 });
  }
  if (body.calculationType === "PERCENTAGE" && (body.commissionPercent == null || body.commissionPercent <= 0)) {
    throw Object.assign(new Error("Percentual é obrigatório e deve ser > 0."), { status: 400 });
  }

  const codprod         = param(req.params.codprod);
  const calcType        = body.calculationType;
  const fixedAmt        = body.calculationType === "FIXED_AMOUNT" ? (body.fixedAmount ?? 0) : 0;
  const commissionPct   = body.calculationType === "PERCENTAGE"   ? (body.commissionPercent ?? 0) : 0;

  const existing = await qo<{ id: string }>(
    "SELECT ID FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod",
    { codprod },
  );

  if (existing) {
    await dml(
      `UPDATE MONT_PRODUCT_COMMISSIONS
       SET DESCRIPTION = :descr, CALCULATION_TYPE = :calctype,
           FIXED_AMOUNT = :fixedamt, COMMISSION_PERCENT = :pct,
           ACTIVE = :active, NOTES = :notes,
           UPDATED_BY = :updatedby, UPDATED_AT = SYSTIMESTAMP
       WHERE CODPROD = :codprod`,
      { descr: body.description, calctype: calcType, fixedamt: fixedAmt, pct: commissionPct,
        active: body.active ? 1 : 0, notes: body.notes ?? null,
        updatedby: req.user!.sub, codprod },
    );
  } else {
    await dml(
      `INSERT INTO MONT_PRODUCT_COMMISSIONS
         (ID, CODPROD, DESCRIPTION, VLMAODEOBRA, CALCULATION_TYPE, FIXED_AMOUNT,
          COMMISSION_PERCENT, ACTIVE, NOTES, CREATED_BY, UPDATED_BY)
       VALUES (:id, :codprod, :descr, 0, :calctype, :fixedamt,
               :pct, :active, :notes, :createdby, :updatedby)`,
      { id: uuidv4(), codprod, descr: body.description, calctype: calcType,
        fixedamt: fixedAmt, pct: commissionPct, active: body.active ? 1 : 0,
        notes: body.notes ?? null, createdby: req.user!.sub, updatedby: req.user!.sub },
    );
  }
  res.json({ ok: true, codprod });
}));

// Toggle active or delete commission
api.delete("/commissions/:codprod", commissionWriteRoles, asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml(
    "DELETE FROM MONT_PRODUCT_COMMISSIONS WHERE CODPROD = :codprod",
    { codprod: param(req.params.codprod) },
  );
  res.json({ ok: true });
}));

api.patch("/commissions/:codprod/toggle", commissionWriteRoles, asyncRoute(async (req, res) => {
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

// ── Department Commissions ────────────────────────────────────────────────────

api.get("/commissions/dept", commissionReadRoles, asyncRoute(async (_req, res) => {
  const { queryRows: qr } = await import("../db/db");
  const { isOracleEnabled } = await import("../db/oracle");
  // Join PCDEPTO if Oracle available to get current department name
  if (isOracleEnabled()) {
    res.json(await qr(
      `SELECT d.CODEPTO, NVL(dep.DESCRICAO, d.DESCRIPTION) AS DESCRIPTION,
              d.CALCULATION_TYPE, d.COMMISSION_PERCENT, d.FIXED_AMOUNT,
              d.ACTIVE, d.NOTES, d.CREATED_AT, d.UPDATED_AT
       FROM MONT_DEPT_COMMISSIONS d
       LEFT JOIN PCDEPTO dep ON TO_CHAR(dep.CODEPTO) = d.CODEPTO
       ORDER BY NVL(dep.DESCRICAO, d.DESCRIPTION) ASC`,
    ));
  } else {
    res.json(await qr(`SELECT * FROM MONT_DEPT_COMMISSIONS ORDER BY DESCRIPTION ASC`));
  }
}));

api.put("/commissions/dept/:codepto", commissionWriteRoles, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const body = z.object({
    description:       z.string().min(1),
    calculationType:   z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).default("PERCENTAGE"),
    fixedAmount:       z.number().min(0).optional(),
    commissionPercent: z.number().min(0).max(100).optional(),
    active:            z.boolean().default(true),
    notes:             z.string().optional(),
  }).parse(req.body);

  if (body.calculationType === "FIXED_AMOUNT" && (body.fixedAmount == null || body.fixedAmount < 0))
    throw Object.assign(new Error("Valor fixo obrigatório e deve ser >= 0."), { status: 400 });
  if (body.calculationType === "PERCENTAGE" && (body.commissionPercent == null || body.commissionPercent <= 0))
    throw Object.assign(new Error("Percentual obrigatório e deve ser > 0."), { status: 400 });

  const codepto   = param(req.params.codepto);
  const calcType  = body.calculationType;
  const fixedAmt  = calcType === "FIXED_AMOUNT" ? (body.fixedAmount ?? 0) : 0;
  const pct       = calcType === "PERCENTAGE"   ? (body.commissionPercent ?? 0) : 0;
  const existing  = await qo<{ id: string }>("SELECT ID FROM MONT_DEPT_COMMISSIONS WHERE CODEPTO = :codepto", { codepto });

  if (existing) {
    await dml(
      `UPDATE MONT_DEPT_COMMISSIONS
       SET DESCRIPTION = :descr, CALCULATION_TYPE = :calctype, FIXED_AMOUNT = :fixedamt,
           COMMISSION_PERCENT = :pct, ACTIVE = :active, NOTES = :notes,
           UPDATED_BY = :updatedby, UPDATED_AT = SYSTIMESTAMP
       WHERE CODEPTO = :codepto`,
      { descr: body.description, calctype: calcType, fixedamt: fixedAmt, pct,
        active: body.active ? 1 : 0, notes: body.notes ?? null,
        updatedby: req.user!.sub, codepto },
    );
  } else {
    await dml(
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

api.delete("/commissions/dept/:codepto", commissionWriteRoles, asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml("DELETE FROM MONT_DEPT_COMMISSIONS WHERE CODEPTO = :codepto", { codepto: param(req.params.codepto) });
  res.json({ ok: true });
}));

api.patch("/commissions/dept/:codepto/toggle", commissionWriteRoles, asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml(
    `UPDATE MONT_DEPT_COMMISSIONS
     SET ACTIVE = CASE WHEN ACTIVE = 1 THEN 0 ELSE 1 END,
         UPDATED_AT = SYSTIMESTAMP, UPDATED_BY = :userId
     WHERE CODEPTO = :codepto`,
    { codepto: param(req.params.codepto), userId: req.user!.sub },
  );
  res.json({ ok: true });
}));

// Audit logs
api.get("/audit-logs", auditRoles, asyncRoute(async (_req, res) => {
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

// ── Agenda Inteligente — candidatos com entrega confirmada (PCCARREG.DTFECHA) ──

const agendaEntrega = new AgendaEntregaService();

api.get("/agenda/candidatos", agendaRoles, asyncRoute(async (req, res) => {
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

api.post("/agenda/sync", agendaRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    modo:     z.enum(["DRY_RUN", "PRODUCAO"]).default("DRY_RUN"),
    daysBack: z.coerce.number().int().min(1).max(365).default(60),
  }).parse(req.body);
  res.status(201).json(await agendaEntrega.sync({ modo: body.modo, daysBack: body.daysBack }));
}));

api.get("/agenda/diagnostico", agendaRoles, asyncRoute(async (_req, res) => {
  res.json(await agendaEntrega.diagnostico());
}));

api.get("/agenda/stats", agendaRoles, asyncRoute(async (_req, res) => {
  res.json(await agendaEntrega.getSummaryStats());
}));

// Matching geográfico de montadores para um pedido/cliente
api.get("/agenda/providers-match", agendaRoles, asyncRoute(async (req, res) => {
  const { ProviderMatchingService } = await import("../services/ProviderMatchingService");
  const svc = new ProviderMatchingService();
  const clientLat = req.query.lat ? Number(req.query.lat) : undefined;
  const clientLon = req.query.lon ? Number(req.query.lon) : undefined;
  const clientCity = req.query.city ? String(req.query.city) : undefined;
  const clientUf   = req.query.uf   ? String(req.query.uf)   : undefined;
  res.json(await svc.match({ clientLat, clientLon, clientCity, clientUf }));
}));

api.post("/agenda/candidatos/:numped/montagem-agendada", agendaRoles, asyncRoute(async (req, res) => {
  const numped = param(req.params.numped);
  await agendaEntrega.marcarMontagemAgendada(numped, new Date());
  res.json({ ok: true });
}));

// ── Global Search ─────────────────────────────────────────────────────────────
api.get("/search", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) { res.json({ orders: [], providers: [] }); return; }
  const { queryRows: qr } = await import("../db/db");
  const like = `%${q.toUpperCase()}%`;
  const [ordersRes, providersRes] = await Promise.all([
    qr<any>(
      `SELECT o.ID, o.NUMPED, c.NAME AS CUSTOMER_NAME, o.CURRENT_STATUS
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE UPPER(o.NUMPED) LIKE :q OR UPPER(c.NAME) LIKE :q2
       ORDER BY o.CREATED_AT DESC
       FETCH FIRST 8 ROWS ONLY`,
      { q: like, q2: like },
    ).catch(() => []),
    qr<any>(
      `SELECT ID, NAME, DOCUMENT, CITY, STATUS
       FROM MONT_PROVIDERS
       WHERE UPPER(NAME) LIKE :q OR UPPER(DOCUMENT) LIKE :q2
       ORDER BY NAME
       FETCH FIRST 6 ROWS ONLY`,
      { q: like, q2: like },
    ).catch(() => []),
  ]);
  res.json({ orders: ordersRes, providers: providersRes });
}));

// ── Notifications summary ─────────────────────────────────────────────────────
api.get("/notifications/summary", asyncRoute(async (_req, res) => {
  const { queryOne: qo } = await import("../db/db");
  const safe = async (sql: string) => {
    try { return Number((await qo<{ cnt: number }>(sql, {}))?.cnt ?? 0); }
    catch { return null; }
  };
  const [openSac, blockedPayments, pendingProviders, expiringCerts] = await Promise.all([
    safe("SELECT COUNT(*) AS CNT FROM MONT_SAC_CASES WHERE STATUS NOT IN ('RESOLVIDO','ENCERRADO','CANCELADO')"),
    safe("SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'BLOQUEADO'"),
    safe("SELECT COUNT(*) AS CNT FROM MONT_PROVIDERS WHERE STATUS = 'PENDENTE'"),
    safe("SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_CERTIFICATIONS WHERE VALID_UNTIL <= SYSDATE + 30 AND VALID_UNTIL >= SYSDATE AND STATUS = 'VALIDO'"),
  ]);
  const total = [openSac, blockedPayments, pendingProviders]
    .filter((n): n is number => n !== null)
    .reduce((s, n) => s + n, 0);
  res.json({ openSac, blockedPayments, pendingProviders, expiringCerts, total });
}));

// ── Provider unavailability ───────────────────────────────────────────────────
api.get("/providers/:id/unavailability", asyncRoute(async (req, res) => {
  const { queryRows: qr } = await import("../db/db");
  const providerId = param(req.params.id);
  res.json(await qr(
    `SELECT ID, TO_CHAR(UNAVAIL_DATE, 'YYYY-MM-DD') AS UNAVAIL_DATE, REASON
     FROM MONT_PROVIDER_UNAVAILABILITY
     WHERE PROVIDER_ID = :providerId AND UNAVAIL_DATE >= SYSDATE - 1
     ORDER BY UNAVAIL_DATE`,
    { providerId },
  ));
}));

api.post("/providers/:id/unavailability", asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const providerId = param(req.params.id);
  const body = z.object({
    date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(200).optional(),
  }).parse(req.body);
  const id = uuidv4();
  try {
    await dml(
      `INSERT INTO MONT_PROVIDER_UNAVAILABILITY (ID, PROVIDER_ID, UNAVAIL_DATE, REASON, CREATED_BY)
       VALUES (:id, :providerId, TO_DATE(:dt, 'YYYY-MM-DD'), :reason, :userId)`,
      { id, providerId, dt: body.date, reason: body.reason ?? null, userId: req.user!.sub },
    );
  } catch (err: any) {
    if (/ORA-00001|IDX_MONT_UNAVAIL_PROV/.test(String(err?.message ?? ""))) {
      res.status(409).json({ error: "Data já bloqueada para este montador." });
      return;
    }
    throw err;
  }
  res.status(201).json({ id, date: body.date });
}));

api.delete("/providers/:id/unavailability/:date", asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  await dml(
    `DELETE FROM MONT_PROVIDER_UNAVAILABILITY
     WHERE PROVIDER_ID = :providerId AND UNAVAIL_DATE = TO_DATE(:dt, 'YYYY-MM-DD')`,
    { providerId: param(req.params.id), dt: param(req.params.date) },
  );
  res.json({ ok: true });
}));

// ── Provider certifications ───────────────────────────────────────────────────
api.get("/providers/:id/certifications", asyncRoute(async (req, res) => {
  const { queryRows: qr } = await import("../db/db");
  res.json(await qr(
    `SELECT ID, CERT_TYPE, FILE_URL,
            TO_CHAR(ISSUED_AT, 'YYYY-MM-DD') AS ISSUED_AT,
            TO_CHAR(VALID_UNTIL, 'YYYY-MM-DD') AS VALID_UNTIL,
            STATUS, NOTES, CREATED_AT
     FROM MONT_PROVIDER_CERTIFICATIONS
     WHERE PROVIDER_ID = :providerId
     ORDER BY CERT_TYPE`,
    { providerId: param(req.params.id) },
  ));
}));

api.post("/providers/:id/certifications", asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const providerId = param(req.params.id);
  const body = z.object({
    certType:   z.string().min(3).max(80),
    fileUrl:    z.string().max(2000).optional(),
    issuedAt:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status:     z.enum(["PENDENTE","VALIDO","EXPIRADO","REPROVADO"]).default("PENDENTE"),
    notes:      z.string().max(500).optional(),
  }).parse(req.body);
  const id = uuidv4();
  await dml(
    `INSERT INTO MONT_PROVIDER_CERTIFICATIONS
       (ID, PROVIDER_ID, CERT_TYPE, FILE_URL, ISSUED_AT, VALID_UNTIL, STATUS, NOTES, CREATED_BY)
     VALUES (:id, :providerId, :certType, :fileUrl,
             TO_DATE(:issuedAt, 'YYYY-MM-DD'), TO_DATE(:validUntil, 'YYYY-MM-DD'),
             :status, :notes, :userId)`,
    {
      id, providerId,
      certType: body.certType, fileUrl: body.fileUrl ?? null,
      issuedAt: body.issuedAt ?? null, validUntil: body.validUntil ?? null,
      status: body.status, notes: body.notes ?? null, userId: req.user!.sub,
    },
  );
  res.status(201).json({ id });
}));

api.patch("/providers/:id/certifications/:certId", asyncRoute(async (req, res) => {
  const { execDml: dml } = await import("../db/db");
  const body = z.object({
    status:     z.enum(["PENDENTE","VALIDO","EXPIRADO","REPROVADO"]).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes:      z.string().max(500).optional(),
  }).parse(req.body);
  await dml(
    `UPDATE MONT_PROVIDER_CERTIFICATIONS
     SET STATUS = COALESCE(:status, STATUS),
         VALID_UNTIL = CASE WHEN :hasDate = 1 THEN TO_DATE(:validUntil, 'YYYY-MM-DD') ELSE VALID_UNTIL END,
         NOTES = COALESCE(:notes, NOTES),
         UPDATED_AT = SYSTIMESTAMP
     WHERE ID = :certId AND PROVIDER_ID = :providerId`,
    {
      status: body.status ?? null, hasDate: body.validUntil ? 1 : 0,
      validUntil: body.validUntil ?? null, notes: body.notes ?? null,
      certId: param(req.params.certId), providerId: param(req.params.id),
    },
  );
  res.json({ ok: true });
}));

// ── Provider reworks (read-only list) ─────────────────────────────────────────
api.get("/providers/:id/reworks", asyncRoute(async (req, res) => {
  const { queryRows: qr } = await import("../db/db");
  res.json(await qr(
    `SELECT r.ID, r.REASON, r.STATUS, r.CREATED_AT,
            s.REASON AS SAC_REASON, o.NUMPED
     FROM MONT_ASSEMBLY_REWORKS r
     LEFT JOIN MONT_SAC_CASES s ON s.ID = r.SAC_ID
     LEFT JOIN MONT_ASSEMBLY_JOBS j ON j.ID = r.ASSEMBLY_JOB_ID
     LEFT JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
     WHERE r.PROVIDER_ID = :providerId
     ORDER BY r.CREATED_AT DESC
     FETCH FIRST 50 ROWS ONLY`,
    { providerId: param(req.params.id) },
  ));
}));

// ── Reworks completo (CRUD + classificação) ────────────────────────────────────
const sacRoles = requireRole("ADMIN", "GESTOR", "SAC", "OPERACAO");

api.get("/reworks", sacRoles, asyncRoute(async (req, res) => {
  const { queryRows: qr } = await import("../db/db");
  const rows = await qr(
    `SELECT r.*, p.NAME AS PROVIDER_NAME, o.NUMPED AS ORDER_NUMPED
     FROM MONT_ASSEMBLY_REWORKS r
     LEFT JOIN MONT_PROVIDERS p ON p.ID = r.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_JOBS j ON j.ID = r.ASSEMBLY_JOB_ID
     LEFT JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
     ORDER BY r.CREATED_AT DESC
     FETCH FIRST 200 ROWS ONLY`,
  );
  res.json(rows);
}));

api.get("/reworks/:id", sacRoles, asyncRoute(async (req, res) => {
  const { queryOne: qo } = await import("../db/db");
  const row = await qo(
    `SELECT r.*, p.NAME AS PROVIDER_NAME, o.NUMPED AS ORDER_NUMPED,
            s.REASON AS SAC_REASON, s.STATUS AS SAC_STATUS
     FROM MONT_ASSEMBLY_REWORKS r
     LEFT JOIN MONT_PROVIDERS p ON p.ID = r.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_JOBS j ON j.ID = r.ASSEMBLY_JOB_ID
     LEFT JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
     LEFT JOIN MONT_SAC_CASES s ON s.ID = r.SAC_CASE_ID
     WHERE r.ID = :id`,
    { id: param(req.params.id) },
  );
  if (!row) throw new Error("Retrabalho não encontrado.");
  res.json(row);
}));

api.post("/reworks", sacRoles, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const { v4: uuidv4 } = await import("uuid");
  const { EventService: EvSvc } = await import("../services/EventService");
  const body = z.object({
    assemblyJobId:        z.string().uuid(),
    reason:               z.string().min(5),
    description:          z.string().optional(),
    classification:       z.enum(["MONTAGEM_MAL_FEITA","MONTAGEM_INCOMPLETA","FALTA_DE_FOTO","DANO_AVARIA","CLIENTE_NAO_APROVOU","PRODUTO_INCORRETO","OUTROS"]),
    severity:             z.enum(["BAIXA","MEDIA","ALTA","CRITICA"]).default("MEDIA"),
    sacCaseId:            z.string().optional(),
    requiresReturn:       z.boolean().default(false),
    customerComment:      z.string().optional(),
  }).parse(req.body);

  const job = await qo<{ id: string; provider_id: string; order_id: string }>(
    "SELECT ID, PROVIDER_ID, ORDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :id",
    { id: body.assemblyJobId },
  );
  if (!job) throw new Error("Montagem não encontrada.");

  const order = await qo<{ numped: string; codcli: string }>(
    "SELECT NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
    { id: job.order_id },
  );

  const id = uuidv4();
  await dml(
    `INSERT INTO MONT_ASSEMBLY_REWORKS
       (ID, ASSEMBLY_JOB_ID, PROVIDER_ID, ORIGINAL_PROVIDER_ID, SAC_CASE_ID, REASON, DESCRIPTION,
        CLASSIFICATION, SEVERITY, STATUS, REQUIRES_RETURN, NUMPED, CODCLI, CUSTOMER_COMMENT, CREATED_BY)
     VALUES
       (:id, :jobId, :provId, :origProv, :sacId, :reason, :desc,
        :cls, :sev, 'ABERTO', :reqRet, :numped, :codcli, :custCmt, :createdBy)`,
    {
      id, jobId: body.assemblyJobId, provId: job.provider_id, origProv: job.provider_id,
      sacId: body.sacCaseId ?? null, reason: body.reason, desc: body.description ?? null,
      cls: body.classification, sev: body.severity, reqRet: body.requiresReturn ? 1 : 0,
      numped: order?.numped ?? null, codcli: order?.codcli ?? null,
      custCmt: body.customerComment ?? null, createdBy: req.user!.sub,
    },
  );

  const evSvc = new EvSvc();
  await evSvc.emit({
    type: "REWORK_CREATED",
    orderId: job.order_id ?? "",
    numped: order?.numped ?? "",
    codcli: order?.codcli ?? "",
    origin: "SAC",
    metadata: { description: `Retrabalho criado: ${body.reason}. Classificação: ${body.classification}.`, reworkId: id },
    idempotencyKey: `rework-created:${id}`,
  });

  res.status(201).json({ id });
}));

api.patch("/reworks/:id", sacRoles, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const { features: ff } = await import("../config");
  const body = z.object({
    status:              z.enum(["ABERTO","EM_ANALISE","AGUARDANDO_RETORNO","REAGENDADO","EM_EXECUCAO","CORRIGIDO","CANCELADO","ENCERRADO"]).optional(),
    procedente:          z.boolean().optional(),
    affectsProviderScore:z.boolean().optional(),
    affectsPayment:      z.boolean().optional(),
    sacComment:          z.string().optional(),
    approvedBy:          z.string().optional(),
  }).parse(req.body);

  const rework = await qo<{ id: string; provider_id: string }>(
    "SELECT ID, PROVIDER_ID FROM MONT_ASSEMBLY_REWORKS WHERE ID = :id",
    { id: param(req.params.id) },
  );
  if (!rework) throw new Error("Retrabalho não encontrado.");

  const sets: string[] = ["UPDATED_AT = SYSTIMESTAMP"];
  const binds: Record<string, unknown> = { id: param(req.params.id) };

  if (body.status !== undefined) {
    sets.push("STATUS = :status");
    binds.status = body.status;
    if (body.status === "ENCERRADO" || body.status === "CORRIGIDO") {
      sets.push("RESOLVED_AT = SYSTIMESTAMP", "RESOLVED_BY = :resolvedBy");
      binds.resolvedBy = req.user!.sub;
    }
  }
  if (body.procedente !== undefined) { sets.push("PROCEDENTE = :proc"); binds.proc = body.procedente ? 1 : 0; }
  if (body.affectsProviderScore !== undefined && ff.reworkScoreImpact) {
    sets.push("AFFECTS_PROVIDER_SCORE = :aps"); binds.aps = body.affectsProviderScore ? 1 : 0;
  }
  if (body.affectsPayment !== undefined) { sets.push("AFFECTS_PAYMENT = :ap"); binds.ap = body.affectsPayment ? 1 : 0; }
  if (body.sacComment !== undefined) { sets.push("SAC_COMMENT = :sacCmt"); binds.sacCmt = body.sacComment; }
  if (body.approvedBy !== undefined) { sets.push("APPROVED_BY = :apprBy"); binds.apprBy = body.approvedBy; }

  await dml(
    `UPDATE MONT_ASSEMBLY_REWORKS SET ${sets.join(", ")} WHERE ID = :id`,
    binds,
  );
  res.json({ ok: true });
}));

// ── Bulk payment actions ──────────────────────────────────────────────────────
api.post("/payments/bulk-release", financeiroRoles, asyncRoute(async (req, res) => {
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

api.post("/payments/bulk-program", financeiroRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    ids:          z.array(z.string()).min(1).max(50),
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

// ── PIX Payment routes ────────────────────────────────────────────────────────

api.get("/pix/mode", financeiroRoles, asyncRoute(async (_req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const svc = new PixPaymentService();
  res.json({ mode: svc.getMode() });
}));

api.post("/payments/:id/pix", financeiroRoles, asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const svc = new PixPaymentService();
  const result = await svc.requestPayment(param(req.params.id), req.user!.sub);
  res.status(201).json(result);
}));

api.get("/providers/:id/pix-account", financeiroRoles, asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const svc = new PixPaymentService();
  const account = await svc.getProviderAccount(param(req.params.id));
  res.json(account ?? null);
}));

api.put("/providers/:id/pix-account", requireRole("ADMIN", "GESTOR"), asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const svc = new PixPaymentService();
  const body = z.object({
    pixKeyType: z.enum(["CPF", "CNPJ", "EMAIL", "TELEFONE", "CHAVE_ALEATORIA"]),
    pixKey:     z.string().min(3).max(255),
    holderName: z.string().min(2),
    holderDocument: z.string().optional(),
  }).parse(req.body);
  await svc.upsertProviderAccount(param(req.params.id), body);
  res.json({ ok: true });
}));

api.post("/providers/:id/pix-account/validate", requireRole("ADMIN", "GESTOR"), asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const { queryOne: qo } = await import("../db/db");
  const svc = new PixPaymentService();
  const account = await qo<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDER_PAYMENT_ACCOUNTS WHERE PROVIDER_ID = :pid",
    { pid: param(req.params.id) },
  );
  if (!account) throw new Error("Conta PIX não encontrada.");
  await svc.validateAccount(account.id, req.user!.sub);
  res.json({ ok: true });
}));

// ── Provider dashboard summary (App Montador) ─────────────────────────────────
api.get("/assembly/provider/dashboard", authMiddleware, asyncRoute(async (req, res) => {
  const { queryOne: qo } = await import("../db/db");
  const userId = req.user!.sub;

  const provider = await qo<{ id: string }>(
    "SELECT p.ID FROM MONT_PROVIDERS p JOIN MONT_USERS u ON u.EMAIL = p.EMAIL WHERE u.ID = :userId",
    { userId },
  ).catch(() => null);
  if (!provider) { res.json({ providerId: null, weekJobs: 0, pendingBalance: 0, expiringDocs: 0 }); return; }

  const providerId = provider.id;
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const certDeadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [weekRow, balanceRow, docsRow] = await Promise.all([
    qo<{ cnt: number }>(
      `SELECT COUNT(*) AS CNT FROM MONT_ASSEMBLY_JOBS j
       JOIN MONT_ASSEMBLY_SCHEDULES s ON s.ID = j.SCHEDULE_ID
       WHERE j.PROVIDER_ID = :providerId AND j.STATUS NOT IN ('CANCELADA','FINALIZADA')
         AND s.SCHEDULED_DATE BETWEEN :today AND :weekEnd`,
      { providerId, today, weekEnd },
    ),
    qo<{ total: number }>(
      `SELECT NVL(SUM(AMOUNT),0) AS TOTAL FROM MONT_PROVIDER_PAYMENTS
       WHERE PROVIDER_ID = :providerId AND STATUS IN ('AGUARDANDO_FINALIZACAO','AGUARDANDO_AVALIACAO_CLIENTE','LIBERADO')`,
      { providerId },
    ),
    qo<{ cnt: number }>(
      `SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_CERTIFICATIONS
       WHERE PROVIDER_ID = :providerId AND STATUS NOT IN ('EXPIRADO','REPROVADO')
         AND VALID_UNTIL IS NOT NULL AND VALID_UNTIL <= TO_DATE(:deadline, 'YYYY-MM-DD')`,
      { providerId, deadline: certDeadline },
    ).catch(() => ({ cnt: 0 })),
  ]);

  res.json({
    providerId,
    weekJobs: Number(weekRow?.cnt ?? 0),
    pendingBalance: Number(balanceRow?.total ?? 0),
    expiringDocs: Number(docsRow?.cnt ?? 0),
  });
}));

// ── Provider monthly commissions history ───────────────────────────────────────
api.get("/providers/:id/commissions/monthly", authMiddleware, asyncRoute(async (req, res) => {
  const { queryRows: qr } = await import("../db/db");
  res.json(await qr(
    `SELECT
       TO_CHAR(pp.CREATED_AT, 'YYYY-MM') AS MONTH_KEY,
       TO_CHAR(pp.CREATED_AT, 'MM/YYYY') AS MONTH_LABEL,
       COUNT(pp.ID) AS JOB_COUNT,
       NVL(SUM(pp.AMOUNT),0) AS TOTAL_AMOUNT,
       NVL(SUM(CASE WHEN pp.STATUS = 'PAGO' THEN pp.AMOUNT ELSE 0 END),0) AS PAID_AMOUNT,
       NVL(SUM(CASE WHEN pp.STATUS NOT IN ('PAGO','CANCELADO') THEN pp.AMOUNT ELSE 0 END),0) AS PENDING_AMOUNT
     FROM MONT_PROVIDER_PAYMENTS pp
     WHERE pp.PROVIDER_ID = :providerId AND pp.STATUS != 'CANCELADO'
     GROUP BY TO_CHAR(pp.CREATED_AT, 'YYYY-MM'), TO_CHAR(pp.CREATED_AT, 'MM/YYYY')
     ORDER BY 1 DESC
     FETCH FIRST 24 ROWS ONLY`,
    { providerId: param(req.params.id) },
  ));
}));

// ── System health (detailed) ───────────────────────────────────────────────────
api.get("/system/health", authMiddleware, asyncRoute(async (_req, res) => {
  const { isOracleEnabled } = await import("../db/oracle");
  const { queryOne: qo, queryRows: qr } = await import("../db/db");

  let dbLatencyMs: number | null = null;
  let dbStatus: "ok" | "disabled" | "error" = "disabled";

  if (isOracleEnabled()) {
    const t0 = Date.now();
    try {
      await qo("SELECT 1 AS X FROM DUAL", {});
      dbLatencyMs = Date.now() - t0;
      dbStatus = "ok";
    } catch {
      dbStatus = "error";
    }
  }

  const [failureCount, lastSyncRow, recentFailures] = await Promise.all([
    qo<{ cnt: number }>(
      "SELECT COUNT(*) AS CNT FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL",
      {},
    ).catch(() => ({ cnt: 0 })),
    qo<{ iniciado_em: string; run_status: string; pedidos_encontrados: number; eventos_gerados: number }>(
      "SELECT INICIADO_EM, RUN_STATUS, PEDIDOS_ENCONTRADOS, EVENTOS_GERADOS FROM MONT_SYNC_RUNS ORDER BY INICIADO_EM DESC FETCH FIRST 1 ROWS ONLY",
      {},
    ).catch(() => null),
    qr(
      "SELECT OPERATION, ERROR_MESSAGE, CREATED_AT FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL ORDER BY CREATED_AT DESC FETCH FIRST 5 ROWS ONLY",
      {},
    ).catch(() => []),
  ]);

  res.json({
    db: { status: dbStatus, latencyMs: dbLatencyMs },
    openFailures: Number((failureCount as any)?.cnt ?? 0),
    lastSync: lastSyncRow ?? null,
    recentFailures,
  });
}));

// ── Integration failure re-sync ────────────────────────────────────────────────
api.post("/integration/failures/:id/retry", authMiddleware, asyncRoute(async (req, res) => {
  const { execDml: dml, queryOne: qo } = await import("../db/db");
  const id = param(req.params.id);
  const failure = await qo<{ id: string; retry_count: number }>(
    "SELECT ID, RETRY_COUNT FROM MONT_INTEGRATION_FAILURES WHERE ID = :id AND RESOLVED_AT IS NULL",
    { id },
  );
  if (!failure) { res.status(404).json({ error: "Falha não encontrada ou já resolvida." }); return; }
  await dml(
    "UPDATE MONT_INTEGRATION_FAILURES SET RETRY_COUNT = RETRY_COUNT + 1, RESOLVED_AT = SYSTIMESTAMP WHERE ID = :id",
    { id },
  );
  res.json({ ok: true, retryCount: Number(failure.retry_count) + 1 });
}));

// ── Notificações do montador ──────────────────────────────────────────────────

const providerNotifSvc = new ProviderNotificationService();

async function resolveProviderByEmail(email: string): Promise<string | null> {
  const { queryOne: qo } = await import("../db/db");
  const row = await qo<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
    { email },
  );
  return row?.id ?? null;
}

api.get("/provider-notifications", asyncRoute(async (req, res) => {
  const providerId = await resolveProviderByEmail(req.user!.email);
  if (!providerId) { res.json({ rows: [], unread: 0 }); return; }
  const unreadOnly = req.query.unread === "true";
  const rows = await providerNotifSvc.listForProvider(providerId, unreadOnly);
  const unread = await providerNotifSvc.unreadCount(providerId);
  res.json({ rows, unread });
}));

api.patch("/provider-notifications/:id/read", asyncRoute(async (req, res) => {
  const providerId = await resolveProviderByEmail(req.user!.email);
  if (!providerId) { res.status(403).json({ error: "Montador não encontrado." }); return; }
  const ok = await providerNotifSvc.markRead(param(req.params.id), providerId);
  if (!ok) { res.status(404).json({ error: "Notificação não encontrada." }); return; }
  res.json({ ok: true });
}));

// ── Configuração de avaliações por fase ────────────────────────────────────────

const evalConfigSvc = new EvaluationConfigService();
const evalLinkSvc   = new EvaluationLinkService();
const evalRespSvc   = new EvaluationResponseService();

const evalAdminRoles = requireRole("ADMIN", "GESTOR");

api.get("/eval-configs", evalAdminRoles, asyncRoute(async (_req, res) => {
  res.json(await evalConfigSvc.list());
}));

api.post("/eval-configs", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    phase:       z.enum(["ATENDIMENTO", "ENTREGA", "MONTAGEM"]),
    title:       z.string().min(3).max(255),
    description: z.string().max(2000).optional(),
    linkTtlDays: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.body);
  res.status(201).json(await evalConfigSvc.create({ ...body, userId: req.user!.sub }));
}));

api.get("/eval-configs/:id", evalAdminRoles, asyncRoute(async (req, res) => {
  const config = await evalConfigSvc.getById(param(req.params.id));
  if (!config) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json(config);
}));

api.put("/eval-configs/:id", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    title:       z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional(),
    linkTtlDays: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.body);
  const updated = await evalConfigSvc.update(param(req.params.id), { ...body, userId: req.user!.sub });
  if (!updated) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json(updated);
}));

api.patch("/eval-configs/:id/toggle-active", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const ok = await evalConfigSvc.toggleActive(param(req.params.id), body.active);
  if (!ok) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json({ ok: true });
}));

api.get("/eval-configs/:id/questions", evalAdminRoles, asyncRoute(async (req, res) => {
  const config = await evalConfigSvc.getById(param(req.params.id));
  if (!config) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json(config.questions ?? []);
}));

api.post("/eval-configs/:id/questions", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    type:     z.enum(["SCALE", "STARS", "TEXT", "SINGLE_CHOICE"]).optional(),
    label:    z.string().min(3).max(500),
    required: z.boolean().optional(),
    minLabel: z.string().max(100).optional(),
    maxLabel: z.string().max(100).optional(),
    options:  z.array(z.string().min(1)).optional(),
    position: z.coerce.number().int().min(1).optional(),
  }).parse(req.body);
  res.status(201).json(await evalConfigSvc.addQuestion(param(req.params.id), body));
}));

api.put("/eval-configs/questions/:qid", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    label:    z.string().min(3).max(500).optional(),
    required: z.boolean().optional(),
    minLabel: z.string().max(100).optional(),
    maxLabel: z.string().max(100).optional(),
    options:  z.array(z.string().min(1)).optional(),
    position: z.coerce.number().int().min(1).optional(),
  }).parse(req.body);
  const ok = await evalConfigSvc.updateQuestion(param(req.params.qid), body);
  if (!ok) { res.status(404).json({ error: "Pergunta não encontrada." }); return; }
  res.json({ ok: true });
}));

api.delete("/eval-configs/questions/:qid", evalAdminRoles, asyncRoute(async (req, res) => {
  const ok = await evalConfigSvc.deleteQuestion(param(req.params.qid));
  if (!ok) { res.status(404).json({ error: "Pergunta não encontrada." }); return; }
  res.json({ ok: true });
}));

// ── Gerar link de avaliação ────────────────────────────────────────────────────

api.post("/eval-links", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    phase:          z.enum(["ATENDIMENTO", "ENTREGA", "MONTAGEM"]),
    orderId:        z.string().optional(),
    assemblyJobId:  z.string().optional(),
    numped:         z.string().optional(),
    codcli:         z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await evalLinkSvc.generate({ ...body, userId: req.user!.sub }));
}));

