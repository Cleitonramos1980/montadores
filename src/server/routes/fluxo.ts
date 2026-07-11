import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth";
import { PedidoFluxoSyncService } from "../services/PedidoFluxoSyncService";
import { DashboardPedidoFluxoService } from "../services/DashboardPedidoFluxoService";
import { MessageLogService } from "../services/MessageLogService";
import { queryOne, queryRows } from "../db/db";

export const fluxo = Router();

fluxo.use(authMiddleware);

// Operações que disparam sync, alteram modo de envio de mensagens ou reenviam
// são administrativas — restritas a ADMIN/GESTOR.
const fluxoAdmin = requireRole("ADMIN", "GESTOR");

function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
}

const sync  = new PedidoFluxoSyncService();
const dash  = new DashboardPedidoFluxoService();
const msgLogs = new MessageLogService();

// ── Sync config ───────────────────────────────────────────────────────────────

fluxo.get("/fluxo/sync/config", asyncRoute(async (_req, res) => {
  res.json(await sync.getConfig());
}));

fluxo.put("/fluxo/sync/config", fluxoAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    key:   z.string().min(1).max(100),
    value: z.string().max(500),
  }).parse(req.body);
  await sync.setConfig(body.key, body.value);
  res.json({ ok: true });
}));

// ── Sync run ──────────────────────────────────────────────────────────────────

const syncRunSchema = z.object({
  modo:            z.enum(["DRY_RUN", "HOMOLOGACAO", "PRODUCAO"]).default("DRY_RUN"),
  condvenda:       z.coerce.number().int().optional(),
  dataInicioPedido: z.string().optional(),
  dataFimPedido:   z.string().optional(),
  numped:          z.string().optional(),
  codfilial:       z.string().optional(),
});

fluxo.post("/fluxo/sync/run", fluxoAdmin, asyncRoute(async (req, res) => {
  const body = syncRunSchema.parse(req.body);
  const result = await sync.run({
    modo:            body.modo,
    condvenda:       body.condvenda,
    dataInicioPedido: body.dataInicioPedido ? new Date(body.dataInicioPedido) : undefined,
    dataFimPedido:   body.dataFimPedido   ? new Date(body.dataFimPedido)   : undefined,
    numped:          body.numped,
    codfilial:       body.codfilial,
  });
  res.status(201).json(result);
}));

