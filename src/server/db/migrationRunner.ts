import { execDml, queryOne, queryRows } from "./db";
import { executeOracle, isOracleEnabled } from "./oracle";
import { logger } from "../logger";

export interface Migration {
  id: string;
  description: string;
  up(): Promise<void>;
}

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE MONT_MIGRATIONS (
  ID VARCHAR2(255) PRIMARY KEY,
  DESCRIPTION VARCHAR2(500) NOT NULL,
  APPLIED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
)`;

async function ensureMigrationsTable(): Promise<void> {
  if (!isOracleEnabled()) return;
  const exists = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = 'MONT_MIGRATIONS'",
    {},
  );
  if (!exists || Number(exists.cnt) === 0) {
    await executeOracle(CREATE_MIGRATIONS_TABLE);
    logger.info("[migrations] Tabela MONT_MIGRATIONS criada");
  }
}

async function appliedIds(): Promise<Set<string>> {
  if (!isOracleEnabled()) return new Set();
  const rows = await queryRows<{ id: string }>("SELECT ID FROM MONT_MIGRATIONS ORDER BY APPLIED_AT", {});
  return new Set(rows.map((r) => r.id));
}

export async function runMigrations(migrations: Migration[]): Promise<void> {
  if (!isOracleEnabled()) {
    logger.warn("[migrations] Oracle desabilitado — migrações ignoradas");
    return;
  }

  await ensureMigrationsTable();
  const applied = await appliedIds();
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    logger.info("[migrations] Nenhuma migração pendente");
    return;
  }

  for (const migration of pending) {
    logger.info({ id: migration.id }, `[migrations] Executando: ${migration.description}`);
    try {
      await migration.up();
      await execDml(
        "INSERT INTO MONT_MIGRATIONS (ID, DESCRIPTION) VALUES (:id, :desc)",
        { id: migration.id, desc: migration.description },
      );
      logger.info({ id: migration.id }, "[migrations] Aplicada com sucesso");
    } catch (err) {
      logger.error({ id: migration.id, err }, "[migrations] FALHA — interrompendo");
      throw err;
    }
  }

  logger.info({ count: pending.length }, "[migrations] Todas as migrações aplicadas");
}
