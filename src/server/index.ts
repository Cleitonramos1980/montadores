import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { initOraclePool, closeOraclePool } from "./db/oracle";
import { ensureMontadoresTables } from "./db/initTables";
import { api } from "./routes/api";
import { fluxo } from "./routes/fluxo";

try {
  await initOraclePool();
  await ensureMontadoresTables();
} catch (err) {
  console.error(`[startup] Oracle indisponível — servidor iniciando sem Oracle: ${(err as Error).message}`);
}

const app = express();

app.use(cors(
  config.corsOrigins
    ? { origin: config.corsOrigins, credentials: true }
    : undefined, // allow all in dev
));

// Rate limiting on auth and public endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/forgot-password", rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: "Limite de tentativas excedido." }, standardHeaders: true, legacyHeaders: false }));

// Serve uploaded files
const uploadsDir = join(process.cwd(), "uploads");
mkdirSync(uploadsDir, { recursive: true });
app.use("/api/uploads", express.static(uploadsDir));

app.use(express.json({ limit: "2mb" }));
app.use("/api", api);
app.use("/api", fluxo);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Zod validation errors — have .issues array
  if (err && typeof err === "object" && Array.isArray((err as any).issues)) {
    const issues = (err as any).issues as { path: (string | number)[]; message: string }[];
    const field = issues[0]?.path.join(".") || "campo";
    const msg = issues[0]?.message ?? "Dados inválidos";
    res.status(422).json({ error: `${field}: ${msg}` });
    return;
  }

  // Extract a guaranteed string message from any error shape
  let message = "Erro inesperado";
  if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === "object") {
    const e = err as any;
    // oracledb can throw plain objects with .message or .errorNum — never expose ORA codes to clients
    if (typeof e.errorNum === "number") message = "Erro interno do servidor.";
    else if (typeof e.message === "string") message = e.message;
    else message = JSON.stringify(e).slice(0, 200);
  } else if (typeof err === "string") {
    message = err;
  }

  const lower = message.toLowerCase();
  const isNotFound = lower.includes("não encontrado") || lower.includes("not found");
  const isUnauthorized = lower.includes("autenticação") || lower.includes("token") || lower.includes("credenciais") || lower.includes("inativo") || lower.includes("bloqueado");
  const status = isUnauthorized ? 401 : isNotFound ? 404 : 400;

  if (!(err instanceof Error)) {
    console.error("[server] non-Error thrown:", err);
  }

  res.status(status).json({ error: message });
});

const server = app.listen(config.port, () => {
  console.log(`API App Montadores em http://localhost:${config.port}`);
});

// Oracle health monitor — logs when Oracle goes down or comes back up
let oracleWasDown = false;
setInterval(async () => {
  const { isOracleEnabled } = await import("./db/oracle");
  if (!isOracleEnabled()) return;
  try {
    const { queryOne: qo } = await import("./db/db");
    await qo("SELECT 1 AS X FROM DUAL", {});
    if (oracleWasDown) {
      console.log(`[monitor] Oracle restaurado — ${new Date().toISOString()}`);
      oracleWasDown = false;
    }
  } catch (err) {
    if (!oracleWasDown) {
      console.error(`[monitor] Oracle INDISPONÍVEL — ${new Date().toISOString()} — ${(err as Error).message}`);
      oracleWasDown = true;
    }
  }
}, 5 * 60 * 1000);

process.on("SIGINT", async () => {
  server.close();
  await closeOraclePool();
  process.exit(0);
});
