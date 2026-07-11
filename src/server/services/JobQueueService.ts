import oracledb from "oracledb";
import { execDml, queryRows } from "../db/db";
import { isOracleEnabled, withOracleConnection } from "../db/oracle";
import { logger } from "../logger";

// Janela para considerar um job RUNNING como órfão (worker morto / travado).
const STALE_RUNNING_SECS = Number(process.env.JOB_STALE_RUNNING_SECS ?? 300);

export type JobType = "WHATSAPP_MESSAGE";

export interface WhatsAppMessagePayload {
  numped: string;
  codcli: string;
  eventKey: string;
  phone: string;
  renderedBody: string;
  idempotencyKey: string;
  effectiveMode: string;
}

export type JobPayload = WhatsAppMessagePayload;

interface JobRow {
  id: number;
  job_type: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

type JobHandler = (payload: JobPayload) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();

export const JobQueueService = {
  /** Register a handler that processes a specific job type. */
  register(type: JobType, handler: JobHandler): void {
    handlers.set(type, handler);
  },

  /** Enqueue a new job. Returns the new job ID, or null if Oracle is disabled. */
  async enqueue(
    type: JobType,
    payload: JobPayload,
    options: { maxAttempts?: number; delayMs?: number } = {},
  ): Promise<number | null> {
    if (!isOracleEnabled()) return null;
    const { maxAttempts = 3, delayMs = 0 } = options;
    const delaySecs = delayMs > 0 ? Math.ceil(delayMs / 1000) : 0;
    // RETURNING ID INTO — execDml não devolve o ID da coluna IDENTITY; NUMTODSINTERVAL
    // evita ORA-01873 do literal INTERVAL para delays >= 100s.
    const id = await withOracleConnection<number | null>(async (conn) => {
      const res = await conn.execute(
        `INSERT INTO MONT_JOB_QUEUE (JOB_TYPE, PAYLOAD, MAX_ATTEMPTS, NEXT_RUN_AT)
         VALUES (:type, :payload, :max, SYSTIMESTAMP + NUMTODSINTERVAL(:delay, 'SECOND'))
         RETURNING ID INTO :out_id`,
        {
          type, payload: JSON.stringify(payload), max: maxAttempts, delay: delaySecs,
          out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
        { autoCommit: true },
      );
      return (((res.outBinds as any)?.out_id ?? [])[0] ?? null) as number | null;
    });
    logger.info({ type, id }, "[jobs] job enqueued");
    return id;
  },

  /** Pick up to `limit` PENDING jobs due for processing, run them, update status. */
  async processPending(limit = 10): Promise<void> {
    if (!isOracleEnabled()) return;
    // Recupera jobs RUNNING órfãos (worker morto) antes de reivindicar novos.
    await JobQueueService._recoverStaleJobs().catch((e) =>
      logger.error({ err: (e as Error).message }, "[jobs] stale recovery failed"),
    );
    const jobs = await JobQueueService._claimJobs(limit).catch((e) => {
      logger.error({ err: (e as Error).message }, "[jobs] claim failed");
      return [] as JobRow[];
    });
    for (const job of jobs) {
      await JobQueueService._runJob(job);
    }
  },

  /** Reivindica atomicamente até `limit` jobs vencidos (PENDING → RUNNING, ATTEMPTS+1). */
  async _claimJobs(limit: number): Promise<JobRow[]> {
    const claimedIds = await withOracleConnection<number[]>(async (conn) => {
      const res = await conn.execute(
        `UPDATE MONT_JOB_QUEUE
            SET STATUS = 'RUNNING', ATTEMPTS = ATTEMPTS + 1, UPDATED_AT = SYSTIMESTAMP
          WHERE ID IN (
            SELECT ID FROM (
              SELECT ID FROM MONT_JOB_QUEUE
               WHERE STATUS = 'PENDING' AND NEXT_RUN_AT <= SYSTIMESTAMP
               ORDER BY NEXT_RUN_AT, ID
            ) WHERE ROWNUM <= :lim
          )
          RETURNING ID INTO :ids`,
        { lim: limit, ids: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } },
        { autoCommit: true },
      );
      return (((res.outBinds as any)?.ids) ?? []) as number[];
    });
    if (claimedIds.length === 0) return [];

    const binds: Record<string, number> = {};
    claimedIds.forEach((id, i) => { binds[`id${i}`] = id; });
    const inList = claimedIds.map((_, i) => `:id${i}`).join(", ");
    return queryRows<JobRow>(
      `SELECT ID, JOB_TYPE, PAYLOAD, ATTEMPTS, MAX_ATTEMPTS
         FROM MONT_JOB_QUEUE WHERE ID IN (${inList})`,
      binds,
    );
  },

  /** Devolve à fila jobs presos em RUNNING além da janela (worker morto). */
  async _recoverStaleJobs(): Promise<void> {
    await execDml(
      `UPDATE MONT_JOB_QUEUE
          SET STATUS = 'PENDING', UPDATED_AT = SYSTIMESTAMP
        WHERE STATUS = 'RUNNING'
          AND UPDATED_AT < SYSTIMESTAMP - NUMTODSINTERVAL(:secs, 'SECOND')`,
      { secs: STALE_RUNNING_SECS },
    );
  },

  async _runJob(job: JobRow): Promise<void> {
    // Job já vem RUNNING e com ATTEMPTS incrementado pelo claim atômico.
    const handler = handlers.get(job.job_type as JobType);
    if (!handler) {
      logger.warn({ id: job.id, type: job.job_type }, "[jobs] no handler — marking FAILED");
      await execDml(
        `UPDATE MONT_JOB_QUEUE SET STATUS = 'FAILED', LAST_ERROR = :err, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`,
        { err: "No handler registered for this job type", id: job.id },
      ).catch(() => null);
      return;
    }

    try {
      const payload = JSON.parse(job.payload) as JobPayload;
      await handler(payload);
      await execDml(
        `UPDATE MONT_JOB_QUEUE SET STATUS = 'DONE', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id`,
        { id: job.id },
      );
      logger.info({ id: job.id, type: job.job_type }, "[jobs] job completed");
    } catch (err) {
      // job.attempts já reflete a tentativa atual (incrementada no claim).
      const exhausted   = job.attempts >= job.max_attempts;
      // Back-off exponencial: 1min, 5min, 15min. NUMTODSINTERVAL evita ORA-01873.
      const backoffSecs = [60, 300, 900][Math.min(job.attempts - 1, 2)];

      await execDml(
        `UPDATE MONT_JOB_QUEUE
         SET STATUS     = :status,
             LAST_ERROR = :err,
             NEXT_RUN_AT = SYSTIMESTAMP + NUMTODSINTERVAL(:backoff, 'SECOND'),
             UPDATED_AT  = SYSTIMESTAMP
         WHERE ID = :id`,
        {
          status:  exhausted ? "FAILED" : "PENDING",
          err:     err instanceof Error ? err.message : String(err),
          backoff: backoffSecs,
          id:      job.id,
        },
      );
      logger.warn({ id: job.id, attempt: job.attempts, exhausted }, "[jobs] job failed");
    }
  },
};
