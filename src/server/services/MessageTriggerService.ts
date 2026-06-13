import { queryOne } from "../db/db";
import { MessageLogService } from "./MessageLogService";
import type { OrderSnapshot } from "./OrderSnapshotService";

export type FluxoEventTrigger = {
  id: string;
  numped: string;
  codcli: string;
  eventKey: string;
  fluxoEventKeyNovo: string;
};

export type TriggerResult = {
  status: string;
  reason?: string;
  logId?: string;
};

// Assembly-related event key prefixes — these require commission-eligible products
const ASSEMBLY_EVENT_PREFIXES = ["MONTAGEM_", "ASSEMBLY_", "AGENDA_MONTAGEM"];

export class MessageTriggerService {
  constructor(private readonly logs = new MessageLogService()) {}

  async process(event: FluxoEventTrigger, snapshot: OrderSnapshot): Promise<TriggerResult> {
    // 1. Load event config
    const config = await queryOne<{
      ativo_mensagem: number;
      modo_envio: string;
      telefones_teste: string | null;
    }>(
      "SELECT ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = :key",
      { key: event.eventKey },
    );

    if (!config || Number(config.ativo_mensagem) === 0) {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "IGNORADO_EVENTO_INATIVO",
        modoEnvio: config?.modo_envio ?? "DRY_RUN",
      });
      return { status: "IGNORADO_EVENTO_INATIVO", reason: "Evento inativo", logId: id };
    }

    // 2. For assembly events — skip if no commission-eligible products are configured
    const isAssemblyEvent = ASSEMBLY_EVENT_PREFIXES.some((p) =>
      event.eventKey.toUpperCase().startsWith(p),
    );
    if (isAssemblyEvent) {
      const itemCheck = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*) AS CNT
         FROM MONT_ASSEMBLY_JOB_ITEMS ji
         JOIN MONT_ASSEMBLY_JOBS j ON j.ID = ji.ASSEMBLY_JOB_ID
         JOIN MONT_ORDERS o ON o.ID = j.ORDER_ID
         WHERE TO_CHAR(o.NUMPED) = TO_CHAR(:numped)`,
        { numped: event.numped },
      ).catch(() => null);
      if (!itemCheck || Number(itemCheck.cnt) === 0) {
        const { id } = await this.logs.log({
          numped:   event.numped,
          codcli:   event.codcli,
          eventKey: event.eventKey,
          status:   "IGNORADO_SEM_PRODUTO_COMISSAO_MONTAGEM",
          modoEnvio: config?.modo_envio ?? "DRY_RUN",
        });
        return { status: "IGNORADO_SEM_PRODUTO_COMISSAO_MONTAGEM", reason: "Pedido sem itens com comissão de montagem configurada", logId: id };
      }
    }

    // 3. Global mode (overrides per-event mode if set to DRY_RUN)
    const globalModeRow = await queryOne<{ config_value: string }>(
      "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
    );
    const globalMode = globalModeRow?.config_value ?? "DRY_RUN";
    const effectiveMode = globalMode === "DRY_RUN" ? "DRY_RUN" : config.modo_envio;

    if (effectiveMode === "DRY_RUN") {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "SIMULADO_DRY_RUN",
        modoEnvio: "DRY_RUN",
        payload:   { snapshot: { numped: snapshot.numped, nome: snapshot.nome_cliente } },
      });
      return { status: "SIMULADO_DRY_RUN", logId: id };
    }

    // 3. Resolve phone number
    const customerPhone = await this._resolvePhone(event.codcli, snapshot, config, effectiveMode);
    if (!customerPhone) {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "IGNORADO_SEM_TELEFONE",
        modoEnvio: effectiveMode,
      });
      return { status: "IGNORADO_SEM_TELEFONE", reason: "Telefone não encontrado", logId: id };
    }

    // 4. Load template from MONT_MSG_TEMPLATES by event type (matching EVENT_TYPE = FLUXO_EVENT_KEY)
    const template = await queryOne<{ id: string; body: string; active: number }>(
      `SELECT ID, BODY, ACTIVE FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = UPPER(:et)`,
      { et: event.eventKey },
    );
    if (!template || Number(template.active) === 0) {
      const { id } = await this.logs.log({
        numped:     event.numped,
        codcli:     event.codcli,
        eventKey:   event.eventKey,
        status:     "IGNORADO_TEMPLATE_INATIVO",
        modoEnvio:  effectiveMode,
      });
      return { status: "IGNORADO_TEMPLATE_INATIVO", reason: "Template inativo ou não encontrado", logId: id };
    }

    // 5. Idempotency check
    const idempotencyKey = `fluxo:${event.numped}:${event.eventKey}:${event.id}`;
    const alreadySent = await this.logs.checkIdempotency(idempotencyKey);
    if (alreadySent) {
      return { status: "IGNORADO_DUPLICIDADE", reason: "Já enviado (idempotência)" };
    }

    // 6. Log as ENVIADO (actual send integration is future work)
    const { id: logId, duplicate } = await this.logs.log({
      numped:         event.numped,
      codcli:         event.codcli,
      eventKey:       event.eventKey,
      templateId:     template.id,
      destino:        customerPhone,
      status:         "ENVIADO",
      idempotencyKey,
      modoEnvio:      effectiveMode,
      payload:        {
        nome:     snapshot.nome_cliente,
        numped:   event.numped,
        numnota:  snapshot.numnota,
        template: template.body.slice(0, 200),
      },
    });

    if (duplicate) return { status: "IGNORADO_DUPLICIDADE", logId };
    return { status: "ENVIADO", logId };
  }

  private async _resolvePhone(
    codcli: string,
    snapshot: OrderSnapshot,
    config: { telefones_teste: string | null },
    mode: string,
  ): Promise<string | null> {
    if (mode === "HOMOLOGACAO") {
      const testNumbers = (config.telefones_teste ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return testNumbers[0] ?? null;
    }

    // Try MONT_CUSTOMERS first
    const customer = await queryOne<{ phone: string | null }>(
      "SELECT PHONE FROM MONT_CUSTOMERS WHERE CODCLI = :codcli",
      { codcli },
    );
    if (customer?.phone) return customer.phone;

    // Fall back to PCCLIENT.TELCELENT or TELENT
    const wt = await queryOne<{ telcelent: string | null; telent: string | null }>(
      "SELECT TELCELENT, TELENT FROM PCCLIENT WHERE CODCLI = :codcli",
      { codcli },
    );
    return wt?.telcelent || wt?.telent || null;
  }
}
