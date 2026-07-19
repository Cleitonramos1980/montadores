/**
 * Monitor de saúde auto-hospedado (sem depender de Sentry/serviço externo).
 * Faz polling de /api/ready e /api/system/health e ALERTA em degradação:
 *   - responde 503 em /ready (banco indisponível)
 *   - db != "ok" ou falha na consulta de integrações
 *   - openFailures > 0 (falhas de integração acumuladas)
 *   - servidor inalcançável
 *
 * Alerta = log estruturado no stdout (capturado pelo PM2) + POST opcional para
 * ALERT_WEBHOOK_URL (Slack/Discord/Teams/webhook próprio), se definido no ambiente.
 * Só notifica na TRANSIÇÃO (ok->degradado e degradado->ok), evitando spam.
 *
 * Config via env:
 *   MONITOR_BASE_URL      (default http://localhost:3333)
 *   MONITOR_INTERVAL_MS   (default 60000)
 *   ALERT_WEBHOOK_URL     (opcional — canal de alerta; alias: HEALTH_ALERT_WEBHOOK)
 *   HEALTH_ALERT_WEBHOOK  (opcional — mesmo efeito; se ambos definidos, ALERT_WEBHOOK_URL vence)
 */
const BASE = process.env.MONITOR_BASE_URL || "http://localhost:3333";
const INTERVAL = Number(process.env.MONITOR_INTERVAL_MS || 60_000);
// Aceita ambos os nomes; se nenhum definido, o monitor mantém só o log estruturado no stdout.
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || process.env.HEALTH_ALERT_WEBHOOK || "";

let lastHealthy = null; // null = ainda não avaliado

function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, monitor: true, msg, ...extra };
  console.log(JSON.stringify(line));
}

async function fetchJson(path, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function sendWebhook(text) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    log("warn", "falha ao enviar webhook de alerta", { err: e.message });
  }
}

async function tick() {
  const problems = [];
  try {
    const ready = await fetchJson("/api/ready");
    if (ready.status !== 200 || ready.body.ready !== true) {
      problems.push(`readiness ${ready.status} (db=${ready.body.db})`);
    }
    const sys = await fetchJson("/api/system/health").catch(() => null);
    if (sys && sys.status === 200) {
      if (sys.body.db && sys.body.db.status && sys.body.db.status !== "ok") problems.push(`db=${sys.body.db.status}`);
      if (sys.body.failuresQueryError) problems.push("consulta de falhas indisponível");
      if (typeof sys.body.openFailures === "number" && sys.body.openFailures > 0) problems.push(`${sys.body.openFailures} falhas de integração abertas`);
    }
  } catch (e) {
    problems.push(`servidor inalcançável: ${e.message}`);
  }

  const healthy = problems.length === 0;
  if (healthy !== lastHealthy) {
    if (healthy) {
      log("info", "sistema RECUPERADO — saudável");
      await sendWebhook("✅ App Montadores RECUPERADO — saudável.");
    } else {
      log("error", "sistema DEGRADADO", { problems });
      await sendWebhook(`🔴 App Montadores DEGRADADO: ${problems.join("; ")}`);
    }
    lastHealthy = healthy;
  } else if (!healthy) {
    log("warn", "ainda degradado", { problems });
  }
}

log("info", `monitor iniciado — ${BASE} a cada ${INTERVAL / 1000}s${WEBHOOK ? " (webhook ativo)" : " (sem webhook)"}`);
tick();
setInterval(tick, INTERVAL);
