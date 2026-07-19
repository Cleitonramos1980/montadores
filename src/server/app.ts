import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import swaggerUi from "swagger-ui-express";
import { config } from "./config";
import { AppError } from "./errors";
import { logger } from "./logger";
import { buildOpenApiSpec } from "./openapi";
import { verifySignedFile } from "./middleware/signedFile";
import { authMiddleware } from "./middleware/auth";
import { api } from "./routes/api";
import { fluxo } from "./routes/fluxo";
import { providersRouter } from "./routes/providers";
import { evaluationsRouter } from "./routes/evaluations";
import { paymentsRouter } from "./routes/payments";
import { assemblyRouter } from "./routes/assembly";
import { usersRouter } from "./routes/users";
import { lgpdRouter } from "./routes/lgpd";

// Augment Express Request with requestId for use in handlers and error logging
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

// Mascara tokens que aparecem no path de rotas públicas, para não vazá-los nos logs.
function redactUrl(url: string): string {
  return url.replace(
    /\/(public\/(?:journey|eval|slots|schedule|sac|reviews)|orders\/[^/]+\/public-token)\/[^/?]+/g,
    (_m, prefix) => `/${prefix}/***`,
  );
}

const DEV_TUNNEL_PATTERNS = [
  /\.ngrok-free\.app$/,
  /\.ngrok-free\.dev$/,
  /\.ngrok\.io$/,
  /\.loca\.lt$/,
  /\.trycloudflare\.com$/,
  /\.workers\.dev$/,
];

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Necessário atrás do túnel/reverse-proxy para o express-rate-limit enxergar o
  // IP real do cliente (X-Forwarded-For) em vez do IP do proxy.
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) { cb(null, true); return; }
        if (!config.corsOrigins) { cb(null, true); return; }
        if (config.corsOrigins.includes(origin)) { cb(null, true); return; }
        if (!config.isProduction && DEV_TUNNEL_PATTERNS.some((p) => p.test(origin))) { cb(null, true); return; }
        cb(new Error("CORS: origem não permitida"));
      },
      credentials: true,
    }),
  );

  // ── Request correlation ID ─────────────────────────────────────────────────
  // Generates or echoes X-Request-ID; logs every request with method, url,
  // status code, and latency so log lines are traceable end-to-end.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level]({ requestId, method: req.method, url: redactUrl(req.url), status: res.statusCode, ms }, "http");
    });
    next();
  });

  // ── Security headers ───────────────────────────────────────────────────────
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  });

  // ── Rate limiting — todos os ambientes ─────────────────────────────────────
  // Aplicado sempre (não só em produção): login, recuperação de senha e rotas
  // públicas são alvo de abuso/enumeração independentemente do ambiente.
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: "Muitas tentativas. Tente novamente em 15 minutos." },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/auth/forgot-password",
    rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: "Limite de tentativas excedido." },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  // Rotas públicas (sem auth) — protege contra abuso/enumeração de token e
  // escrita anônima (cadastro de montador, respostas de avaliação, agendamento).
  app.use(
    "/api/public",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      message: { error: "Muitas requisições. Tente novamente em alguns minutos." },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ── Static uploads ─────────────────────────────────────────────────────────
  // Protegido por URL assinada (HMAC+expiração) — antes era servido publicamente
  // via túnel. Gere o link com signFilePath ao devolver a URL de um arquivo.
  const uploadsDir = join(process.cwd(), "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  app.use("/api/uploads", verifySignedFile, express.static(uploadsDir));

  // ── Body parsing — rawBody captured for HMAC webhook validation ────────────
  app.use(
    express.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }),
  );

  // ── Swagger UI — dev only (must be before /api to bypass authMiddleware) ────
  if (!config.isProduction) {
    const spec = buildOpenApiSpec(config.appBaseUrl);
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, {
      customSiteTitle: "App Montadores — API Docs",
      swaggerOptions: { persistAuthorization: true },
    }));
  }

  // ── Autenticação /api — gate único ──────────────────────────────────────────
  // O authMiddleware precisa popular req.user ANTES dos routers dedicados
  // (providers/evaluations/payments/assembly/users), pois eles NÃO aplicam o
  // middleware por conta própria — antes dependiam do router "api", montado
  // primeiro, que os sombreava. Com "api" agora no fim, este gate garante a
  // autenticação. Rotas públicas (login, health, /public/*) passam sem auth.
  const PUBLIC_API = /^\/(?:health|ready|auth\/(?:login|forgot-password)|public(?:\/|$))/;
  app.use("/api", (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method === "OPTIONS" || PUBLIC_API.test(req.path)) { next(); return; }
    authMiddleware(req, res, next);
  });

  // Routers dedicados ANTES de "api": suas guardas de RBAC/ownership passam a
  // resolver as rotas que "api" sombreava (assembly/payments/providers/etc.).
  app.use("/api", providersRouter);
  app.use("/api", evaluationsRouter);
  app.use("/api", paymentsRouter);
  app.use("/api", assemblyRouter);
  app.use("/api", usersRouter);
  // "api" no fim: serve apenas as rotas exclusivas dele (+ as rotas públicas).
  app.use("/api", api);
  // fluxo e lgpd têm authMiddleware próprio (bloqueariam rotas públicas se
  // montados antes de "api"), por isso vêm depois dele.
  app.use("/api", fluxo);
  app.use("/api", lgpdRouter);

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Zod validation errors
    if (err && typeof err === "object" && Array.isArray((err as any).issues)) {
      const issues = (err as any).issues as { path: (string | number)[]; message: string }[];
      const field = issues[0]?.path.join(".") || "campo";
      const msg = issues[0]?.message ?? "Dados inválidos";
      res.status(422).json({ error: `${field}: ${msg}` });
      return;
    }

    // Typed application errors
    if (err instanceof AppError) {
      if (err.statusCode >= 500) logger.error({ err, requestId: req.requestId }, "AppError 5xx");
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }

    // Oracle native error objects
    if (err && typeof err === "object" && typeof (err as any).errorNum === "number") {
      logger.error({ oraError: (err as any).message, errorNum: (err as any).errorNum, requestId: req.requestId }, "Oracle error");
      res.status(500).json({ error: "Erro interno do servidor." });
      return;
    }

    // Qualquer outro erro é um 5xx: loga internamente (com a mensagem original,
    // incluindo eventuais ORA-XXXXX) mas responde genérico, sem vazar detalhes
    // (Error.message cru, códigos Oracle, stacks) ao cliente.
    let logMessage = "Erro inesperado";
    if (err instanceof Error) logMessage = err.message;
    else if (typeof err === "string") logMessage = err;
    logger.error({ err, originalMessage: logMessage, requestId: req.requestId }, "unhandled error");
    res.status(500).json({ error: "Erro interno do servidor." });
  });

  return app;
}
