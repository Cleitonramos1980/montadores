import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth";
import { MessageTemplateService } from "../services/MessageTemplateService";
import { FlowService } from "../services/FlowService";
import { EvaluationConfigService } from "../services/EvaluationConfigService";
import { EvaluationLinkService } from "../services/EvaluationLinkService";
import { queryOne, queryRows } from "../db/db";
import { param, asyncRoute } from "../utils/route";
import { cache } from "../utils/cache";

export const evaluationsRouter = Router();

const messageTemplates = new MessageTemplateService();
const flow             = new FlowService();
const evalConfigSvc    = new EvaluationConfigService();
const evalLinkSvc      = new EvaluationLinkService();
const evalAdminRoles   = requireRole("ADMIN", "GESTOR");
// Leitura de templates: espelha o guard "staff" que existia na api.ts, para não
// regredir a proteção agora que este router resolve a rota primeiro.
const staffReadRoles   = requireRole("ADMIN", "GESTOR", "OPERACAO", "FINANCEIRO", "LOGISTICA", "SAC");

// ── Message templates ─────────────────────────────────────────────────────────

evaluationsRouter.get("/message-templates", staffReadRoles, asyncRoute(async (_req, res) =>
  res.json(await messageTemplates.list())
));

evaluationsRouter.put("/message-templates/:eventType", requireRole("ADMIN", "GESTOR"), asyncRoute(async (req, res) => {
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

// ── Flow ruler ────────────────────────────────────────────────────────────────

const FLOW_RULER_TTL  = 5 * 60_000;
const EVAL_CONFIG_TTL = 5 * 60_000;

evaluationsRouter.get("/flow-ruler/stats", asyncRoute(async (_req, res) => res.json(await flow.rulerStats())));
evaluationsRouter.get("/flow-ruler", asyncRoute(async (_req, res) =>
  res.json(await cache.getOrSet("flow-ruler", FLOW_RULER_TTL, () => flow.ruler()))
));

// ── Eval configs ──────────────────────────────────────────────────────────────

evaluationsRouter.get("/eval-configs", evalAdminRoles, asyncRoute(async (_req, res) =>
  res.json(await cache.getOrSet("eval-configs:list", EVAL_CONFIG_TTL, () => evalConfigSvc.list()))
));

evaluationsRouter.post("/eval-configs", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    phase:       z.enum(["ATENDIMENTO", "ENTREGA", "MONTAGEM"]),
    title:       z.string().min(3).max(255),
    description: z.string().max(2000).optional(),
    linkTtlDays: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.body);
  const created = await evalConfigSvc.create({ ...body, userId: req.user!.sub });
  cache.invalidate("eval-configs:list");
  res.status(201).json(created);
}));

evaluationsRouter.get("/eval-configs/:id", evalAdminRoles, asyncRoute(async (req, res) => {
  const config = await evalConfigSvc.getById(param(req.params.id));
  if (!config) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json(config);
}));

evaluationsRouter.put("/eval-configs/:id", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    title:       z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional(),
    linkTtlDays: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.body);
  const updated = await evalConfigSvc.update(param(req.params.id), { ...body, userId: req.user!.sub });
  if (!updated) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  cache.invalidate("eval-configs:list");
  res.json(updated);
}));

evaluationsRouter.patch("/eval-configs/:id/toggle-active", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const ok   = await evalConfigSvc.toggleActive(param(req.params.id), body.active);
  if (!ok) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  cache.invalidate("eval-configs:list");
  res.json({ ok: true });
}));

evaluationsRouter.get("/eval-configs/:id/questions", evalAdminRoles, asyncRoute(async (req, res) => {
  const config = await evalConfigSvc.getById(param(req.params.id));
  if (!config) { res.status(404).json({ error: "Configuração não encontrada." }); return; }
  res.json((config as Record<string, unknown>).questions ?? []);
}));

evaluationsRouter.post("/eval-configs/:id/questions", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    type:     z.enum(["SCALE", "STARS", "TEXT", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "YES_NO"]).optional(),
    label:    z.string().min(3).max(500),
    required: z.boolean().optional(),
    minLabel: z.string().max(100).optional(),
    maxLabel: z.string().max(100).optional(),
    options:  z.array(z.string().min(1)).optional(),
    position: z.coerce.number().int().min(1).optional(),
  }).parse(req.body);
  res.status(201).json(await evalConfigSvc.addQuestion(param(req.params.id), body));
}));

