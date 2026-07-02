import { execDml, queryRows } from "../db/db";
import { isOracleEnabled } from "../db/oracle";
import { logger } from "../logger";

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
    const nextRunAt = delayMs > 0
      ? `SYSTIMESTAMP + INTERVAL '${Math.ceil(delayMs / 1000)}' SECOND`
      : "SYSTIMESTAMP";
    const result = await execDml(
      `INSERT INTO MONT_JOB_QUEUE (JOB_TYPE, PAYLOAD, MAX_ATTEMPTS, NEXT_RUN_AT)
       VALUES (:type, :payload, :max, ${nextRunAt})`,
      { type, payload: JSON.stringify(payload), max: maxAttempts },
    );
    const id = (result as any).lastRowid ?? null;
    logger.info({ type, id }, "[jobs] job enqueued");
    return id;
  },

  /** Pick up to `limit` PENDING jobs due for processing, run them, update status. */
  async processPending(limit = 10): Promise<void> {
    if (!isOracleEnabled()) return;

    const jobs = await queryRows<JobRow>(
      `SELECT ID, JOB_TYPE, PAYLOAD, ATTEMPTS, MAX_ATTEMPTS
       FROM MONT_JOB_QUEUE
       WHERE STATUS = 'PENDING'
         AND NEXT_RUN_AT <= SYSTIMESTAMP
       FETCH FIRST :lim ROWS ONLY`,
      { lim: limit },
    ).catch(() => [] as JobRow[]);

    for (const job of jobs) {
      await JobQueueService._runJob(job);
    }
  },

  async _runJob(job: JobRow): Promise<void> {
    // Mark RUNNING
    await execDml(
      `UPDATE MONT_JOB_QUEUE
       SET STATUS = 'RUNNING', ATTEMPTS = ATTEMPTS + 1, UPDATED_AT = SYSTIMESTAMP
       WHERE ID = :id AND STATUS = 'PENDING'`,
      { id: job.id },
    ).catch(() => null);

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
      const nextAttempt = job.attempts + 1;
      const exhausted   = nextAttempt >= job.max_attempts;
      // Exponential back-off: 1min, 5min, 15min
      const backoffSecs = [60, 300, 900][Math.min(nextAttempt - 1, 2)];

      await execDml(
        `UPDATE MONT_JOB_QUEUE
         SET STATUS     = :status,
             LAST_ERROR = :err,
             NEXT_RUN_AT = SYSTIMESTAMP + INTERVAL '${backoffSecs}' SECOND,
             UPDATED_AT  = SYSTIMESTAMP
         WHERE ID = :id`,
        {
          status: exhausted ? "FAILED" : "PENDING",
          err:    err instanceof Error ? err.message : String(err),
          id:     job.id,
        },
      );
      logger.warn({ id: job.id, attempt: nextAttempt, exhausted }, "[jobs] job failed");
    }
  },
};
