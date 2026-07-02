import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { PedidoFluxoSyncService } from "./PedidoFluxoSyncService";
import { EventService } from "./EventService";
import { AgendaEntregaService } from "./AgendaEntregaService";
import { JobQueueService } from "./JobQueueService";

export class MessageSchedulerService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly sync         = new PedidoFluxoSyncService();
  private readonly events       = new EventService();
  private readonly agendaEntrega = new AgendaEntregaService();

  start(intervalMs = 15 * 60 * 1_000): void {
    if (this.intervalId) return;
    console.log(`[Scheduler] Iniciado — ciclo a cada ${intervalMs / 60_000} min`);
    this._resetStuckRuns()
      .then(() => this.runCycle())
      .catch((e) => console.error("[Scheduler] Erro no ciclo inicial:", e));
    this.intervalId = setInterval(() => {
      this.runCycle().catch((e) => console.error("[Scheduler] Erro no ciclo:", e));
    }, intervalMs);
  }

  private async _resetStuckRuns(): Promise<void> {
    try {
      await execDml(
        "UPDATE MONT_SYNC_RUNS SET RUN_STATUS = 'ERRO', FINALIZADO_EM = SYSTIMESTAMP WHERE RUN_STATUS = 'RUNNING'",
      );
    } catch (e) {
      console.warn("[Scheduler] Aviso: não foi possível limpar runs presas:", (e as Error).message);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Scheduler] Parado");
    }
  }

  async runCycle(): Promise<void> {
    if (this.running) {
      console.warn("[Scheduler] Ciclo anterior ainda em execução — pulando");
      return;
    }
    this.running = true;
    try {
      await this._runSync();
      await this._runAgendaEntregaSync();
      await this._sendReminders();
      await this._runLembreteAgendarMontagem();
      await JobQueueService.processPending(20).catch((e) =>
        console.error("[Scheduler] Erro ao processar job queue:", (e as Error).message),
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
      console.log(
        `[Scheduler] AgendaEntrega sync — encontrados=${result.totalEncontrados} ` +
        `enviados=${result.convitesEnviados} simulados=${result.convitesSimulados} ` +
        `ignorados=${result.ignorados.length}`,
      );
    } catch (err) {
      console.error("[Scheduler] Erro no AgendaEntrega sync:", (err as Error).message);
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
      ).catch((e) => { console.error("[Scheduler] Falha ao buscar candidatos de lembrete:", (e as Error).message); return []; });

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
        } else if (effectiveMode === "HOMOLOGACAO") {
          const { duplicate } = await msgLog.log({
            numped, codcli: String(row.codcli),
            eventKey: "LEMBRETE_AGENDAR_MONTAGEM",
            templateId: template.id,
            destino: telefonesTeste ?? "SEM_TELEFONE_TESTE",
            status: "HOMOLOGACAO_ENVIADO_DESTINO_FORCADO",
            modoEnvio: "HOMOLOGACAO",
            idempotencyKey,
            payload: { nome_cliente: row.nome_cliente, data_envio_convite: row.data_envio_convite, destino_original: row.telefone },
          });
          if (!duplicate) enviados++;
        }
      }

      if (enviados > 0 || candidates.length > 0) {
        console.log(`[Scheduler] LembreteAgendar — candidatos=${candidates.length} lembretes=${enviados}`);
      }
    } catch (err) {
      console.error("[Scheduler] Erro no lembrete de agendamento:", (err as Error).message);
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
      console.log(
        `[Scheduler] Sync concluído — pedidos=${result.pedidosEncontrados} ` +
        `eventos=${result.eventosGerados} msgs=${result.msgsEnviadas}/${result.msgsSimuladas}`,
      );
    } catch (err) {
      console.error("[Scheduler] Erro no sync:", (err as Error).message);
    }
  }

  private async _sendReminders(): Promise<void> {
    // Tomorrow in 'YYYY-MM-DD' format (Oracle string date)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

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
        }).catch((e) => console.error(`[Scheduler] Erro lembrete ${r.numped}:`, (e as Error).message));
      }
      if (reminders.length > 0) {
        console.log(`[Scheduler] ${reminders.length} lembretes de montagem emitidos para ${tomorrowStr}`);
      }
    } catch (err) {
      console.error("[Scheduler] Erro ao consultar lembretes:", (err as Error).message);
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
        }).catch((e) => console.error(`[Scheduler] Erro pendência fotos ${r.numped}:`, (e as Error).message));
      }
      if (pendentes.length > 0) {
        console.log(`[Scheduler] ${pendentes.length} pendências de fotos emitidas`);
      }
    } catch (err) {
      console.error("[Scheduler] Erro ao consultar pendências de fotos:", (err as Error).message);
    }
  }
}

export const scheduler = new MessageSchedulerService();
