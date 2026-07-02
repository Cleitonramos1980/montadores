import type { Migration } from "../migrationRunner";
import { execDml } from "../db";
import { logger } from "../../logger";

async function createTable() {
  await execDml(`
    CREATE TABLE MONT_JOB_QUEUE (
      ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      JOB_TYPE      VARCHAR2(80)  NOT NULL,
      PAYLOAD       CLOB          NOT NULL,
      STATUS        VARCHAR2(20)  DEFAULT 'PENDING'  NOT NULL,
      ATTEMPTS      NUMBER        DEFAULT 0          NOT NULL,
      MAX_ATTEMPTS  NUMBER        DEFAULT 3          NOT NULL,
      NEXT_RUN_AT   TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      LAST_ERROR    CLOB,
      CREATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT CHK_JOB_STATUS CHECK (STATUS IN ('PENDING','RUNNING','DONE','FAILED'))
    )
  `, {});
  logger.info("[migration 002] MONT_JOB_QUEUE criada");
}

async function createIndex() {
  await execDml(
    `CREATE INDEX IDX_JOB_STATUS_NEXT ON MONT_JOB_QUEUE (STATUS, NEXT_RUN_AT)`,
    {},
  );
}

async function tableExists(): Promise<boolean> {
  const { queryOne } = await import("../db");
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = 'MONT_JOB_QUEUE'`,
    {},
  );
  return Number(row?.cnt ?? 0) > 0;
}

export const migration: Migration = {
  id:          "002_job_queue",
  description: "Cria tabela MONT_JOB_QUEUE para fila de jobs com retry automático",
  async up() {
    if (await tableExists()) {
      logger.info("[migration 002] MONT_JOB_QUEUE já existe — skip");
      return;
    }
    await createTable();
    await createIndex().catch(() => { /* index can fail if already exists */ });
  },
};
