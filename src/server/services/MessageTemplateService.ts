import { v4 as uuid } from "uuid";
import { eventTypes } from "../../shared/domain";
import { execDml, queryOne, queryRows } from "../db/db";
import { AuditService } from "./AuditService";

const customerMessageEvents = new Set([
  "PEDIDO_CRIADO",
  "PEDIDO_PAGAMENTO_APROVADO",
  "PEDIDO_PAGAMENTO_RECUSADO",
  "PEDIDO_CANCELADO_PAGAMENTO",
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "FATURADO",
  "SAIU_PARA_ENTREGA",
  "PEDIDO_EM_ROTA",
  "ENTREGA_REALIZADA",
  "TENTATIVA_ENTREGA_FRUSTRADA",
  "ENTREGA_REAGENDADA",
  "ATENDIMENTO_AVALIACAO_ENVIADA",
  "ENTREGA_AVALIADA",
  "MONTAGEM_NECESSARIA",
  "LINK_AGENDAMENTO_ENVIADO",
  "MONTAGEM_AGENDADA",
  "LEMBRETE_MONTAGEM_24H",
  "LEMBRETE_MONTAGEM_DIA",
  "MONTADOR_CHEGOU",
  "MONTAGEM_INICIADA",
  "MONTAGEM_FINALIZADA",
  "FOTOS_MONTAGEM_ANEXADAS",
  "LINK_AVALIACAO_MONTAGEM_ENVIADO",
  "AVALIACAO_CLIENTE_RECEBIDA",
  "MONTAGEM_APROVADA_CLIENTE",
  "MONTAGEM_REPROVADA_CLIENTE",
  "MONTAGEM_REAGENDADA_SAC",
  "RECLAMACAO_CLIENTE_ABERTA",
  "SAC_CASO_ABERTO",
  "SAC_EM_ANALISE",
  "SAC_SOLICITOU_INFO",
  "SAC_APROVOU_LIBERACAO",
  "SAC_REPROVOU_LIBERACAO",
  "SAC_ENCERROU_CASO",
  "JORNADA_ENCERRADA",
]);

const providerMessageEvents = new Set([
  "MONTADOR_NOTIFICADO",
  "MONTADOR_LEMBRETE_DIA",
  "MONTADOR_SERVICO_REAGENDADO",
  "MONTADOR_SERVICO_CANCELADO",
  "MONTADOR_CLIENTE_ALTEROU",
  "MONTADOR_FOTOS_PENDENTES",
  "MONTADOR_MONTAGEM_FINALIZADA",
  "MONTADOR_MONTAGEM_REPROVADA",
  "MONTADOR_SAC_ANALISE",
  "PAGAMENTO_AGUARDANDO_APROVACAO",
  "PAGAMENTO_BLOQUEADO",
  "PAGAMENTO_LIBERADO",
  "PAGAMENTO_ENVIADO_FINANCEIRO",
  "PAGAMENTO_PROGRAMADO",
  "PAGAMENTO_REALIZADO",
]);

function recipientOf(eventType: string): "CLIENTE" | "FORNECEDOR" | "INTERNO" {
  if (customerMessageEvents.has(eventType)) return "CLIENTE";
  if (providerMessageEvents.has(eventType)) return "FORNECEDOR";
  return "INTERNO";
}

export { providerMessageEvents, customerMessageEvents };

export class MessageTemplateService {
  constructor(private readonly audit = new AuditService()) {}

  async list() {
    const existing = await queryRows<Record<string, unknown>>(
      "SELECT * FROM MONT_MSG_TEMPLATES ORDER BY EVENT_TYPE",
    );
    const byEvent = new Map(existing.map((t) => [String(t.event_type), t]));

    return eventTypes.map((eventType, index) => {
      const row = byEvent.get(eventType);
      // Respect recipient stored in DB; fall back to computed default
      const recipient = (row?.recipient as string | undefined) ?? recipientOf(eventType);
      return {
        phaseOrder: index + 1,
        eventType,
        recipient: recipient as "CLIENTE" | "FORNECEDOR" | "INTERNO",
        sendToCustomer: customerMessageEvents.has(eventType),
        sendToProvider: providerMessageEvents.has(eventType),
        template: row ?? null,
      };
    });
  }

  async upsert(input: {
    eventType: string;
    channel: string;
    subject?: string;
    body: string;
    active: boolean;
    recipient?: string;
    ctaLabel?: string;
    ctaUrlVar?: string;
    antifraudeType?: string;
    resendAllowed?: number;
    resendAfterH?: number;
    maxResends?: number;
    sendHourStart?: number;
    sendHourEnd?: number;
    userId?: string;
  }) {
    const previous = await queryOne("SELECT * FROM MONT_MSG_TEMPLATES WHERE EVENT_TYPE = :et", { et: input.eventType });
    const id = (previous as { id?: string } | null)?.id ?? uuid();
    const recipient = input.recipient ?? recipientOf(input.eventType);

    await execDml(
      `MERGE INTO MONT_MSG_TEMPLATES t
       USING DUAL ON (t.EVENT_TYPE = :eventType)
       WHEN MATCHED THEN UPDATE SET
         CHANNEL         = :channel,
         SUBJECT         = :subject,
         BODY            = :body,
         ACTIVE          = :active,
         RECIPIENT       = :recipient,
         CTA_LABEL       = :ctaLabel,
         CTA_URL_VAR     = :ctaUrlVar,
         ANTIFRAUDE_TYPE = :antifraudeType,
         RESEND_ALLOWED  = :resendAllowed,
         RESEND_AFTER_H  = :resendAfterH,
         MAX_RESENDS     = :maxResends,
         SEND_HOUR_START = :sendHourStart,
         SEND_HOUR_END   = :sendHourEnd
       WHEN NOT MATCHED THEN INSERT
         (ID, EVENT_TYPE, CHANNEL, SUBJECT, BODY, ACTIVE, RECIPIENT,
          CTA_LABEL, CTA_URL_VAR, ANTIFRAUDE_TYPE,
          RESEND_ALLOWED, RESEND_AFTER_H, MAX_RESENDS,
          SEND_HOUR_START, SEND_HOUR_END)
       VALUES
         (:id, :eventType, :channel, :subject, :body, :active, :recipient,
          :ctaLabel, :ctaUrlVar, :antifraudeType,
          :resendAllowed, :resendAfterH, :maxResends,
          :sendHourStart, :sendHourEnd)`,
      {
        id,
        eventType:      input.eventType,
        channel:        input.channel,
        subject:        input.subject        ?? null,
        body:           input.body,
        active:         input.active ? 1 : 0,
        recipient,
        ctaLabel:       input.ctaLabel       ?? null,
        ctaUrlVar:      input.ctaUrlVar      ?? null,
        antifraudeType: input.antifraudeType ?? null,
        resendAllowed:  input.resendAllowed  ?? 0,
        resendAfterH:   input.resendAfterH   ?? null,
        maxResends:     input.maxResends     ?? 0,
        sendHourStart:  input.sendHourStart  ?? 8,
        sendHourEnd:    input.sendHourEnd    ?? 21,
      },
    );

    await this.audit.log({
      actorUserId: input.userId,
      action: "MESSAGE_TEMPLATE_SAVED",
      entityType: "message_template",
      entityId: input.eventType,
      previous,
      next: input,
      justification: "Configuração de régua de mensagem por fase",
    });

    return { id, eventType: input.eventType };
  }
}
