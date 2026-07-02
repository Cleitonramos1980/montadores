import { config } from "./config";
import { closeOraclePool, initOraclePool } from "./db/oracle";
import { ensureMontadoresTables } from "./db/initTables";
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

process.on("SIGINT", async () => {
  server.close();
  await closeOraclePool();
  process.exit(0);
});
