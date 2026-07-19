import { config } from "./config";
import { closeOraclePool, initOraclePool } from "./db/oracle";
import { ensureMontadoresTables } from "./db/initTables";
import { logger } from "./logger";
import { createApp } from "./app";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`API App Montadores em http://localhost:${config.port}`);
});

// Oracle init is non-blocking so the HTTP server responds immediately even if DB is unreachable.
// On failure (e.g. VPN down at boot) it retries with exponential backoff instead of
// requiring a manual restart — the pool comes back on its own when the network returns.
const ORACLE_RETRY_BASE_MS = 30_000;
const ORACLE_RETRY_MAX_MS  = 5 * 60_000;
let oracleBootAttempt = 0;

async function bootOracle(): Promise<void> {
  try {
    await initOraclePool();
    await ensureMontadoresTables();
    console.log("[initTables] Schema MONT_* verificado/criado.");

    // Reconcilia sync runs presas em RUNNING (processo caiu no meio de um sync manual)
    // no boot — independente do scheduler, que pode estar desativado.
    const { execDml } = await import("./db/db");
    await execDml(
      "UPDATE MONT_SYNC_RUNS SET RUN_STATUS = 'ERRO', FINALIZADO_EM = SYSTIMESTAMP WHERE RUN_STATUS = 'RUNNING'",
    ).catch((e) => logger.warn({ err: (e as Error).message }, "[boot] não foi possível reconciliar runs presas"));

    // Automatic scheduler — starts only when SCHEDULER_ENABLED=true AND Oracle is up.
    // Honours the global MESSAGE_TRIGGER_MODE (DRY_RUN / HOMOLOGACAO / PRODUCAO).
    if (config.scheduler.enabled) {
      const { scheduler } = await import("./services/MessageSchedulerService");
      scheduler.start(config.scheduler.intervalMinutes * 60_000);
    } else {
      console.log("[Scheduler] Desativado (SCHEDULER_ENABLED != true). Sync e mensagens apenas manuais.");
    }
  } catch (err) {
    oracleBootAttempt++;
    const delay = Math.min(ORACLE_RETRY_BASE_MS * 2 ** (oracleBootAttempt - 1), ORACLE_RETRY_MAX_MS);
    console.error(
      `[Oracle] Falha ao inicializar pool (tentativa ${oracleBootAttempt}): ${(err as Error).message}` +
      ` — nova tentativa em ${Math.round(delay / 1000)}s. API segue no ar sem banco.`,
    );
    setTimeout(() => { void bootOracle(); }, delay).unref();
  }
}

void bootOracle();

// ── Shutdown gracioso ────────────────────────────────────────────────────────
// Cobre SIGINT (PM2/Windows/Ctrl-C) E SIGTERM (Docker/systemd): para o scheduler,
// deixa as requisições em voo terminarem (server.close) e drena o pool Oracle.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "[shutdown] encerrando graciosamente");
  try {
    const { scheduler } = await import("./services/MessageSchedulerService");
    scheduler.stop();
    // Drena o ciclo em andamento antes de fechar o pool: um ciclo pode estar no meio
    // de um sync/envio usando conexões Oracle. Espera 'running' zerar, com teto de
    // tempo para não travar o shutdown indefinidamente.
    const DRAIN_TIMEOUT_MS = 10_000;
    const DRAIN_POLL_MS = 200;
    const drainDeadline = Date.now() + DRAIN_TIMEOUT_MS;
    const isCycleRunning = () => (scheduler as unknown as { running?: boolean }).running === true;
    while (isCycleRunning() && Date.now() < drainDeadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (isCycleRunning()) {
      logger.warn("[shutdown] ciclo do scheduler não drenou dentro do timeout — prosseguindo");
    }
  } catch { /* scheduler pode nem ter iniciado */ }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeOraclePool().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Não deixar o processo morrer silenciosamente por erro não tratado — loga a causa
// no logger estruturado. unhandledRejection: apenas registra (não derruba).
// uncaughtException: registra e encerra controladamente (estado possivelmente corrompido).
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "[process] unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "[process] uncaughtException — encerrando");
  void shutdown("uncaughtException").finally(() => process.exit(1));
});
