import { useEffect, useMemo, useState } from "react";
import { LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const EVENT_LABELS: Record<string, string> = {
  PEDIDO_CRIADO: "Pedido criado",
  PEDIDO_SINCRONIZADO: "Pedido sincronizado",
  SEPARACAO_INICIADA: "Separação iniciada",
  CONFERENCIA_FINALIZADA: "Conferência finalizada",
  FATURADO: "Faturado",
  SAIU_PARA_ENTREGA: "Saiu para entrega",
  ENTREGA_REALIZADA: "Entrega realizada",
  MONTAGEM_NECESSARIA: "Montagem necessária",
  LINK_AGENDAMENTO_ENVIADO: "Link de agendamento enviado",
  MONTAGEM_AGENDADA: "Montagem agendada",
  MONTAGEM_INICIADA: "Montagem iniciada",
  FOTOS_MONTAGEM_ANEXADAS: "Fotos de montagem anexadas",
  MONTAGEM_FINALIZADA: "Montagem finalizada",
  LINK_AVALIACAO_MONTAGEM_ENVIADO: "Link de avaliação enviado",
  AVALIACAO_CLIENTE_RECEBIDA: "Avaliação recebida",
  SAC_CASO_ABERTO: "SAC — Caso aberto",
  SAC_RESPONSAVEL_ATRIBUIDO: "SAC — Responsável atribuído",
  SAC_ENCERROU_CASO: "SAC — Caso encerrado",
  PAGAMENTO_LIBERADO: "Pagamento liberado",
  PAGAMENTO_REALIZADO: "Pagamento realizado",
  INTEGRACAO_WINTHOR_ERRO: "Erro de integração WinThor",
};

function label(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function FlowRulerPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api<any[]>("/flow-ruler")
      .then((data) => {
        setOrders(data);
        setSelectedId(data[0]?.id ?? "");
      })
      .catch((err) => toast((err as Error).message, "error"))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => orders.find((order) => order.id === selectedId), [orders, selectedId]);

  return (
    <Page title="Régua de Fluxo" subtitle="Histórico visual fase a fase da jornada do pedido">
      {loading ? (
        <LoadingState message="Carregando pedidos..." />
      ) : (
        <>
          <div className="toolbar" style={{ marginBottom: 20 }}>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ minWidth: 280 }}>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>{order.numped} — {order.customer_name}</option>
              ))}
            </select>
            {selected && <a className="ghostButton" href={`/montadores/pedidos/${selected.id}`}>Abrir pedido</a>}
          </div>

          {selected && (
            <>
              <section className="panel spacedPanel">
                <div className="flowHeader">
                  <div>
                    <h2>Pedido {selected.numped}</h2>
                    <p>{selected.customer_name}</p>
                  </div>
                  <StatusBadge value={selected.current_status} />
                </div>
                <div className="ruler">
                  {selected.progress.map((step: any, index: number) => (
                    <div className={`rulerStep ${step.done ? "done" : ""}`} key={step.eventType}>
                      <span>{index + 1}</span>
                      <strong>{label(step.eventType)}</strong>
                      <small>{step.occurredAt ? new Date(step.occurredAt).toLocaleString("pt-BR") : "Pendente"}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel spacedPanel">
                <h2>Histórico do pedido</h2>
                <div className="timeline">
                  {selected.history.map((event: any, index: number) => (
                    <div className="timelineItem" key={`${event.type}-${index}`}>
                      <span />
                      <div>
                        <strong>{event.title ?? label(event.type)}</strong>
                        <p>{event.description ?? `Origem: ${event.origin}`}</p>
                        <small>{new Date(event.created_at).toLocaleString("pt-BR")} · {event.origin}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {orders.length === 0 && (
            <div className="emptyState">
              <strong>Nenhum pedido monitorado</strong>
              <p>Crie um pedido demo no dashboard para ver a régua em ação.</p>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