evaluationsRouter.put("/eval-configs/questions/:qid", evalAdminRoles, asyncRoute(async (req, res) => {
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

evaluationsRouter.delete("/eval-configs/questions/:qid", evalAdminRoles, asyncRoute(async (req, res) => {
  const ok = await evalConfigSvc.deleteQuestion(param(req.params.qid));
  if (!ok) { res.status(404).json({ error: "Pergunta não encontrada." }); return; }
  res.json({ ok: true });
}));

// ── Eval links ────────────────────────────────────────────────────────────────

evaluationsRouter.post("/eval-links", evalAdminRoles, asyncRoute(async (req, res) => {
  const body = z.object({
    phase:         z.enum(["ATENDIMENTO", "ENTREGA", "MONTAGEM"]),
    orderId:       z.string().optional(),
    assemblyJobId: z.string().optional(),
    numped:        z.string().optional(),
    codcli:        z.string().optional(),
  }).parse(req.body);
  res.status(201).json(await evalLinkSvc.generate({ ...body, userId: req.user!.sub }));
}));

// ── Eval analytics ────────────────────────────────────────────────────────────

evaluationsRouter.get("/eval-analytics", evalAdminRoles, asyncRoute(async (req, res) => {
  const { phase } = z.object({
    phase: z.enum(["ATENDIMENTO", "ENTREGA", "MONTAGEM"]),
  }).parse(req.query);

  const totalRow = await queryOne<{ total: number }>(
    "SELECT COUNT(*) AS TOTAL FROM MONT_EVAL_RESPONSES WHERE PHASE = :phase",
    { phase },
  );
  const totalResponses = Number(totalRow?.total ?? 0);
  if (totalResponses === 0) { res.json({ phase, totalResponses: 0, questions: [] }); return; }

  const [distRows, textRows] = await Promise.all([
    queryRows<{
      question_id: string; label: string; type: string; position: number;
      min_label: string | null; max_label: string | null;
      ans: string | null; cnt: number;
    }>(
      `SELECT a.QUESTION_ID,
              q.LABEL, q.TYPE, q.POSITION, q.MIN_LABEL, q.MAX_LABEL,
              NVL(a.VALUE_TEXT, TO_CHAR(a.VALUE_NUMBER)) AS ANS,
              COUNT(*) AS CNT
       FROM MONT_EVAL_ANSWERS a
       JOIN MONT_EVAL_QUESTIONS q ON q.ID = a.QUESTION_ID
       JOIN MONT_EVAL_RESPONSES r ON r.ID = a.RESPONSE_ID
       WHERE r.PHASE = :phase
         AND (a.VALUE_TEXT IS NOT NULL OR a.VALUE_NUMBER IS NOT NULL)
       GROUP BY a.QUESTION_ID, q.LABEL, q.TYPE, q.POSITION, q.MIN_LABEL, q.MAX_LABEL,
                NVL(a.VALUE_TEXT, TO_CHAR(a.VALUE_NUMBER))
       ORDER BY q.POSITION, ANS`,
      { phase },
    ),
    queryRows<{ question_id: string; value_text: string }>(
      `SELECT a.QUESTION_ID, a.VALUE_TEXT
       FROM MONT_EVAL_ANSWERS a
       JOIN MONT_EVAL_RESPONSES r ON r.ID = a.RESPONSE_ID
       JOIN MONT_EVAL_QUESTIONS q ON q.ID = a.QUESTION_ID
       WHERE r.PHASE = :phase AND q.TYPE = 'TEXT' AND a.VALUE_TEXT IS NOT NULL
       ORDER BY r.CREATED_AT DESC
       FETCH FIRST 30 ROWS ONLY`,
      { phase },
    ),
  ]);

  type QStat = {
    questionId: string; label: string; type: string; position: number;
    minLabel: string | null; maxLabel: string | null;
    totalAnswered: number;
    distribution: { value: string; count: number; pct: number }[];
    textSamples?: string[];
  };

  const map = new Map<string, QStat>();
  for (const row of distRows) {
    if (!map.has(row.question_id)) {
      map.set(row.question_id, {
        questionId: row.question_id, label: row.label, type: row.type,
        position: row.position, minLabel: row.min_label, maxLabel: row.max_label,
        totalAnswered: 0, distribution: [],
      });
    }
    const q   = map.get(row.question_id)!;
    const cnt = Number(row.cnt) || 0;
    q.totalAnswered += cnt;
    q.distribution.push({ value: row.ans ?? "", count: cnt, pct: 0 });
  }
  for (const q of map.values()) {
    for (const d of q.distribution) {
      d.pct = q.totalAnswered > 0 ? Math.round((d.count / q.totalAnswered) * 100) : 0;
    }
  }

  const textByQ = new Map<string, string[]>();
  for (const t of textRows) {
    if (!textByQ.has(t.question_id)) textByQ.set(t.question_id, []);
    textByQ.get(t.question_id)!.push(t.value_text);
  }
  for (const [qid, samples] of textByQ) {
    const q = map.get(qid);
    if (q) q.textSamples = samples;
  }

  res.json({ phase, totalResponses, questions: [...map.values()].sort((a, b) => a.position - b.position) });
}));
