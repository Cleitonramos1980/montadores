// Fonte ÚNICA de configuração de runtime do servidor. (O antigo env.ts, um segundo
// parser Zod não utilizado e com defaults divergentes, foi removido.) Migrações de
// schema são responsabilidade exclusiva de db/initTables.ts (idempotente no boot);
// db/migrate.ts permanece apenas como utilitário manual (npm run migrate).
import dotenv from "dotenv";

dotenv.config();

const DEV_JWT_SECRET = "montadores_jwt_secret_mude_em_producao_2026";

export const config = {
  port: Number(process.env.PORT ?? 3333),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
  publicTokenTtlHours: Number(process.env.PUBLIC_TOKEN_TTL_HOURS ?? 168),
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  jwtExpiresHours: Number(process.env.JWT_EXPIRES_HOURS ?? 8),
  isProduction: process.env.NODE_ENV === "production",
  scheduler: {
    // OFF by default — nothing is dispatched automatically until explicitly enabled.
    enabled: process.env.SCHEDULER_ENABLED === "true",
    intervalMinutes: Number(process.env.SCHEDULER_INTERVAL_MINUTES ?? 15),
  },
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : null, // null = allow all (dev only)
  features: {
    deptCommissionRules:          process.env.FEAT_DEPT_COMMISSION_RULES          === "true",
    providerWhatsAppNotifications: process.env.FEAT_PROVIDER_WHATSAPP             === "true",
    providerPushNotifications:    process.env.FEAT_PROVIDER_PUSH                  === "true",
    pixPayments:                  process.env.FEAT_PIX_PAYMENTS                   === "true",
    geoMatching:                  process.env.FEAT_GEO_MATCHING                   === "true",
    reworkScoreImpact:            process.env.FEAT_REWORK_SCORE_IMPACT             === "true",
  },
  oracle: {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    schema: process.env.ORACLE_SCHEMA ?? process.env.ORACLE_USER,
    poolMin: Number(process.env.ORACLE_POOL_MIN ?? 1),
    poolMax: Number(process.env.ORACLE_POOL_MAX ?? 5),
    poolIncrement: Number(process.env.ORACLE_POOL_INCREMENT ?? 1),
    poolAlias: process.env.ORACLE_POOL_ALIAS ?? "montadoresPool",
    stmtCacheSize: Number(process.env.ORACLE_STMT_CACHE_SIZE ?? 30),
  },
};

export const features = config.features;

// Security checks at startup — fatal in production
const { isProduction } = config;

// Considera fraco: valores-padrão conhecidos OU segredo curto demais para HMAC-SHA256.
// (Antes só comparava 2 strings exatas — um segredo de 9 chars como "change-me" passava.)
const weakJwt =
  config.jwtSecret === DEV_JWT_SECRET ||
  config.jwtSecret === "change-me-in-production-use-at-least-32-chars" ||
  config.jwtSecret.length < 32;

if (weakJwt) {
  if (isProduction) {
    console.error("[SEGURANÇA FATAL] JWT_SECRET ausente, padrão ou com menos de 32 caracteres em produção. Servidor abortado.");
    process.exit(1);
  }
  console.warn("[SEGURANÇA] JWT_SECRET fraco (padrão ou < 32 caracteres). Gere um segredo forte antes de produção!");
}
if (!config.corsOrigins) {
  if (isProduction) {
    console.error("[SEGURANÇA FATAL] CORS_ORIGINS não configurado em produção. Servidor abortado.");
    process.exit(1);
  }
  console.warn("[SEGURANÇA] CORS_ORIGINS não configurado. Todas as origens são permitidas (apenas para dev).");
}
