import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { WinthorAgendaRepository } from "../oracle/WinthorAgendaRepository";
import { MessageLogService } from "./MessageLogService";
import { WhatsAppProviderService } from "./WhatsAppProviderService";

function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export type AgendaStatusKey =
  | "AGUARDANDO_ENTREGA"
  | "ENTREGUE_APTO_AGENDAMENTO"
  | "CONVITE_ENVIADO"
  | "AGUARDANDO_CLIENTE_AGENDAR"
  | "MONTAGEM_AGENDADA"
  | "MONTAGEM_REALIZADA"
  | "FINALIZADO";

export type AgendaCandidato = {
  orderId: string | null;
  numped: string;
  codcli: string;
  nomeCliente: string;
  telefone: string | null;
  codfilial: string | null;
  numcar: string | null;
  numnota: string | null;
  dataFaturamento: Date | null;
  dataSaidaNota: Date | null;
  dataEntregaConfirmada: Date | null;
  currentStatus: string | null;
  statusAgenda: AgendaStatusKey;
  conviteEnviado: boolean;
  dataEnvioConvite: Date | null;
  montagemAgendada: boolean;
  aptoParaAgendamento: boolean;
};

export type SyncAgendaResult = {
  modo: "DRY_RUN" | "HOMOLOGACAO" | "PRODUCAO";
  totalEncontrados: number;
  aptosEntregues: number;
  convitesSimulados: number;
  convitesEnviados: number;
  ignorados: Array<{ numped: string; motivo: string }>;
  erros: Array<{ numped: string; message: string }>;
};

export class AgendaEntregaService {
  constructor(
    private readonly repo   = new WinthorAgendaRepository(),
    private readonly msgLog = new MessageLogService(),
    private readonly wp     = new WhatsAppProviderService(),
  ) {}

  async list(params: {
    daysBack?: number;
    somenteEntregues?: boolean;
    somenteSemConvite?: boolean;
    somenteElegiveis?: boolean;
    codfilial?: string;
    numped?: string;
  } = {}): Promise<AgendaCandidato[]> {
    const rows = await this.repo.queryByMontOrders({
      daysBack:           params.daysBack ?? 60,
      somenteEntregues:   params.somenteEntregues !== false,
      somenteComMontagem: false, // VLMAODEOBRA não existe neste WinThor; mostra todos os entregues
      codfilial:          params.codfilial ?? null,
      numped:             params.numped    ?? null,
    });

    return rows
      .filter((r) => {
        if (params.somenteSemConvite && Number(r.convite_enviado) === 1) return false;
        return true;
      })
      .map((r) => this._mapRow(r));
  }

