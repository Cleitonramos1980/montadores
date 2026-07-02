import { v4 as uuid } from "uuid";
import { execDml, queryOne } from "../db/db";
import { WinthorPedidoStatusRepository, type PedidoQueryParams } from "../oracle/WinthorPedidoStatusRepository";
import { OrderSnapshotService } from "./OrderSnapshotService";
import { MessageLogService } from "./MessageLogService";
import { MessageTriggerService } from "./MessageTriggerService";

export type SyncMode = "DRY_RUN" | "HOMOLOGACAO" | "PRODUCAO";

export type SyncParams = {
  modo: SyncMode;
  condvenda?: number;
  dataInicioPedido?: Date;
  dataFimPedido?: Date;
  numped?: string;
  codfilial?: string;
};

export type SyncResult = {
  runId: string;
  modo: SyncMode;
  pedidosEncontrados: number;
  eventosGerados: number;
  msgsSimuladas: number;
  msgsEnviadas: number;
  msgsIgnoradas: number;
  msgsErro: number;
  erros: Array<{ numped: string; message: string }>;
  status: "CONCLUIDO" | "ERRO";
};

export class PedidoFluxoSyncService {
  constructor(
    private readonly repo      = new WinthorPedidoStatusRepository(),
    private readonly snapshots = new OrderSnapshotService(),
    private readonly logs      = new MessageLogService(),
    private readonly trigger   = new MessageTriggerService(),
  ) {}

  async run(params: SyncParams): Promise<SyncResult> {
    const runId = uuid();

    // Resolve default date window from config
    const daysBackRow = await queryOne<{ config_value: string }>(
      "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'SYNC_DAYS_BACK'",
    );
    const daysBack = parseInt(daysBackRow?.config_value ?? "7", 10);

    const now = new Date();
    const dataFim = params.dataFimPedido ?? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const dataInicio = params.dataInicioPedido ?? new Date(dataFim.getTime() - daysBack * 86400_000);

    // Resolve default condvenda from config
    let condvenda = params.condvenda;
    if (!condvenda) {
      const cvRow = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'CONDVENDA_DEFAULT'",
      );
      condvenda = parseInt(cvRow?.config_value ?? "8", 10);
    }

    // Create sync run record
    await execDml(
      `INSERT INTO MONT_SYNC_RUNS
       (ID, MODO, PARAMS_JSON, RUN_STATUS, INICIADO_EM)
       VALUES (:id, :modo, :params, 'RUNNING', SYSTIMESTAMP)`,
      {
        id:     runId,
        modo:   params.modo,
        params: JSON.stringify({ condvenda, dataInicio, dataFim, numped: params.numped }),
      },
    );

    const queryParams: PedidoQueryParams = {
      dataInicioPedido: dataInicio,
      dataFimPedido:    dataFim,
      condvenda,
      numped:    params.numped ?? null,
      codfilial: params.codfilial ?? null,
    };

    let pedidosEncontrados = 0;
    let eventosGerados = 0;
    let msgsSimuladas = 0;
    let msgsEnviadas = 0;
    let msgsIgnoradas = 0;
    let msgsErro = 0;
    const erros: Array<{ numped: string; message: string }> = [];

    let rows: Awaited<ReturnType<typeof this.repo.query>> = [];
    try {
      rows = await this.repo.query(queryParams);
      pedidosEncontrados = rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      erros.push({ numped: "ALL", message: `Erro na consulta WinThor: ${msg}` });
      await this._finalizeRun(runId, { pedidosEncontrados: 0, eventosGerados: 0, msgsSimuladas: 0, msgsEnviadas: 0, msgsIgnoradas: 0, msgsErro: 1, erros, status: "ERRO" });
      return { runId, modo: params.modo, pedidosEncontrados: 0, eventosGerados: 0, msgsSimuladas: 0, msgsEnviadas: 0, msgsIgnoradas: 0, msgsErro: 1, erros, status: "ERRO" };
    }

