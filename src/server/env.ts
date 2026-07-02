import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  JWT_SECRET: z.string().min(1, "JWT_SECRET é obrigatório"),
  JWT_EXPIRES_HOURS: z.coerce.number().int().positive().default(8),
  APP_BASE_URL: z.string().url("deve ser uma URL válida (ex: https://app.empresa.com)").default("http://localhost:5173"),
  PUBLIC_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(168),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGINS: z.string().optional(),
  ORACLE_USER: z.string().optional(),
  ORACLE_PASSWORD: z.string().optional(),
  ORACLE_CONNECT_STRING: z.string().optional(),
  ORACLE_SCHEMA: z.string().optional(),
  ORACLE_POOL_MIN: z.coerce.number().int().min(0).default(1),
  ORACLE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  ORACLE_POOL_INCREMENT: z.coerce.number().int().min(0).default(1),
  ORACLE_POOL_ALIAS: z.string().default("montadoresPool"),
  ORACLE_STMT_CACHE_SIZE: z.coerce.number().int().positive().default(30),
  COMPANY_NAME: z.string().default("Rodrigues Colchões"),
  LOGO_URL: z.string().default("/logo-rodrigues.svg"),
  PRIMARY_COLOR: z.string().default("#1F2855"),
  SUPPORT_PHONE: z.string().default(""),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  // Automatic message scheduler (periodic WinThor sync → phase transitions → dispatch).
  // Default OFF: nothing is sent automatically until explicitly enabled. When enabled it
  // honours the global MESSAGE_TRIGGER_MODE (DRY_RUN / HOMOLOGACAO / PRODUCAO) config.
  SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false"),
});

export type ValidatedEnv = z.infer<typeof schema>;

const result = schema.safeParse(process.env);

if (!result.success) {
  const errors = result.error.issues
    .map((i) => `  ${i.path.join(".") || "?"}: ${i.message}`)
    .join("\n");
  throw new Error(`[FATAL] Variáveis de ambiente inválidas:\n${errors}`);
}

// Cross-field: Oracle credentials must be all-or-nothing
const { ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING } = result.data;
const defined = [ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING].filter(Boolean).length;
if (defined > 0 && defined < 3) {
  const missing = Object.entries({ ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING })
    .filter(([, v]) => !v)
    .map(([k]) => k)
    .join(", ");
  throw new Error(`[FATAL] Configuração Oracle incompleta. Faltam: ${missing}`);
}

export const env = result.data;
