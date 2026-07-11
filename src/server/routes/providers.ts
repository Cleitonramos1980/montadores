import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "../middleware/auth";
import { AppError, ForbiddenError } from "../errors";
import { ProviderService } from "../services/ProviderService";
import { ProviderNotificationService } from "../services/ProviderNotificationService";
import { execDml, queryOne, queryRows } from "../db/db";
import { param, asyncRoute } from "../utils/route";
import { httpUrl } from "../utils/validators";

export const providersRouter = Router();

const providers            = new ProviderService();
const providerNotifSvc     = new ProviderNotificationService();
const providerAdminRoles   = requireRole("ADMIN", "GESTOR");
const sacRoles             = requireRole("ADMIN", "GESTOR", "SAC", "OPERACAO");

// MONTADOR só pode modificar seus próprios dados — admin/gestor podem modificar qualquer um
async function assertProviderOwnership(req: Request, providerId: string): Promise<void> {
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
  if (!provider || provider.id !== providerId) {
    throw new ForbiddenError("Acesso negado: você só pode gerenciar seus próprios dados de montador.");
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

providersRouter.post("/providers", asyncRoute(async (req, res) => {
  const body = z.object({
    name:           z.string().min(3),
    tradeName:      z.string().optional(),
    document:       z.string().min(5),
    phone:          z.string().min(8),
    whatsapp:       z.string().optional(),
    email:          z.string().email().optional().or(z.literal("")),
    city:           z.string().optional(),
    uf:             z.string().max(2).optional(),
    cep:            z.string().optional(),
    regions:        z.array(z.string()).default([]),
    serviceTypes:   z.array(z.string()).default([]),
    productTypes:   z.array(z.string()).default([]),
    capacityPerDay: z.number().int().positive().default(1),
    codfornec:      z.string().optional(),
    pixKey:         z.string().optional(),
    pixKeyType:     z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await providers.register(body));
}));

providersRouter.get("/providers", asyncRoute(async (_req, res) => res.json(await providers.list())));

providersRouter.get("/providers/winthor/search", asyncRoute(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) { res.json([]); return; }
  const { isOracleEnabled } = await import("../db/oracle");
  if (!isOracleEnabled()) { res.json([]); return; }
  const { WinthorAdapter } = await import("../oracle/WinthorAdapter");
  res.json(await new WinthorAdapter().searchSuppliers(q));
}));

providersRouter.get("/providers/:id/profile", asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  await assertProviderOwnership(req, id);
  const [provider, avgScore, totalJobs, payments] = await Promise.all([
    providers.getById(id),
    queryOne<{ avg_score: number | null }>(
      `SELECT ROUND(AVG(r.SCORE), 1) AS AVG_SCORE
       FROM MONT_CUSTOMER_REVIEWS r
       JOIN MONT_ASSEMBLY_JOBS j ON j.ORDER_ID = r.ORDER_ID
       WHERE j.PROVIDER_ID = :id AND r.SERVICE_TYPE = 'MONTAGEM'`,
      { id },
    ),
    queryOne<{ total: number; finished: number; in_progress: number }>(
      `SELECT COUNT(*) AS TOTAL,
              SUM(CASE WHEN STATUS = 'FINALIZADA' THEN 1 ELSE 0 END) AS FINISHED,
              SUM(CASE WHEN STATUS = 'EM_EXECUCAO' THEN 1 ELSE 0 END) AS IN_PROGRESS
       FROM MONT_ASSEMBLY_JOBS WHERE PROVIDER_ID = :id`,
      { id },
    ),
    queryOne<{ total_paid: number; total_pending: number }>(
      `SELECT SUM(CASE WHEN STATUS = 'PAGO' THEN AMOUNT ELSE 0 END) AS TOTAL_PAID,
              SUM(CASE WHEN STATUS != 'PAGO' THEN AMOUNT ELSE 0 END) AS TOTAL_PENDING
       FROM MONT_PROVIDER_PAYMENTS WHERE PROVIDER_ID = :id`,
      { id },
    ),
  ]);
  res.json({
    ...provider,
    stats: {
      avgScore:       avgScore?.avg_score ?? null,
      totalJobs:      Number(totalJobs?.total ?? 0),
      finishedJobs:   Number(totalJobs?.finished ?? 0),
      inProgressJobs: Number(totalJobs?.in_progress ?? 0),
      totalPaid:      Number(payments?.total_paid ?? 0),
      totalPending:   Number(payments?.total_pending ?? 0),
    },
  });
}));

