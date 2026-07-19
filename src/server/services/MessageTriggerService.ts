import { queryOne } from "../db/db";
import { DispatchGateService } from "./DispatchGateService";
import { MessageLogService } from "./MessageLogService";
import { WhatsAppProviderService } from "./WhatsAppProviderService";
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

function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export class MessageTriggerService {
  constructor(
    private readonly logs = new MessageLogService(),
    private readonly wp   = new WhatsAppProviderService(),
    private readonly gate = new DispatchGateService(),
  ) {}

  async process(event: FluxoEventTrigger, snapshot: OrderSnapshot): Promise<TriggerResult> {
    // 1. Load event config
    const eventConfig = await queryOne<{
      ativo_mensagem: number;
      modo_envio: string;
      telefones_teste: string | null;
    }>(
      "SELECT ATIVO_MENSAGEM, MODO_ENVIO, TELEFONES_TESTE FROM MONT_FLUXO_EVENT_CONFIG WHERE EVENT_KEY = :key",
      { key: event.eventKey },
    );

    if (!eventConfig || Number(eventConfig.ativo_mensagem) === 0) {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "IGNORADO_EVENTO_INATIVO",
        modoEnvio: eventConfig?.modo_envio ?? "DRY_RUN",
      });
      return { status: "IGNORADO_EVENTO_INATIVO", reason: "Evento inativo", logId: id };
    }

    // 2. Global mode (DRY_RUN wins if set globally)
    const globalModeRow = await queryOne<{ config_value: string }>(
      "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
    );
    const globalMode = globalModeRow?.config_value ?? "DRY_RUN";
    // Modo global é TETO de segurança rígido: um evento nunca envia "mais real" que o
    // modo global. Se global=HOMOLOGACAO e o evento tiver modo_envio=PRODUCAO, prevalece
    // HOMOLOGACAO (antes o PRODUCAO do evento vazava mensagem ao cliente real).
    const modeRank: Record<string, number> = { DRY_RUN: 0, HOMOLOGACAO: 1, PRODUCAO: 2 };
    const eventMode = eventConfig.modo_envio ?? "DRY_RUN";
    const effectiveMode =
      (modeRank[eventMode] ?? 0) <= (modeRank[globalMode] ?? 0) ? eventMode : globalMode;

    // 3. DRY_RUN: short-circuit with deduplication — never calls WhatsApp
    if (effectiveMode === "DRY_RUN") {
      // Chave PREFIXADA com "dry:" para NUNCA colidir com a chave do envio real
      // (fluxo:...). Como o índice UNIQUE em IDEMPOTENCY_KEY cobre todos os status, uma
      // chave compartilhada faria o envio real colidir com a simulação e reenviar em loop
      // ao promover o modo. O prefixo isola completamente a trilha simulada da real.
      const idempotencyKey = `dry:fluxo:${event.numped}:${event.eventKey}`;
      const alreadySent = await this.logs.checkIdempotency(idempotencyKey, "DRY_RUN");
      if (alreadySent) {
        return { status: "IGNORADO_DUPLICIDADE", reason: "Já simulado (idempotência DRY_RUN)" };
      }
      const { id } = await this.logs.log({
        numped:         event.numped,
        codcli:         event.codcli,
        eventKey:       event.eventKey,
        status:         "SIMULADO_DRY_RUN",
        modoEnvio:      "DRY_RUN",
        idempotencyKey,
        payload:        { snapshot: { numped: snapshot.numped, nome: snapshot.nome_cliente } },
      });
      return { status: "SIMULADO_DRY_RUN", logId: id };
    }

    // 4. Resolve destination phone
    // HOMOLOGACAO: always redirect to configured test phones — NEVER to real customer
    // PRODUCAO: use real customer phone (with opt-out and fallback checks)
    let destPhone: string;

    if (effectiveMode === "HOMOLOGACAO") {
      const testNumbers = (eventConfig.telefones_teste ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (!testNumbers[0]) {
        const { id } = await this.logs.log({
          numped:    event.numped,
          codcli:    event.codcli,
          eventKey:  event.eventKey,
          status:    "IGNORADO_SEM_TELEFONE",
          modoEnvio: effectiveMode,
          payload:   { aviso: "HOMOLOGACAO ativo mas TELEFONES_TESTE não configurado no evento." },
        });
        return { status: "IGNORADO_SEM_TELEFONE", reason: "HOMOLOGACAO sem piloto configurado", logId: id };
      }
      destPhone = testNumbers[0];
    } else {
      // PRODUCAO: resolve real customer phone
      const customer = await queryOne<{ phone: string | null; opt_out_whatsapp: number }>(
        "SELECT PHONE, OPT_OUT_WHATSAPP FROM MONT_CUSTOMERS WHERE CODCLI = :codcli",
        { codcli: event.codcli },
      );

      if (Number(customer?.opt_out_whatsapp ?? 0) === 1) {
        const { id } = await this.logs.log({
          numped:    event.numped,
          codcli:    event.codcli,
          eventKey:  event.eventKey,
          status:    "IGNORADO_OPT_OUT",
          modoEnvio: effectiveMode,
        });
        return { status: "IGNORADO_OPT_OUT", reason: "Cliente optou por não receber mensagens", logId: id };
      }

      let phone: string | null = customer?.phone ?? null;
      if (!phone) {
        const wt = await queryOne<{ telcelent: string | null; telent: string | null }>(
          "SELECT TELCELENT, TELENT FROM PCCLIENT WHERE CODCLI = :codcli",
          { codcli: event.codcli },
        );
        phone = wt?.telcelent || wt?.telent || null;
      }

      if (!phone) {
        const { id } = await this.logs.log({
          numped:    event.numped,
          codcli:    event.codcli,
          eventKey:  event.eventKey,
          status:    "IGNORADO_SEM_TELEFONE",
          modoEnvio: effectiveMode,
        });
        return { status: "IGNORADO_SEM_TELEFONE", reason: "Telefone não encontrado", logId: id };
      }
      destPhone = phone;
    }

    // 5. Load template (must include resend config columns)
    const template = await queryOne<{
      id: string;
      body: string;
      active: number;
      send_hour_start: number | null;
      send_hour_end:   number | null;
      resend_allowed:  number | null;
      max_resends:     number | null;
      resend_after_h:  number | null;
    }>(
      `SELECT ID, BODY, ACTIVE, SEND_HOUR_START, SEND_HOUR_END,
              RESEND_ALLOWED, MAX_RESENDS, RESEND_AFTER_H
       FROM MONT_MSG_TEMPLATES WHERE UPPER(EVENT_TYPE) = UPPER(:et)`,
      { et: event.eventKey },
    );

    if (!template || Number(template.active) === 0) {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "IGNORADO_TEMPLATE_INATIVO",
        modoEnvio: effectiveMode,
      });
      return { status: "IGNORADO_TEMPLATE_INATIVO", reason: "Template inativo ou não encontrado", logId: id };
    }

    // 6. Dispatch gate (hour window + weekends + holidays)
    const gateResult = this.gate.check({
      sendHourStart: template.send_hour_start ?? 8,
      sendHourEnd:   template.send_hour_end   ?? 21,
    });
    if (!gateResult.allowed) {
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        status:    "IGNORADO_REGRA_NAO_VALIDADA",
        modoEnvio: effectiveMode,
        payload:   { reason: gateResult.reason },
      });
      return { status: "IGNORADO_REGRA_NAO_VALIDADA", reason: gateResult.reason, logId: id };
    }

    // 7. Idempotency + optional resend logic
    const baseKey     = `fluxo:${event.numped}:${event.eventKey}`;
    const alreadySent = await this.logs.checkIdempotency(baseKey);
    let idempotencyKey = baseKey;

    if (alreadySent) {
      const resendAllowed = Number(template.resend_allowed ?? 0);
      if (!resendAllowed) {
        return { status: "IGNORADO_DUPLICIDADE", reason: "Já enviado — reenvio não permitido para este template" };
      }

      const maxResends   = Number(template.max_resends  ?? 1);
      const resendAfterH = Number(template.resend_after_h ?? 24);
      const { resendCount, lastSentAt } = await this.logs.getSendHistory(baseKey);

      if (resendCount >= maxResends) {
        return { status: "IGNORADO_DUPLICIDADE", reason: `Limite de ${maxResends} reenvio(s) atingido` };
      }
      if (lastSentAt) {
        const elapsedH = (Date.now() - new Date(lastSentAt).getTime()) / 3_600_000;
        if (elapsedH < resendAfterH) {
          const remaining = Math.ceil(resendAfterH - elapsedH);
          return {
            status: "IGNORADO_DUPLICIDADE",
            reason:  `Intervalo de reenvio não atingido — aguarde ${resendAfterH}h (${remaining}h restantes)`,
          };
        }
      }
      idempotencyKey = `${baseKey}:r${resendCount + 1}`;
    }

    // 8. Render template and send
    // CTA da jornada: quando o template referencia {{link_jornada}}, gera o link público
    // (token de jornada) do pedido. Sem link resolvido, o guard de placeholders abaixo
    // bloqueia o envio — nunca manda o texto cru "{{link_jornada}}" ao cliente.
    let linkJornada: string | undefined;
    if (/\{\{link_jornada\}\}/.test(template.body)) {
      try {
        const ord = await queryOne<{ id: string }>(
          "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
          { numped: event.numped },
        );
        if (ord?.id) {
          const { TokenService } = await import("./TokenService");
          const { url } = await new TokenService().create(ord.id, "JORNADA_CLIENTE");
          linkJornada = url;
        }
      } catch {
        // Falha ao gerar o link é tratada pelo guard de placeholders (bloqueia o envio).
      }
    }

    const renderedText = renderTemplate(template.body, {
      nome:         snapshot.nome_cliente,
      cliente:      snapshot.nome_cliente,
      numped:       snapshot.numped,
      numnota:      snapshot.numnota ?? undefined,
      codcli:       snapshot.codcli,
      link_jornada: linkJornada,
    });

    // Guard anti-texto-cru: se sobrou algum {{placeholder}} não resolvido após a
    // substituição, NÃO envia — registra ERRO com diagnóstico. Evita mandar ao cliente
    // uma mensagem com "{{...}}" literal (link, montador, protocolo etc. não resolvidos).
    const unresolved = renderedText.match(/\{\{\w+\}\}/g);
    if (unresolved && unresolved.length > 0) {
      const faltantes = [...new Set(unresolved)];
      const { id } = await this.logs.log({
        numped:    event.numped,
        codcli:    event.codcli,
        eventKey:  event.eventKey,
        templateId: template.id,
        destino:   destPhone,
        status:    "ERRO",
        modoEnvio: effectiveMode,
        erro:      `Placeholders não resolvidos: ${faltantes.join(", ")}`,
        payload:   { placeholders_nao_resolvidos: faltantes },
      });
      return { status: "ERRO", reason: "Placeholders não resolvidos no template", logId: id };
    }

    const sendResult = await this.wp.send({ to: destPhone, text: renderedText, modo: effectiveMode });

    const logStatus = sendResult.status === "ENVIADO" ? "ENVIADO" : "ERRO";
    // A chave de idempotência só é consumida em ENVIO com sucesso. Um ERRO (falha
    // transitória do provider) registra o log SEM a chave, para que a próxima
    // sincronização possa reenviar — senão a mensagem ficaria bloqueada para sempre.
    const { id: logId, duplicate } = await this.logs.log({
      numped:         event.numped,
      codcli:         event.codcli,
      eventKey:       event.eventKey,
      templateId:     template.id,
      destino:        destPhone,
      status:         logStatus,
      idempotencyKey: logStatus === "ENVIADO" ? idempotencyKey : undefined,
      modoEnvio:      effectiveMode,
      erro:           sendResult.error ?? null,
      payload:        {
        nome:     snapshot.nome_cliente,
        numped:   event.numped,
        provider: sendResult.provider,
      },
    });

    if (duplicate) return { status: "IGNORADO_DUPLICIDADE", logId };
    return { status: logStatus, logId };
  }
}
