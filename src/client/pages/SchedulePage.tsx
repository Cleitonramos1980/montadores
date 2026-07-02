import { useEffect, useState } from "react";
import { EmptyState, LoadingState, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

export function SchedulePage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState("");
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<any[]>("/orders?limit=200")
      .then(setOrders)
      .catch((err) => toast((err as Error).message, "error"))
      .finally(() => setLoadingOrders(false));
  }, []);

  async function loadSlots(orderId: string) {
    if (!orderId) { setSlots([]); setSelectedOrder(""); return; }
    setSelectedOrder(orderId);
    setLoadingSlots(true);
    try {
      const data = await api<any[]>(`/orders/${orderId}/slots`);
      setSlots(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function schedule(slot: any) {
    try {
      await api(`/orders/${selectedOrder}/schedule`, {
        method: "POST",
        body: JSON.stringify({ providerId: slot.providerId, date: slot.date, period: slot.period }),
      });
      toast("Montagem agendada e registrada na timeline.");
      setSlots([]);
      setSelectedOrder("");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const withAssembly = orders.filter((o) => o.has_assembly);

  return (
    <Page
      title="Agenda Inteligente"
      subtitle="Horários disponíveis consideram apenas montadores aprovados, ativos e documentados"
    >
      {loadingOrders ? (
        <LoadingState message="Carregando pedidos..." />
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", maxWidth: 420 }}>
              Pedido com montagem
              <select
                value={selectedOrder}
                onChange={(e) => loadSlots(e.target.value)}
                style={{ minWidth: 300 }}
              >
                <option value="">Selecione um pedido</option>
                {withAssembly.map((order) => (
                  <option value={order.id} key={order.id}>
                    {order.numped} — {order.customer_name} ({order.city})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingSlots && <LoadingState message="Buscando disponibilidade..." />}

          {!loadingSlots && selectedOrder && slots.length === 0 && (
            <EmptyState
              title="Sem horários disponíveis"
              description="Não há montadores aprovados com disponibilidade para este pedido."
            />
          )}

          {!loadingSlots && slots.length > 0 && (
            <>
              <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 12 }}>
                {slots.length} horários disponíveis — clique para agendar:
              </p>
              <div className="slotGrid">
                {slots.map((slot) => (
                  <button
                    className="slot"
                    key={`${slot.providerId}-${slot.date}-${slot.period}`}
                    onClick={() => schedule(slot)}
                  >
                    <strong>{new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</strong>
                    <span>{slot.period === "MANHA" ? "🌅 Manhã" : "🌇 Tarde"}</span>
                    <small>{slot.providerName}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {!selectedOrder && (
            <EmptyState
              title="Selecione um pedido"
              description="Escolha um pedido com montagem para ver os horários disponíveis."
            />
          )}
        </>
      )}
    </Page>
  );
}