  async sync(params: { daysBack?: number; modo?: "DRY_RUN" | "HOMOLOGACAO" | "PRODUCAO" } = {}): Promise<SyncAgendaResult> {
    const modo      = params.modo ?? "DRY_RUN";
    const daysBack  = params.daysBack ?? 60;

    const rows = await this.repo.queryByMontOrders({ daysBack, somenteEntregues: true, somenteComMontagem: false });

    const result: SyncAgendaResult = {
      modo,
      totalEncontrados: rows.length,
      aptosEntregues:   0,
      convitesSimulados: 0,
      convitesEnviados:  0,
      ignorados: [],
      erros: [],
    };

    // Load global trigger mode
    const modeRow = await queryOne<{ config_value: string }>(
      "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
    ).catch(() => null);
    const globalMode = modeRow?.config_value ?? "DRY_RUN";
    const effectiveMode = globalMode === "DRY_RUN" ? "DRY_RUN" : modo;

    // Em HOMOLOGACAO todo envio vai para o piloto configurado (nunca ao cliente real).
    let pilotPhone: string | null = null;
    if (effectiveMode === "HOMOLOGACAO") {
      const cfg = await queryOne<{ telefones_teste: string | null }>(
        "SELECT TELEFONES_TESTE FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = 'ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM'",
      ).catch(() => null);
      const fromEvent = (cfg?.telefones_teste ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
      const globalPilot = await queryOne<{ config_value: string }>(
        "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'HOMOLOGACAO_PILOT_PHONE'",
      ).catch(() => null);
      pilotPhone = fromEvent ?? globalPilot?.config_value ?? null;
    }

    for (const row of rows) {
      try {
        const numped = String(row.numped);

        // Upsert into MONT_AGENDA_CANDIDATOS
        await this._upsertCandidato(row);
        result.aptosEntregues++;

        // Skip if already sent
        if (Number(row.convite_enviado) === 1) {
          result.ignorados.push({ numped, motivo: "IGNORADO_DUPLICIDADE" });
          continue;
        }

        // Skip if already scheduled
        if (Number(row.montagem_agendada) === 1) {
          result.ignorados.push({ numped, motivo: "IGNORADO_MONTAGEM_JA_AGENDADA" });
          continue;
        }

        const telefone = row.telefone;
        if (!telefone) {
          result.ignorados.push({ numped, motivo: "IGNORADO_SEM_TELEFONE" });
          await this.msgLog.log({
            numped,
            codcli:    String(row.codcli),
            eventKey:  "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM",
            status:    "IGNORADO_SEM_TELEFONE",
            modoEnvio: effectiveMode,
          });
          continue;
        }

        // Load template
        const template = await queryOne<{ id: string; body: string; active: number }>(
          "SELECT ID, BODY, ACTIVE FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = 'ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM'",
        ).catch(() => null);

        if (!template || Number(template.active) === 0) {
          result.ignorados.push({ numped, motivo: "IGNORADO_TEMPLATE_INATIVO" });
          await this.msgLog.log({
            numped,
            codcli:    String(row.codcli),
            eventKey:  "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM",
            status:    "IGNORADO_TEMPLATE_INATIVO",
            modoEnvio: effectiveMode,
          });
          continue;
        }

        // Idempotency key: numped + event + dtfecha
        const dtfecha = row.data_entrega_confirmada instanceof Date
          ? row.data_entrega_confirmada.toISOString().replace(/\D/g, "").slice(0, 14)
          : String(row.data_entrega_confirmada ?? "").replace(/\D/g, "").slice(0, 14);
        const idempotencyKey = `${numped}-ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM-${dtfecha}`;

        const alreadySent = await this.msgLog.checkIdempotency(idempotencyKey);
        if (alreadySent) {
          result.ignorados.push({ numped, motivo: "IGNORADO_DUPLICIDADE" });
          continue;
        }

        if (effectiveMode === "DRY_RUN") {
          await this.msgLog.log({
            numped,
            codcli:         String(row.codcli),
            eventKey:       "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM",
            templateId:     template.id,
            destino:        telefone,
            status:         "SIMULADO_DRY_RUN",
            modoEnvio:      "DRY_RUN",
            idempotencyKey,
            payload: {
              nome_cliente:         row.nome_cliente,
              data_entrega:         row.data_entrega_confirmada,
              numcar:               row.numcar,
            },
          });
          result.convitesSimulados++;
        } else {
          // HOMOLOGACAO redireciona ao piloto; PRODUCAO usa o telefone real do cliente.
          const destino = effectiveMode === "HOMOLOGACAO" ? pilotPhone : telefone;
          if (!destino) {
            result.ignorados.push({ numped, motivo: "IGNORADO_SEM_TELEFONE" });
            await this.msgLog.log({
              numped, codcli: String(row.codcli),
              eventKey: "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM",
              status: "IGNORADO_SEM_TELEFONE", modoEnvio: effectiveMode,
              payload: { aviso: "HOMOLOGACAO sem telefone piloto configurado." },
            });
            continue;
          }

          const texto = renderTemplate(template.body, {
            nome:         row.nome_cliente,
            cliente:      row.nome_cliente,
            nome_cliente: row.nome_cliente,
            numped,
          });
          const sendResult = await this.wp.send({ to: destino, text: texto, modo: effectiveMode });
          const enviado = sendResult.status === "ENVIADO";

          const { duplicate } = await this.msgLog.log({
            numped,
            codcli:         String(row.codcli),
            eventKey:       "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM",
            templateId:     template.id,
            destino,
            status:         enviado ? "ENVIADO" : "ERRO",
            modoEnvio:      effectiveMode,
            // Só consome a idempotência em envio bem-sucedido (permite reenvio após erro).
            idempotencyKey: enviado ? idempotencyKey : undefined,
            erro:           sendResult.error ?? null,
            payload: {
              nome_cliente: row.nome_cliente,
              data_entrega: row.data_entrega_confirmada,
              provider:     sendResult.provider,
            },
          });
          if (enviado && !duplicate) {
            await this._marcarConviteEnviado(numped, new Date());
            result.convitesEnviados++;
          } else if (!enviado) {
            result.erros.push({ numped, message: sendResult.error ?? "Falha no envio" });
          } else {
            result.ignorados.push({ numped, motivo: "IGNORADO_DUPLICIDADE" });
          }
        }
      } catch (err) {
        result.erros.push({ numped: String(row.numped), message: (err as Error).message });
      }
    }

    return result;
  }

  async marcarMontagemAgendada(numped: string, dataAgendamento: Date): Promise<void> {
    await execDml(
      `MERGE INTO MONT_AGENDA_CANDIDATOS tgt USING DUAL ON (tgt.NUMPED = :numped)
       WHEN MATCHED THEN UPDATE SET
         MONTAGEM_AGENDADA      = 1,
         DATA_MONTAGEM_AGENDADA = :dataAg,
         STATUS_AGENDA          = 'MONTAGEM_AGENDADA',
         UPDATED_AT             = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (NUMPED, MONTAGEM_AGENDADA, DATA_MONTAGEM_AGENDADA, STATUS_AGENDA)
         VALUES (:numped, 1, :dataAg, 'MONTAGEM_AGENDADA')`,
      { numped, dataAg: dataAgendamento },
    );
  }

  async diagnostico(): Promise<Record<string, unknown>> {
    return this.repo.diagnostico();
  }

  async getSummaryStats(): Promise<Record<string, number>> {
    try {
      const rows = await queryRows<{ status_agenda: string; cnt: number }>(
        `SELECT STATUS_AGENDA, COUNT(*) AS CNT FROM MONT_AGENDA_CANDIDATOS GROUP BY STATUS_AGENDA`,
      );
      return Object.fromEntries(rows.map((r) => [r.status_agenda, Number(r.cnt)]));
    } catch { return {}; }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _upsertCandidato(row: Awaited<ReturnType<typeof WinthorAgendaRepository.prototype.queryByMontOrders>>[number]): Promise<void> {
    await execDml(
      `MERGE INTO MONT_AGENDA_CANDIDATOS tgt USING DUAL ON (tgt.NUMPED = :numped)
       WHEN MATCHED THEN UPDATE SET
         CODCLI                  = :codcli,
         NOME_CLIENTE            = :nomeCliente,
         TELEFONE                = :telefone,
         CODFILIAL               = :codfilial,
         NUMNOTA                 = :numnota,
         NUMCAR                  = :numcar,
         DATA_FATURAMENTO        = :dtFat,
         DATA_SAIDA_NOTA         = :dtSaida,
         DATA_ENTREGA_CONFIRMADA = :dtFecha,
         STATUS_AGENDA           = CASE WHEN tgt.STATUS_AGENDA IN ('MONTAGEM_AGENDADA','MONTAGEM_REALIZADA','FINALIZADO') THEN tgt.STATUS_AGENDA ELSE 'ENTREGUE_APTO_AGENDAMENTO' END,
         UPDATED_AT              = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (
         NUMPED, CODCLI, NOME_CLIENTE, TELEFONE, CODFILIAL, NUMNOTA, NUMCAR,
         DATA_FATURAMENTO, DATA_SAIDA_NOTA, DATA_ENTREGA_CONFIRMADA,
         ORIGEM_ENTREGA, STATUS_AGENDA, CONVITE_ENVIADO, MONTAGEM_AGENDADA
       ) VALUES (
         :numped, :codcli, :nomeCliente, :telefone, :codfilial, :numnota, :numcar,
         :dtFat, :dtSaida, :dtFecha,
         'PCCARREG_DTFECHA', 'ENTREGUE_APTO_AGENDAMENTO', 0, 0
       )`,
      {
        numped:      String(row.numped),
        codcli:      row.codcli ?? null,
        nomeCliente: row.nome_cliente ?? null,
        telefone:    row.telefone ?? null,
        codfilial:   row.codfilial ?? null,
        numnota:     row.numnota ?? null,
        numcar:      row.numcar ?? null,
        dtFat:       row.data_faturamento ?? null,
        dtSaida:     row.data_saida_nota ?? null,
        dtFecha:     row.data_entrega_confirmada ?? null,
      },
    );
  }

  private async _marcarConviteEnviado(numped: string, dataEnvio: Date): Promise<void> {
    await execDml(
      `UPDATE MONT_AGENDA_CANDIDATOS
       SET CONVITE_ENVIADO    = 1,
           DATA_ENVIO_CONVITE = :dataEnvio,
           STATUS_AGENDA      = 'CONVITE_ENVIADO',
           UPDATED_AT         = SYSTIMESTAMP
       WHERE NUMPED = :numped`,
      { numped, dataEnvio },
    );
  }

  async migrateDryRunKeys(): Promise<{ migrated: number; message: string }> {
    return { migrated: 0, message: "Chaves de idempotência já no formato canônico fluxo:numped:eventKey" };
  }

  private _mapRow(r: Awaited<ReturnType<typeof WinthorAgendaRepository.prototype.queryByMontOrders>>[number]): AgendaCandidato {
    const entregue = r.data_entrega_confirmada != null;
    const conviteEnviado = Number(r.convite_enviado) === 1;

    let statusAgenda: AgendaStatusKey;
    if (r.status_agenda) {
      statusAgenda = r.status_agenda as AgendaStatusKey;
    } else if (!entregue) {
      statusAgenda = "AGUARDANDO_ENTREGA";
    } else if (Number(r.montagem_agendada) === 1) {
      statusAgenda = "MONTAGEM_AGENDADA";
    } else if (conviteEnviado) {
      statusAgenda = "CONVITE_ENVIADO";
    } else {
      statusAgenda = "ENTREGUE_APTO_AGENDAMENTO";
    }

    return {
      orderId:              r.order_id,
      numped:               String(r.numped),
      codcli:               String(r.codcli),
      nomeCliente:          r.nome_cliente,
      telefone:             r.telefone ?? null,
      codfilial:            r.codfilial ?? null,
      numcar:               r.numcar ?? null,
      numnota:              r.numnota ?? null,
      dataFaturamento:      r.data_faturamento ?? null,
      dataSaidaNota:        r.data_saida_nota ?? null,
      dataEntregaConfirmada: r.data_entrega_confirmada ?? null,
      currentStatus:        r.current_status ?? null,
      statusAgenda,
      conviteEnviado,
      dataEnvioConvite:     r.data_envio_convite ?? null,
      montagemAgendada:     Number(r.montagem_agendada) === 1,
      aptoParaAgendamento:  entregue && !Number(r.montagem_agendada),
    };
  }
}
