import dotenv from "dotenv";

dotenv.config();

const DEV_JWT_SECRET = "montadores_jwt_secret_mude_em_producao_2026";
const isProduction = process.env.NODE_ENV === "production";

const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT_SECRET;

if (isProduction && jwtSecret === DEV_JWT_SECRET) {
  throw new Error("[FATAL] JWT_SECRET está com o valor padrão de desenvolvimento. Defina JWT_SECRET antes de iniciar em produção.");
}

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : null; // null = allow all (dev only)

if (isProduction && !corsOrigins) {
  throw new Error("[FATAL] CORS_ORIGINS não configurado em produção. Defina CORS_ORIGINS para restringir as origens permitidas.");
}

// ── Feature flags ────────────────────────────────────────────────────────────
// Permitem ativar/desativar funcionalidades novas sem impactar produção.
// Em dúvida, deixe false e ative apenas em homologação primeiro.
const flag = (key: string, defaultVal = false): boolean => {
  const v = process.env[key];
  if (v === undefined) return defaultVal;
  return v === "1" || v.toLowerCase() === "true";
};

export const features = {
  deptCommissionRules:           flag("ENABLE_DEPARTMENT_COMMISSION_RULES", false),
  geoMatching:                   flag("ENABLE_GEO_MATCHING", false),
  pixPayments:                   flag("ENABLE_PIX_PAYMENTS", false),
  pwaOffline:                    flag("ENABLE_PWA_OFFLINE", true),
  reworkScoreImpact:             flag("ENABLE_REWORK_SCORE_IMPACT", false),
  strictRbac:                    flag("ENABLE_STRICT_RBAC", true),
  providerWhatsAppNotifications: flag("ENABLE_PROVIDER_WHATSAPP_NOTIFICATIONS", false),
  providerPushNotifications:     flag("ENABLE_PROVIDER_PUSH_NOTIFICATIONS", false),
};

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3333),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
  publicTokenTtlHours: Number(process.env.PUBLIC_TOKEN_TTL_HOURS ?? 168),
  jwtSecret,
  jwtExpiresHours: Number(process.env.JWT_EXPIRES_HOURS ?? 8),
  corsOrigins,
  branding: {
    companyName:  process.env.COMPANY_NAME  ?? "Rodrigues Colchões",
    logoUrl:      process.env.LOGO_URL      ?? "/logo-rodrigues.svg",
    primaryColor: process.env.PRIMARY_COLOR ?? "#1F2855",
    supportPhone: process.env.SUPPORT_PHONE ?? "",
  },
  oracle: {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    schema: process.env.ORACLE_SCHEMA ?? process.env.ORACLE_USER,
    poolMin: Number(process.env.ORACLE_POOL_MIN ?? 1),
    poolMax: Number(process.env.ORACLE_POOL_MAX ?? 10),
    poolIncrement: Number(process.env.ORACLE_POOL_INCREMENT ?? 1),
    poolAlias: process.env.ORACLE_POOL_ALIAS ?? "montadoresPool",
    stmtCacheSize: Number(process.env.ORACLE_STMT_CACHE_SIZE ?? 30),
  },
};

if (!isProduction) {
  if (jwtSecret === DEV_JWT_SECRET) {
    console.warn("[SEGURANÇA] JWT_SECRET com valor padrão de dev. Altere antes de produção.");
  }
  if (!corsOrigins) {
    console.warn("[SEGURANÇA] CORS_ORIGINS não configurado — todas as origens permitidas (dev only).");
  }
}
