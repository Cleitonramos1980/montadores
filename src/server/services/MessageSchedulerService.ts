import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { PedidoFluxoSyncService } from "./PedidoFluxoSyncService";
import { EventService } from "./EventService";
import { AgendaEntregaService } from "./AgendaEntregaService";
import { JobQueueService } from "./JobQueueService";
import { WhatsAppProviderService } from "./WhatsAppProviderService";
import { logger } from "../logger";

/**
 * Data no fuso de operação (default America/Manaus, UTC-4) em 'YYYY-MM-DD'.
 * Corrige o bug de usar toISOString() (UTC): à noite em Manaus o UTC já virou o
 * dia seguinte, fazendo a query buscar o dia errado e a idempotência gravar a
 * chave do dia errado. offsetDays: 0 = hoje, 1 = amanhã. Fuso via SCHEDULER_TIMEZONE.
 */
function localDateStr(offsetDays = 0): string {
  const tz = process.env.SCHEDULER_TIMEZONE || "America/Manaus";
  const instant = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export class MessageSchedulerService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly sync         = new PedidoFluxoSyncService();
  private readonly events       = new EventService();
  private readonly agendaEntrega = new AgendaEntregaService();
  private readonly wp           = new WhatsAppProviderService();

  start(intervalMs = 15 * 60 * 1_000): void {
    if (this.intervalId) return;
    logger.info(`[Scheduler] Iniciado — ciclo a cada ${intervalMs / 60_000} min`);
    this._resetStuckRuns()
      .then(() => this.runCycle())
      .catch((e) => logger.error({ err: e }, "[Scheduler] Erro no ciclo inicial:"));
    this.intervalId = setInterval(() => {
      this.runCycle().catch((e) => logger.error({ err: e }, "[Scheduler] Erro no ciclo:"));
    }, intervalMs);
  }

  private async _resetStuckRuns(): Promise<void> {
    try {
      await execDml(
        "UPDATE MONT_SYNC_RUNS SET RUN_STATUS = 'ERRO', FINALIZADO_EM = SYSTIMESTAMP WHERE RUN_STATUS = 'RUNNING'",
      );
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "[Scheduler] Aviso: não foi possível limpar runs presas:");
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("[Scheduler] Parado");
    }
  }

  async runCycle(): Promise<void> {
    if (this.running) {
      logger.warn("[Scheduler] Ciclo anterior ainda em execução — pulando");
      return;
    }
    this.running = true;
    try {
      await this._runSync();
      await this._runAgendaEntregaSync();
      await this._sendReminders();
      await this._runLembreteAgendarMontagem();
      await JobQueueService.processPending(20).catch((e) =>
        logger.error({ err: (e as Error).message }, "[Scheduler] Erro ao processar job queue:"),
      );
    } finally {
      this.running = false;
    }
  }

  private async _runAgendaEntregaSync(): Promise<void> {
    try {
      const modeRow = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
      ).catch(() => null);
      const syncMode = (
        modeRow?.config_value === "PRODUCAO"   ? "PRODUCAO"   :
        modeRow?.config_value === "HOMOLOGACAO" ? "HOMOLOGACAO" :
        "DRY_RUN"
      ) as "DRY_RUN" | "PRODUCAO" | "HOMOLOGACAO";

      const daysBackRow = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'SYNC_DAYS_BACK'",
      ).catch(() => null);
      const daysBack = Number(daysBackRow?.config_value ?? 7);

      const result = await this.agendaEntrega.sync({ modo: syncMode, daysBack });
      logger.info(
        `[Scheduler] AgendaEntrega sync — encontrados=${result.totalEncontrados} ` +
        `enviados=${result.convitesEnviados} simulados=${result.convitesSimulados} ` +
        `ignorados=${result.ignorados.length}`,
      );
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[Scheduler] Erro no AgendaEntrega sync:");
    }
  }

  private async _runLembreteAgendarMontagem(): Promise<void> {
    const DIAS_SEM_AGENDAR = 3;
    try {
      const modeRow = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
      ).catch(() => null);
      const globalMode = modeRow?.config_value ?? "DRY_RUN";

      const eventCfg = await queryOne<{ ativo_mensagem: number; telefones_teste: string | null }>(
        "SELECT ATIVO_MENSAGEM, TELEFONES_TESTE FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = 'LEMBRETE_AGENDAR_MONTAGEM'",
      ).catch(() => null);
      if (!eventCfg || Number(eventCfg.ativo_mensagem) === 0) return;

      const template = await queryOne<{ id: string; body: string; active: number }>(
        "SELECT ID, BODY, ACTIVE FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = 'LEMBRETE_AGENDAR_MONTAGEM'",
      ).catch(() => null);
      if (!template || Number(template.active) === 0) return;

      const candidates = await queryRows<{
        numped: string; codcli: string; nome_cliente: string;
        telefone: string | null; data_envio_convite: Date | null;
      }>(
        `SELECT NUMPED, CODCLI, NOME_CLIENTE, TELEFONE, DATA_ENVIO_CONVITE
         FROM MONT_AGENDA_CANDIDATOS
         WHERE CONVITE_ENVIADO = 1
           AND MONTAGEM_AGENDADA = 0
           AND STATUS_AGENDA NOT IN ('MONTAGEM_AGENDADA','MONTAGEM_REALIZADA','FINALIZADO')
           AND DATA_ENVIO_CONVITE IS NOT NULL
           AND DATA_ENVIO_CONVITE <= SYSDATE - :dias
         FETCH FIRST 100 ROWS ONLY`,
        { dias: DIAS_SEM_AGENDAR },
      ).catch((e) => { logger.error({ err: (e as Error).message }, "[Scheduler] Falha ao buscar candidatos de lembrete:"); return []; });

      if (candidates.length === 0) return;

      // Chave de idempotência semanal — no máximo 1 lembrete por semana por pedido
      const now = new Date();
      const startOf2024 = new Date(2024, 0, 1).getTime();
      const weekNum = Math.floor((now.getTime() - startOf2024) / (7 * 24 * 3600 * 1000));
      const telefonesTeste = eventCfg.telefones_teste;

      let enviados = 0;
      for (const row of candidates) {
        const numped = String(row.numped);
        if (!row.telefone) continue;

        const idempotencyKey = `lembrete-agendar:${numped}:w${weekNum}`;
        const checkKey = globalMode === "DRY_RUN" ? `dry:${idempotencyKey}` : idempotencyKey;

        const { MessageLogService } = await import("./MessageLogService");
        const msgLog = new MessageLogService();
        const alreadySent = await msgLog.checkIdempotency(checkKey).catch(() => false);
        if (alreadySent) continue;

        const effectiveMode = globalMode === "DRY_RUN" ? "DRY_RUN" : globalMode === "HOMOLOGACAO" ? "HOMOLOGACAO" : globalMode;
        if (effectiveMode === "DRY_RUN") {
          await msgLog.log({
            numped, codcli: String(row.codcli),
            eventKey: "LEMBRETE_AGENDAR_MONTAGEM",
            templateId: template.id,
            destino: row.telefone,
            status: "SIMULADO_DRY_RUN",
            modoEnvio: "DRY_RUN",
            idempotencyKey: `dry:${idempotencyKey}`,
            payload: { nome_cliente: row.nome_cliente, data_envio_convite: row.data_envio_convite },
          }).catch(() => null);
          enviados++;
        } else {
          // HOMOLOGACAO redireciona ao piloto; PRODUCAO usa o telefone real.
          const destino = effectiveMode === "HOMOLOGACAO" ? (telefonesTeste ?? null) : (row.telefone ?? null);
          if (!destino) {
            await msgLog.log({
              numped, codcli: String(row.codcli),
              eventKey: "LEMBRETE_AGENDAR_MONTAGEM",
              status: "IGNORADO_SEM_TELEFONE", modoEnvio: effectiveMode,
            }).catch(() => null);
            continue;
          }
          const texto = renderTemplate(template.body, {
            nome: row.nome_cliente, cliente: row.nome_cliente, nome_cliente: row.nome_cliente, numped,
          });
          const sendResult = await this.wp.send({ to: destino, text: texto, modo: effectiveMode });
          const enviado = sendResult.status === "ENVIADO";
          const { duplicate } = await msgLog.log({
            numped, codcli: String(row.codcli),
            eventKey: "LEMBRETE_AGENDAR_MONTAGEM",
            templateId: template.id,
            destino,
            status: enviado ? "ENVIADO" : "ERRO",
            modoEnvio: effectiveMode,
            // Consome idempotência só em envio bem-sucedido (permite reenvio após erro).
            idempotencyKey: enviado ? idempotencyKey : undefined,
            erro: sendResult.error ?? null,
            payload: { nome_cliente: row.nome_cliente, destino_original: row.telefone, provider: sendResult.provider },
          });
          if (enviado && !duplicate) enviados++;
        }
      }

      if (enviados > 0 || candidates.length > 0) {
        logger.info(`[Scheduler] LembreteAgendar — candidatos=${candidates.length} lembretes=${enviados}`);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[Scheduler] Erro no lembrete de agendamento:");
    }
  }

  private async _runSync(): Promise<void> {
    try {
      const modeRow = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
      );
      const rawMode = modeRow?.config_value ?? "DRY_RUN";
      const syncMode = (
        rawMode === "PRODUCAO"   ? "PRODUCAO"   :
        rawMode === "HOMOLOGACAO" ? "HOMOLOGACAO" :
        "DRY_RUN"
      ) as "DRY_RUN" | "PRODUCAO" | "HOMOLOGACAO";
      const result = await this.sync.run({ modo: syncMode });
      logger.info(
        `[Scheduler] Sync concluído — pedidos=${result.pedidosEncontrados} ` +
        `eventos=${result.eventosGerados} msgs=${result.msgsEnviadas}/${result.msgsSimuladas}`,
      );
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[Scheduler] Erro no sync:");
    }
  }

  private async _sendReminders(): Promise<void> {
    // Datas no fuso de operação (America/Manaus, UTC-4), NÃO em UTC — senão à noite
    // o "amanhã"/"hoje" saem um dia à frente e a idempotência trava o dia certo.
    const tomorrowStr = localDateStr(1);
    const todayStr    = localDateStr(0);

    // LEMBRETE_MONTAGEM_CLIENTE: assemblies scheduled for tomorrow
    try {
      const reminders = await queryRows<{ numped: string; codcli: string; schedule_id: string }>(
        `SELECT o.NUMPED AS numped, o.CODCLI AS codcli, s.ID AS schedule_id
         FROM MONT_ASSEMBLY_SCHEDULES s
         JOIN MONT_ORDERS o ON o.ID = s.ORDER_ID
         WHERE s.SCHEDULED_DATE = :d AND s.STATUS = 'AGENDADA'`,
        { d: tomorrowStr },
      );
      for (const r of reminders) {
        await this.events.emit({
          type:           "LEMBRETE_MONTAGEM_CLIENTE",
          numped:         r.numped,
          codcli:         r.codcli,
          origin:         "JOB",
          idempotencyKey: `lembrete-montagem:${r.numped}:${tomorrowStr}`,
          metadata:       { scheduleId: r.schedule_id, scheduledDate: tomorrowStr },
        }).catch((e) => logger.error({ err: (e as Error).message }, `[Scheduler] Erro lembrete ${r.numped}:`));
      }
      if (reminders.length > 0) {
        logger.info(`[Scheduler] ${reminders.length} lembretes de montagem emitidos para ${tomorrowStr}`);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[Scheduler] Erro ao consultar lembretes:");
    }

    // PENDENCIA_FOTOS_MONTADOR: jobs finished today without photos
    try {
      const pendentes = await queryRows<{ numped: string; codcli: string; job_id: string }>(
        `SELECT o.NUMPED AS numped, o.CODCLI AS codcli, j.ID AS job_id
         FROM MONT_ASSEMBLY_JOBS j
         JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
         WHERE j.STATUS = 'FINALIZADO'
           AND TRUNC(j.FINISHED_AT) = TRUNC(SYSDATE)
           AND NOT EXISTS (
             SELECT 1 FROM MONT_ASSEMBLY_PHOTOS p WHERE p.ASSEMBLY_JOB_ID = j.ID
           )`,
      );
      for (const r of pendentes) {
        await this.events.emit({
          type:           "PENDENCIA_FOTOS_MONTADOR",
          numped:         r.numped,
          codcli:         r.codcli,
          origin:         "JOB",
          idempotencyKey: `fotos-pendentes:${r.numped}:${todayStr}`,
          metadata:       { jobId: r.job_id, date: todayStr },
        }).catch((e) => logger.error({ err: (e as Error).message }, `[Scheduler] Erro pendência fotos ${r.numped}:`));
      }
      if (pendentes.length > 0) {
        logger.info(`[Scheduler] ${pendentes.length} pendências de fotos emitidas`);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[Scheduler] Erro ao consultar pendências de fotos:");
    }
  }
}

export const scheduler = new MessageSchedulerService();