fluxo.get("/fluxo/sync/runs", asyncRoute(async (req, res) => {
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }).parse(req.query);
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = await Promise.all([
    queryRows(
      `SELECT ID, MODO, PEDIDOS_ENCONTRADOS, EVENTOS_GERADOS,
              MSGS_SIMULADAS, MSGS_ENVIADAS, MSGS_IGNORADAS, MSGS_ERRO,
              RUN_STATUS, INICIADO_EM, FINALIZADO_EM
       FROM MONT_SYNC_RUNS
       ORDER BY INICIADO_EM DESC
       OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
      { offset, pageSize },
    ),
    queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_SYNC_RUNS"),
  ]);
  res.json({ rows, total: Number(countRow?.total ?? 0) });
}));

fluxo.get("/fluxo/sync/runs/:id", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const row = await queryOne(
    "SELECT * FROM MONT_SYNC_RUNS WHERE ID = :id",
    { id },
  );
  if (!row) { res.status(404).json({ error: "Run não encontrado" }); return; }
  res.json(row);
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────

fluxo.get("/fluxo/dashboard/summary", asyncRoute(async (_req, res) => {
  res.json(await dash.getSummary());
}));

fluxo.get("/fluxo/dashboard/phase/:key", asyncRoute(async (req, res) => {
  const { key } = req.params;
  const { page, pageSize } = z.object({
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);
  res.json(await dash.getByPhase(String(key), page, pageSize));
}));

fluxo.get("/fluxo/dashboard/order/:numped", asyncRoute(async (req, res) => {
  const numped = String(req.params.numped);
  res.json(await dash.getByNumped(numped));
}));

// ── Event config ──────────────────────────────────────────────────────────────

fluxo.get("/fluxo/events", asyncRoute(async (_req, res) => {
  res.json(await dash.getEventConfigs());
}));

fluxo.put("/fluxo/events/:key/config", fluxoAdmin, asyncRoute(async (req, res) => {
  const { key } = req.params;
  const body = z.object({
    ativo_dashboard: z.number().int().min(0).max(1).optional(),
    ativo_mensagem:  z.number().int().min(0).max(1).optional(),
    modo_envio:      z.enum(["DRY_RUN", "HOMOLOGACAO", "PRODUCAO"]).optional(),
    telefones_teste: z.string().max(1000).optional(),
    observacao:      z.string().max(1000).optional(),
  }).parse(req.body);
  await dash.updateEventConfig(String(key), body);
  res.json({ ok: true });
}));

// ── Message logs ──────────────────────────────────────────────────────────────

fluxo.get("/fluxo/message-logs", asyncRoute(async (req, res) => {
  const filters = z.object({
    numped:   z.string().optional(),
    eventKey: z.string().optional(),
    status:   z.string().optional(),
    page:     z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);
  res.json(await msgLogs.list(filters));
}));

fluxo.post("/fluxo/message-logs/:id/reenviar", fluxoAdmin, asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const existing = await msgLogs.getById(id);
  if (!existing) { res.status(404).json({ error: "Log não encontrado" }); return; }
  const entry = existing as any;

  const result = await msgLogs.log({
    numped:   entry.numped,
    codcli:   entry.codcli,
    eventKey: entry.event_key,
    status:   "ENVIADO",
    modoEnvio: entry.modo_envio,
    destino:  entry.destino,
    payload:  { reenvio: true, originalId: id },
  });

  res.status(201).json(result);
}));

// ── Diagnóstico WinThor ───────────────────────────────────────────────────────

fluxo.get("/fluxo/diagnostico", asyncRoute(async (_req, res) => {
  const results: Record<string, unknown> = {};

  // 1. Contagem por CONDVENDA (últimos 60 dias)
  try {
    results.condvendas = await queryRows(
      `SELECT P.CONDVENDA, COUNT(*) AS TOTAL
       FROM PCPEDC P
       WHERE P.DATA >= TRUNC(SYSDATE) - 60
       GROUP BY P.CONDVENDA
       ORDER BY TOTAL DESC
       FETCH FIRST 20 ROWS ONLY`,
    );
  } catch (e) { results.condvendas_erro = (e as Error).message; }

  // 2. Verifica existência das colunas de fase
  const cols = ["DTEMISSAOMAPA", "DTINICIALCHECKOUT", "DTFINALCHECKOUT", "CODFUNCEMISSAOMAPA", "CODFUNCSEP", "CODFUNCCONF"];
  const colStatus: Record<string, boolean | string> = {};
  for (const col of cols) {
    try {
      await queryOne(`SELECT ${col} FROM PCPEDC WHERE ROWNUM = 1`);
      colStatus[col] = true;
    } catch (e) {
      colStatus[col] = (e as Error).message.includes("ORA-00904") ? "NÃO EXISTE" : (e as Error).message;
    }
  }
  results.colunas_pcpedc = colStatus;

  // 3. Amostra de pedidos com CONDVENDA=8 nos últimos 7 dias
  try {
    results.amostra_condvenda_8 = await queryRows(
      `SELECT P.NUMPED, P.DATA, P.CONDVENDA, P.POSICAO, P.CODFILIAL
       FROM PCPEDC P
       WHERE P.DATA >= TRUNC(SYSDATE) - 7
         AND P.CONDVENDA = 8
       ORDER BY P.DATA DESC
       FETCH FIRST 5 ROWS ONLY`,
    );
  } catch (e) { results.amostra_condvenda_8_erro = (e as Error).message; }

  // 4. Pedidos mais recentes (qualquer CONDVENDA)
  try {
    results.pedidos_recentes = await queryRows(
      `SELECT P.NUMPED, P.DATA, P.CONDVENDA, P.POSICAO
       FROM PCPEDC P
       ORDER BY P.DATA DESC
       FETCH FIRST 5 ROWS ONLY`,
    );
  } catch (e) { results.pedidos_recentes_erro = (e as Error).message; }

  res.json(results);
}));
