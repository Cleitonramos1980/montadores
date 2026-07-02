import { v4 as uuid } from "uuid";
import type { EventType } from "../../shared/domain";
import { execDml, queryOne } from "../db/db";
import { json } from "../db/database";
import { AuditService } from "./AuditService";
import { AppEventMessageService } from "./AppEventMessageService";

const timelineTitle: Partial<Record<EventType, string>> = {
  // Pedido
  PEDIDO_CRIADO:              "Pedido recebido",
  PEDIDO_SINCRONIZADO:        "Pedido sincronizado",
  PEDIDO_PAGAMENTO_APROVADO:  "Pagamento aprovado",
  PEDIDO_PAGAMENTO_RECUSADO:  "Pagamento não autorizado",
  PEDIDO_CANCELADO_PAGAMENTO: "Pedido cancelado — pagamento",
  // Separação / faturamento
  SEPARACAO_INICIADA:         "Pedido em separação",
  CONFERENCIA_FINALIZADA:     "Pedido conferido",
  FATURADO:                   "Pedido faturado",
  // Entrega
  SAIU_PARA_ENTREGA:           "Saiu para entrega",
  PEDIDO_EM_ROTA:              "Pedido em rota",
  ENTREGA_REALIZADA:           "Pedido entregue",
  TENTATIVA_ENTREGA_FRUSTRADA: "Tentativa de entrega frustrada",
  ENTREGA_REAGENDADA:          "Entrega reagendada",
  // Avaliações de atendimento/entrega
  ATENDIMENTO_AVALIACAO_ENVIADA: "Avaliação de atendimento enviada",
  ATENDIMENTO_AVALIADO:          "Atendimento avaliado",
  ENTREGA_AVALIADA:              "Entrega avaliada",
  // Montagem
  MONTAGEM_NECESSARIA:           "Montagem necessária",
  LINK_AGENDAMENTO_ENVIADO:      "Link de agendamento enviado",
  MONTAGEM_AGENDADA:             "Montagem agendada",
  LEMBRETE_MONTAGEM_24H:         "Lembrete de montagem (24h)",
  LEMBRETE_MONTAGEM_DIA:         "Lembrete de montagem (dia)",
  MONTADOR_CHEGOU:               "Montador chegou",
  MONTAGEM_INICIADA:             "Montagem iniciada",
  MONTAGEM_FINALIZADA:           "Montagem finalizada",
  FOTOS_MONTAGEM_ANEXADAS:       "Fotos anexadas",
  LINK_AVALIACAO_MONTAGEM_ENVIADO: "Link de avaliação de montagem enviado",
  AVALIACAO_CLIENTE_RECEBIDA:    "Avaliação recebida",
  MONTAGEM_APROVADA_CLIENTE:     "Montagem aprovada pelo cliente",
  MONTAGEM_REPROVADA_CLIENTE:    "Montagem reprovada pelo cliente",
  MONTAGEM_REAGENDADA_SAC:       "Montagem reagendada pelo SAC",
  // SAC
  RECLAMACAO_CLIENTE_ABERTA:     "Reclamação aberta",
  SAC_CASO_ABERTO:               "Caso SAC aberto",
  SAC_RESPONSAVEL_ATRIBUIDO:     "Responsável atribuído ao SAC",
  SAC_EM_ANALISE:                "SAC em análise",
  SAC_SOLICITOU_INFO:            "SAC solicitou informações",
  SAC_APROVOU_LIBERACAO:         "SAC aprovou liberação",
  SAC_REPROVOU_LIBERACAO:        "SAC reprovou liberação",
  SAC_ENCERROU_CASO:             "SAC encerrou o caso",
  JORNADA_ENCERRADA:             "Jornada encerrada",
  // Montador / fornecedor
  MONTADOR_NOTIFICADO:           "Montador notificado",
  MONTADOR_LEMBRETE_DIA:         "Lembrete do dia (montador)",
  MONTADOR_SERVICO_REAGENDADO:   "Serviço reagendado (montador)",
  MONTADOR_SERVICO_CANCELADO:    "Serviço cancelado (montador)",
  MONTADOR_CLIENTE_ALTEROU:      "Cliente alterou agendamento",
  MONTADOR_FOTOS_PENDENTES:      "Fotos pendentes (montador)",
  MONTADOR_MONTAGEM_FINALIZADA:  "Montagem finalizada (montador)",
  MONTADOR_MONTAGEM_REPROVADA:   "Montagem reprovada (notificação montador)",
  MONTADOR_SAC_ANALISE:          "SAC em análise (notificação montador)",
  // Pagamentos
  PAGAMENTO_AGUARDANDO_APROVACAO: "Pagamento aguardando aprovação",
  PAGAMENTO_BLOQUEADO:            "Pagamento bloqueado",
  PAGAMENTO_LIBERADO:             "Pagamento liberado",
  PAGAMENTO_ENVIADO_FINANCEIRO:   "Pagamento enviado ao financeiro",
  PAGAMENTO_PROGRAMADO:           "Pagamento programado",
  PAGAMENTO_REALIZADO:            "Pagamento realizado",
  // Erros
  INTEGRACAO_WINTHOR_ERRO: "Falha na integração WinThor",
  MENSAGEM_ERRO_ENVIO:     "Falha no envio de mensagem",
};

