import type { EventType } from "../../shared/domain";
import { OrderSnapshotService } from "./OrderSnapshotService";
import { MessageTriggerService } from "./MessageTriggerService";

// Events that must NOT trigger a message here, either because they are
// internal/observability-only or because their message is already dispatched
// by another path (fluxo phase transitions → PedidoFluxoSyncService;
// ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM → AgendaEntregaService;
// LEMBRETE_AGENDAR_MONTAGEM → MessageSchedulerService — both outside EventType).
// Everything else flows through MessageTriggerService via this bridge, which is
// invoked automatically by EventService.emit().
const SKIP_MESSAGE_TRIGGER = new Set<EventType>([
  "ORDER_ELIGIBILITY_CHECKED",
  "ASSEMBLY_ITEM_CREATED",
  "COMMISSION_CALCULATED",
  "PAYMENT_RECALCULATED",
  "REWORK_CREATED",
  "REWORK_CLASSIFIED",
  "REWORK_RESOLVED",
  "PIX_PAYMENT_REQUESTED",
  "PIX_PAYMENT_CONFIRMED",
  "PIX_PAYMENT_FAILED",
  "OFFLINE_SYNC_COMPLETED",
  "INTEGRACAO_WINTHOR_ERRO",
  "MENSAGEM_ERRO_ENVIO",
  "PEDIDO_SINCRONIZADO",
  // Fluxo transitions are handled directly by PedidoFluxoSyncService
  "SEPARACAO_INICIADA",
  "CONFERENCIA_FINALIZADA",
  "FATURADO",
  "SAIU_PARA_ENTREGA",
  "ENTREGA_REALIZADA",
]);

export class AppEventMessageService {
  constructor(
    private readonly snapshots = new OrderSnapshotService(),
    private readonly trigger   = new MessageTriggerService(),
  ) {}

  async handleDomainEvent(params: {
    type: EventType;
    eventId: string;
    numped: string;
    codcli: string;
  }): Promise<void> {
    if (SKIP_MESSAGE_TRIGGER.has(params.type)) return;

    const snapshot = await this.snapshots.findByNumped(params.numped);
    if (!snapshot) return;

    await this.trigger.process(
      {
        id:                params.eventId,
        numped:            params.numped,
        codcli:            params.codcli,
        eventKey:          params.type,
        fluxoEventKeyNovo: params.type,
      },
      snapshot,
    );
  }
}