    for (const row of rows) {
      try {
        const numped = String(row.numped);
        const { isNew, previousKey, changed, billingJustHappened } = await this.snapshots.upsert(row);

        if (!changed) continue;

        // Create FLUXO_EVENT
        const eventId = uuid();
        await execDml(
          `INSERT INTO MONT_FLUXO_EVENTS
           (ID, NUMPED, CODCLI, EVENT_KEY,
            FLUXO_STATUS_ANTERIOR, FLUXO_STATUS_NOVO,
            FLUXO_EVENT_KEY_ANTERIOR, FLUXO_EVENT_KEY_NOVO,
            PAYLOAD_ORIGEM, ORIGEM, CRIADO_EM)
           VALUES
           (:id, :numped, :codcli, :eventKey,
            :statusAnterior, :statusNovo,
            :keyAnterior, :keyNovo,
            :payload, 'SYNC', SYSTIMESTAMP)`,
          {
            id:            eventId,
            numped,
            codcli:        row.codcli ?? null,
            eventKey:      row.fluxo_event_key,
            statusAnterior: isNew ? null : (await this.snapshots.findByNumped(numped))?.fluxo_status_anterior ?? null,
            statusNovo:    row.fluxo_status,
            keyAnterior:   previousKey,
            keyNovo:       row.fluxo_event_key,
            payload:       JSON.stringify({ numped, condvenda: row.condvenda, posicao: row.posicao }),
          },
        );
        eventosGerados++;

        // Process message trigger
        const snapshot = await this.snapshots.findByNumped(numped);
        if (!snapshot) continue;

        const triggerEvent = {
          id:              eventId,
          numped,
          codcli:          row.codcli ?? "",
          eventKey:        row.fluxo_event_key,
          fluxoEventKeyNovo: row.fluxo_event_key,
        };

        const result = await this.trigger.process(triggerEvent, snapshot);

        switch (result.status) {
          case "SIMULADO_DRY_RUN": msgsSimuladas++; break;
          case "ENVIADO":          msgsEnviadas++;   break;
          default:                 msgsIgnoradas++;  break;
        }

        // Billing milestone — the FATURADO_AGUARDANDO_SAIDA phase is transient (DTFAT set,
        // DTSAIDA null). When polling catches an order that already advanced past it
        // (e.g. straight to FINALIZADO), the linear phase event above skips billing entirely.
        // Emit the billing event explicitly on the DTFAT transition so the notification fires.
        // The trigger's idempotency key (fluxo:numped:FATURADO_AGUARDANDO_SAIDA) prevents any
        // duplicate send if the order also landed on the phase naturally in a prior cycle.
        if (billingJustHappened && row.fluxo_event_key !== "FATURADO_AGUARDANDO_SAIDA") {
          const billingEventId = uuid();
          await execDml(
            `INSERT INTO MONT_FLUXO_EVENTS
             (ID, NUMPED, CODCLI, EVENT_KEY,
              FLUXO_STATUS_ANTERIOR, FLUXO_STATUS_NOVO,
              FLUXO_EVENT_KEY_ANTERIOR, FLUXO_EVENT_KEY_NOVO,
              PAYLOAD_ORIGEM, ORIGEM, CRIADO_EM)
             VALUES
             (:id, :numped, :codcli, 'FATURADO_AGUARDANDO_SAIDA',
              :statusAnterior, '5 - FATURADO/AGUARDANDO SAIDA',
              :keyAnterior, 'FATURADO_AGUARDANDO_SAIDA',
              :payload, 'SYNC_MILESTONE', SYSTIMESTAMP)`,
            {
              id:             billingEventId,
              numped,
              codcli:         row.codcli ?? null,
              statusAnterior: previousKey,
              keyAnterior:    previousKey,
              payload:        JSON.stringify({ numped, numnota: row.numnota, motivo: "milestone_faturamento_fase_pulada", faseAtual: row.fluxo_event_key }),
            },
          );
          eventosGerados++;

          const billingResult = await this.trigger.process(
            {
              id:                billingEventId,
              numped,
              codcli:            row.codcli ?? "",
              eventKey:          "FATURADO_AGUARDANDO_SAIDA",
              fluxoEventKeyNovo: "FATURADO_AGUARDANDO_SAIDA",
            },
            snapshot,
          );

          switch (billingResult.status) {
            case "SIMULADO_DRY_RUN": msgsSimuladas++; break;
            case "ENVIADO":          msgsEnviadas++;   break;
            default:                 msgsIgnoradas++;  break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        erros.push({ numped: String(row.numped), message: msg });
        msgsErro++;
      }
    }

    const finalResult: SyncResult = {
      runId,
      modo: params.modo,
      pedidosEncontrados,
      eventosGerados,
      msgsSimuladas,
      msgsEnviadas,
      msgsIgnoradas,
      msgsErro,
      erros,
      status: erros.length === pedidosEncontrados && pedidosEncontrados > 0 ? "ERRO" : "CONCLUIDO",
    };

    await this._finalizeRun(runId, finalResult);
    return finalResult;
  }

  private async _finalizeRun(runId: string, r: Omit<SyncResult, "runId" | "modo">): Promise<void> {
    await execDml(
      `UPDATE MONT_SYNC_RUNS SET
         PEDIDOS_ENCONTRADOS = :pedidos,
         EVENTOS_GERADOS     = :eventos,
         MSGS_SIMULADAS      = :simuladas,
         MSGS_ENVIADAS       = :enviadas,
         MSGS_IGNORADAS      = :ignoradas,
         MSGS_ERRO           = :msgsErro,
         ERROS_JSON          = :errosJson,
         RUN_STATUS          = :runStatus,
         FINALIZADO_EM       = SYSTIMESTAMP
       WHERE ID = :id`,
      {
        id:         runId,
        pedidos:    r.pedidosEncontrados,
        eventos:    r.eventosGerados,
        simuladas:  r.msgsSimuladas,
        enviadas:   r.msgsEnviadas,
        ignoradas:  r.msgsIgnoradas,
        msgsErro:   r.msgsErro,
        errosJson:  r.erros.length ? JSON.stringify(r.erros) : null,
        runStatus:  r.status,
      },
    );
  }

  async listRuns(page = 1, pageSize = 10): Promise<{ rows: unknown[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      queryOne<{ total: number }>(
        "SELECT COUNT(*) AS TOTAL FROM MONT_SYNC_RUNS",
      ).then(async (c) => {
        return {
          _total: Number(c?.total ?? 0),
          _rows: await import("../db/db").then(({ queryRows }) =>
            queryRows(
              `SELECT ID, MODO, PEDIDOS_ENCONTRADOS, EVENTOS_GERADOS,
                      MSGS_SIMULADAS, MSGS_ENVIADAS, MSGS_IGNORADAS, MSGS_ERRO,
                      RUN_STATUS, INICIADO_EM, FINALIZADO_EM
               FROM MONT_SYNC_RUNS
               ORDER BY INICIADO_EM DESC
               OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
              { offset, pageSize },
            ),
          ),
        };
      }),
      queryOne<{ total: number }>("SELECT COUNT(*) AS TOTAL FROM MONT_SYNC_RUNS"),
    ]);
    const { _rows, _total } = rows as { _rows: unknown[]; _total: number };
    return { rows: _rows, total: _total };
  }

  async getConfig(): Promise<Record<string, string>> {
    const { queryRows } = await import("../db/db");
    const cfgRows = await queryRows<{ config_key: string; config_value: string }>(
      "SELECT CONFIG_KEY, CONFIG_VALUE FROM MONT_SYNC_CONFIG ORDER BY CONFIG_KEY",
    );
    return Object.fromEntries(cfgRows.map((r) => [r.config_key, r.config_value]));
  }

  async setConfig(key: string, value: string): Promise<void> {
    await execDml(
      `MERGE INTO MONT_SYNC_CONFIG tgt USING DUAL ON (tgt.CONFIG_KEY = :key)
       WHEN MATCHED THEN UPDATE SET CONFIG_VALUE = :val, ATUALIZADO_EM = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (CONFIG_KEY, CONFIG_VALUE, ATUALIZADO_EM)
         VALUES (:key, :val, SYSTIMESTAMP)`,
      { key, val: value },
    );
  }
}