providersRouter.get("/providers/:id", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  res.json(await providers.getById(param(req.params.id)));
}));

// ── Status transitions ────────────────────────────────────────────────────────

providersRouter.post("/providers/:id/approve", providerAdminRoles, asyncRoute(async (req, res) =>
  res.json(await providers.approve(param(req.params.id), req.user!.sub, req.body.justification ?? "Aprovado pela operação"))
));
providersRouter.post("/providers/:id/reject", providerAdminRoles, asyncRoute(async (req, res) =>
  res.json(await providers.reject(param(req.params.id), req.user!.sub, req.body.justification ?? "Reprovado pela operação"))
));
providersRouter.post("/providers/:id/suspend", providerAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.suspend(param(req.params.id), req.user!.sub, body.justification));
}));
providersRouter.post("/providers/:id/reactivate", providerAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({ justification: z.string().min(3) }).parse(req.body);
  res.json(await providers.reactivate(param(req.params.id), req.user!.sub, body.justification));
}));

// ── Monthly commissions (financeiro/admin ou o próprio montador) ─────────────

providersRouter.get("/providers/:id/commissions/monthly", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  res.json(await queryRows(
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

// ── Unavailability ────────────────────────────────────────────────────────────

providersRouter.get("/providers/:id/unavailability", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  res.json(await queryRows(
    `SELECT ID, TO_CHAR(UNAVAIL_DATE, 'YYYY-MM-DD') AS UNAVAIL_DATE, REASON
     FROM MONT_PROVIDER_UNAVAILABILITY
     WHERE PROVIDER_ID = :providerId AND UNAVAIL_DATE >= SYSDATE - 1
     ORDER BY UNAVAIL_DATE`,
    { providerId: param(req.params.id) },
  ));
}));

providersRouter.post("/providers/:id/unavailability", asyncRoute(async (req, res) => {
  const providerId = param(req.params.id);
  await assertProviderOwnership(req, providerId);
  const body = z.object({
    date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(200).optional(),
  }).parse(req.body);
  const id = uuidv4();
  try {
    await execDml(
      `INSERT INTO MONT_PROVIDER_UNAVAILABILITY (ID, PROVIDER_ID, UNAVAIL_DATE, REASON, CREATED_BY)
       VALUES (:id, :providerId, TO_DATE(:dt, 'YYYY-MM-DD'), :reason, :userId)`,
      { id, providerId, dt: body.date, reason: body.reason ?? null, userId: req.user!.sub },
    );
  } catch (err: unknown) {
    if (/ORA-00001|IDX_MONT_UNAVAIL_PROV/.test(String((err as Error)?.message ?? ""))) {
      res.status(409).json({ error: "Data já bloqueada para este montador." });
      return;
    }
    throw err;
  }
  res.status(201).json({ id, date: body.date });
}));

providersRouter.delete("/providers/:id/unavailability/:date", asyncRoute(async (req, res) => {
  const providerId = param(req.params.id);
  await assertProviderOwnership(req, providerId);
  await execDml(
    `DELETE FROM MONT_PROVIDER_UNAVAILABILITY
     WHERE PROVIDER_ID = :providerId AND UNAVAIL_DATE = TO_DATE(:dt, 'YYYY-MM-DD')`,
    { providerId, dt: param(req.params.date) },
  );
  res.json({ ok: true });
}));

// ── Certifications ────────────────────────────────────────────────────────────

providersRouter.get("/providers/:id/certifications", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  res.json(await queryRows(
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

providersRouter.post("/providers/:id/certifications", asyncRoute(async (req, res) => {
  const providerId = param(req.params.id);
  await assertProviderOwnership(req, providerId);
  const body = z.object({
    certType:   z.string().min(3).max(80),
    fileUrl:    httpUrl.optional(),
    issuedAt:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status:     z.enum(["PENDENTE", "VALIDO", "EXPIRADO", "REPROVADO"]).default("PENDENTE"),
    notes:      z.string().max(500).optional(),
  }).parse(req.body);
  const id = uuidv4();
  await execDml(
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

providersRouter.patch("/providers/:id/certifications/:certId", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  const body = z.object({
    status:     z.enum(["PENDENTE", "VALIDO", "EXPIRADO", "REPROVADO"]).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes:      z.string().max(500).optional(),
  }).parse(req.body);
  await execDml(
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

// ── Reworks (read-only per provider) ─────────────────────────────────────────

providersRouter.get("/providers/:id/reworks", asyncRoute(async (req, res) => {
  await assertProviderOwnership(req, param(req.params.id));
  res.json(await queryRows(
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

// ── Reworks global CRUD ───────────────────────────────────────────────────────

providersRouter.get("/reworks", sacRoles, asyncRoute(async (_req, res) =>
  res.json(await queryRows(
    `SELECT r.*, p.NAME AS PROVIDER_NAME, o.NUMPED AS ORDER_NUMPED
     FROM MONT_ASSEMBLY_REWORKS r
     LEFT JOIN MONT_PROVIDERS p ON p.ID = r.PROVIDER_ID
     LEFT JOIN MONT_ASSEMBLY_JOBS j ON j.ID = r.ASSEMBLY_JOB_ID
     LEFT JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
     ORDER BY r.CREATED_AT DESC
     FETCH FIRST 200 ROWS ONLY`,
  ))
));

providersRouter.get("/reworks/:id", sacRoles, asyncRoute(async (req, res) => {
  const row = await queryOne(
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
  if (!row) throw new AppError("Retrabalho não encontrado.", 404, "NOT_FOUND");
  res.json(row);
}));

providersRouter.post("/reworks", sacRoles, asyncRoute(async (req, res) => {
  const { EventService: EvSvc } = await import("../services/EventService");
  const body = z.object({
    assemblyJobId:   z.string().uuid(),
    reason:          z.string().min(5),
    description:     z.string().optional(),
    classification:  z.enum(["MONTAGEM_MAL_FEITA", "MONTAGEM_INCOMPLETA", "FALTA_DE_FOTO", "DANO_AVARIA", "CLIENTE_NAO_APROVOU", "PRODUTO_INCORRETO", "OUTROS"]),
    severity:        z.enum(["BAIXA", "MEDIA", "ALTA", "CRITICA"]).default("MEDIA"),
    sacCaseId:       z.string().optional(),
    requiresReturn:  z.boolean().default(false),
    customerComment: z.string().optional(),
  }).parse(req.body);

  const job = await queryOne<{ id: string; provider_id: string; order_id: string }>(
    "SELECT ID, PROVIDER_ID, ORDER_ID FROM MONT_ASSEMBLY_JOBS WHERE ID = :id",
    { id: body.assemblyJobId },
  );
  if (!job) throw new AppError("Montagem não encontrada.", 404, "NOT_FOUND");

  const order = await queryOne<{ numped: string; codcli: string }>(
    "SELECT NUMPED, CODCLI FROM MONT_ORDERS WHERE ID = :id",
    { id: job.order_id },
  );

  const id = uuidv4();
  await execDml(
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

  await new EvSvc().emit({
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

providersRouter.patch("/reworks/:id", sacRoles, asyncRoute(async (req, res) => {
  const { features: ff } = await import("../config");
  const body = z.object({
    status:               z.enum(["ABERTO", "EM_ANALISE", "AGUARDANDO_RETORNO", "REAGENDADO", "EM_EXECUCAO", "CORRIGIDO", "CANCELADO", "ENCERRADO"]).optional(),
    procedente:           z.boolean().optional(),
    affectsProviderScore: z.boolean().optional(),
    affectsPayment:       z.boolean().optional(),
    sacComment:           z.string().optional(),
    approvedBy:           z.string().optional(),
  }).parse(req.body);

  const rework = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_ASSEMBLY_REWORKS WHERE ID = :id",
    { id: param(req.params.id) },
  );
  if (!rework) throw new AppError("Retrabalho não encontrado.", 404, "NOT_FOUND");

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
  if (body.procedente !== undefined)          { sets.push("PROCEDENTE = :proc");           binds.proc   = body.procedente ? 1 : 0; }
  if (body.affectsProviderScore !== undefined && ff.reworkScoreImpact) {
                                               sets.push("AFFECTS_PROVIDER_SCORE = :aps"); binds.aps    = body.affectsProviderScore ? 1 : 0; }
  if (body.affectsPayment !== undefined)      { sets.push("AFFECTS_PAYMENT = :ap");        binds.ap     = body.affectsPayment ? 1 : 0; }
  if (body.sacComment !== undefined)          { sets.push("SAC_COMMENT = :sacCmt");        binds.sacCmt = body.sacComment; }
  if (body.approvedBy !== undefined)          { sets.push("APPROVED_BY = :apprBy");        binds.apprBy = body.approvedBy; }

  await execDml(`UPDATE MONT_ASSEMBLY_REWORKS SET ${sets.join(", ")} WHERE ID = :id`, binds);
  res.json({ ok: true });
}));

// ── PIX account ───────────────────────────────────────────────────────────────

providersRouter.get("/providers/:id/pix-account", requireRole("FINANCEIRO", "ADMIN", "GESTOR"), asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  res.json(await new PixPaymentService().getProviderAccount(param(req.params.id)) ?? null);
}));

providersRouter.put("/providers/:id/pix-account", providerAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    pixKeyType:      z.enum(["CPF", "CNPJ", "EMAIL", "TELEFONE", "CHAVE_ALEATORIA"]),
    pixKey:          z.string().min(3).max(255),
    holderName:      z.string().min(2),
    holderDocument:  z.string().optional(),
  }).parse(req.body);
  await new (await import("../services/PixPaymentService")).PixPaymentService().upsertProviderAccount(param(req.params.id), body);
  res.json({ ok: true });
}));

providersRouter.post("/providers/:id/pix-account/validate", providerAdminRoles, asyncRoute(async (req, res) => {
  const { PixPaymentService } = await import("../services/PixPaymentService");
  const svc     = new PixPaymentService();
  const account = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDER_PAYMENT_ACCOUNTS WHERE PROVIDER_ID = :pid",
    { pid: param(req.params.id) },
  );
  if (!account) throw new AppError("Conta PIX não encontrada.", 404, "NOT_FOUND");
  await svc.validateAccount(account.id, req.user!.sub);
  res.json({ ok: true });
}));

// ── Provider notifications ────────────────────────────────────────────────────

async function resolveProviderByEmail(email: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_PROVIDERS WHERE LOWER(EMAIL) = LOWER(:email) AND ACTIVE = 1",
    { email },
  );
  return row?.id ?? null;
}

providersRouter.get("/provider-notifications", asyncRoute(async (req, res) => {
  const providerId = await resolveProviderByEmail(req.user!.email);
  if (!providerId) { res.json({ rows: [], unread: 0 }); return; }
  const unreadOnly = req.query.unread === "true";
  const [rows, unread] = await Promise.all([
    providerNotifSvc.listForProvider(providerId, unreadOnly),
    providerNotifSvc.unreadCount(providerId),
  ]);
  res.json({ rows, unread });
}));

providersRouter.patch("/provider-notifications/:id/read", asyncRoute(async (req, res) => {
  const providerId = await resolveProviderByEmail(req.user!.email);
  if (!providerId) { res.status(403).json({ error: "Montador não encontrado." }); return; }
  const ok = await providerNotifSvc.markRead(param(req.params.id), providerId);
  if (!ok) { res.status(404).json({ error: "Notificação não encontrada." }); return; }
  res.json({ ok: true });
}));