export class EventService {
  constructor(
    private readonly audit = new AuditService(),
    private readonly appMessages = new AppEventMessageService(),
  ) {}

  async emit(input: {
    type: EventType;
    orderId?: string;
    numped: string;
    codcli?: string;
    assemblyId?: string;
    providerId?: string;
    paymentId?: string;
    previousStatus?: string;
    newStatus?: string;
    origin: "WINTHOR" | "SISTEMA" | "CLIENTE" | "MONTADOR" | "SAC" | "FINANCEIRO" | "ADMIN" | "JOB";
    metadata?: Record<string, unknown>;
    userId?: string;
    idempotencyKey: string;
    ip?: string;
    userAgent?: string;
    audit?: boolean;
  }) {
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_ORDER_EVENTS WHERE IDEMPOTENCY_KEY = :key",
      { key: input.idempotencyKey },
    );
    if (existing) return existing.id;

    const id = uuid();
    await execDml(
      `INSERT INTO MONT_ORDER_EVENTS
       (ID, TYPE, NUMPED, CODCLI, ASSEMBLY_ID, PROVIDER_ID, PAYMENT_ID, PREVIOUS_STATUS, NEW_STATUS, ORIGIN,
        METADATA_JSON, USER_ID, IP, USER_AGENT, IDEMPOTENCY_KEY)
       VALUES (:id, :type, :numped, :codcli, :assemblyId, :providerId, :paymentId, :previousStatus, :newStatus, :origin,
               :metadataJson, :userId, :ip, :userAgent, :idempotencyKey)`,
      {
        id,
        type: input.type,
        numped: input.numped,
        codcli: input.codcli ?? null,
        assemblyId: input.assemblyId ?? null,
        providerId: input.providerId ?? null,
        paymentId: input.paymentId ?? null,
        previousStatus: input.previousStatus ?? null,
        newStatus: input.newStatus ?? null,
        origin: input.origin,
        metadataJson: json(input.metadata ?? {}),
        userId: input.userId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    );

    if (input.orderId) {
      await execDml(
        `INSERT INTO MONT_ORDER_TIMELINE (ID, ORDER_ID, EVENT_ID, TITLE, DESCRIPTION, VISIBLE_TO_CUSTOMER)
         VALUES (:id, :orderId, :eventId, :title, :description, :visible)`,
        {
          id: uuid(),
          orderId: input.orderId,
          eventId: id,
          title: timelineTitle[input.type] ?? input.type,
          description: String(input.metadata?.description ?? `Evento ${input.type}`),
          visible: input.metadata?.visibleToCustomer === false ? 0 : 1,
        },
      );
    }

    if (input.audit ?? true) {
      await this.audit.log({
        actorUserId: input.userId,
        action: input.type,
        entityType: "order_event",
        entityId: id,
        next: input,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }

    // Ponto único de despacho de mensagens: todo evento de domínio passa pelo
    // MessageTriggerService (via AppEventMessageService), que aplica modo global,
    // config do evento, idempotência, opt-out e janela de horário. Eventos cujas
    // mensagens já são tratadas por outro caminho estão na SKIP list da ponte.
    // Falha no gatilho de mensagem nunca derruba a emissão do evento.
    try {
      await this.appMessages.handleDomainEvent({
        type:    input.type,
        eventId: id,
        numped:  input.numped,
        codcli:  input.codcli ?? "",
      });
    } catch (err) {
      console.error(`[EventService] Gatilho de mensagem falhou para ${input.type}/${input.numped}:`, (err as Error).message);
    }

    return id;
  }
}
