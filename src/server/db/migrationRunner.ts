// =============================================================================
// AVISO: NÃO utilizado no boot atual.
// -----------------------------------------------------------------------------
// O schema real vive em src/server/db/initTables.ts (ensureMontadoresTables),
// que é idempotente e é o ÚNICO caminho executado na inicialização do servidor.
// Este runner de migrações versionadas NÃO é chamado no boot — permanece apenas
// como infraestrutura de referência e é exercitado por tests/unit/migrationRunner.test.ts.
// Não presuma que estas migrações rodam automaticamente. Se um dia forem plugadas
// no boot, coordene com o dono do initTables para evitar dupla criação de schema.
// =============================================================================
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
      // Atomicidade: cada migração é aplicada e registrada de forma independente.
      // Observação importante do Oracle: DDL (CREATE TABLE/INDEX) faz COMMIT implícito
      // e NÃO pode ser revertido por rollback, portanto envolver `up()` em withTransaction
      // não daria atomicidade real para migrações de schema. A garantia contra estado
      // parcial vem de cada migração ser IDEMPOTENTE (checagem de existência antes de
      // criar — ver migrations/002_job_queue e initTables): reexecutar após falha é seguro.
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
