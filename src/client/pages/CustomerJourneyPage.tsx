import { useEffect, useState } from "react";
import { ActionButton, LoadingState, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const JOURNEY_STEPS = [
  { key: "PEDIDO_CRIADO", label: "Pedido\nrecebido" },
  { key: "FATURADO", label: "Faturado" },
  { key: "SAIU_PARA_ENTREGA", label: "Saiu para\nentrega" },
  { key: "ENTREGA_REALIZADA", label: "Entregue" },
  { key: "MONTAGEM_AGENDADA", label: "Montagem\nagendada" },
  { key: "MONTAGEM_FINALIZADA", label: "Montagem\nconcluída" },
];

function getStepIndex(timeline: any[]) {
  const eventTypes = new Set(
    (timeline ?? []).map((t: any) => (t.event_type ?? t.type ?? "").toUpperCase()),
  );
  for (let i = JOURNEY_STEPS.length - 1; i >= 0; i--) {
    if (eventTypes.has(JOURNEY_STEPS[i].key)) return i;
  }
  return 0;
}

export function CustomerJourneyPage({ token }: { token: string }) {
  const [order, setOrder] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  const [showHelp, setShowHelp] = useState(false);
  const [helpReason, setHelpReason] = useState("");
  const [helpDesc, setHelpDesc] = useState("");

  const [showSchedule, setShowSchedule] = useState(false);
  const [slots, setSlots] = useState<any[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    api<any>(`/public/journey/${token}`)
      .then(setOrder)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function loadSlots() {
    setSlotsLoading(true);
    try {
      const data = await api<any[]>(`/public/slots/${token}`);
      setSlots(data);
      setShowSchedule(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function scheduleSlot(slot: any) {
    try {
      await api(`/public/schedule/${token}`, {
        method: "POST",
        body: JSON.stringify({ providerId: slot.providerId, date: slot.date, period: slot.period }),
      });
      toast(`Montagem agendada para ${slot.date} (${slot.period === "MANHA" ? "Manhã" : "Tarde"})!`);
      setShowSchedule(false);
      const updated = await api<any>(`/public/journey/${token}`);
      setOrder(updated);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function submitHelp() {
    if (!helpReason.trim() || !helpDesc.trim()) return;
    try {
      await api(`/public/sac/${token}`, {
        method: "POST",
        body: JSON.stringify({ reason: helpReason, description: helpDesc }),
      });
      toast("Solicitação enviada. Nossa equipe entrará em contato em breve.");
      setShowHelp(false);
      setHelpReason("");
      setHelpDesc("");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  if (loading) return <main className="publicPage"><LoadingState message="Carregando seu pedido..." /></main>;

  if (error) return (
    <main className="publicPage">
      <section className="publicHeader">
        <span className="publicBrand">App Montadores</span>
        <h1>Ops!</h1>
        <p>{error.includes("expirado") ? "Seu link de acompanhamento expirou." : error.includes("localizado") ? "Link não encontrado." : "Não foi possível carregar seu pedido."}</p>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>
          {error.includes("expirado") ? "Solicite um novo link à empresa." : "Verifique o link recebido ou entre em contato com a empresa."}
        </p>
      </section>
    </main>
  );

  const hasAssembly = order?.has_assembly === 1 || order?.has_assembly === true;
  const alreadyReviewed = order?.reviews?.some((r: any) => r.service_type === "MONTAGEM");
  const currentStep = getStepIndex(order?.timeline ?? []);

  return (
    <main className="publicPage">
      <section className="publicHeader">
        <span className="publicBrand">App Montadores</span>
        <h1>Pedido {order.numped}</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 8 }}>{order.customer_name}</p>
        <StatusBadge value={order.current_status} />
      </section>

      {/* Step progress */}
      <div className="stepProgress">
        {JOURNEY_STEPS.map((step, i) => (
          <div
            key={step.key}
            className={`step${i < currentStep ? " done" : i === currentStep ? " current" : ""}`}
          >
            <div className="stepDot">{i < currentStep ? "✓" : i + 1}</div>
            <span className="stepLabel">{step.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <section className="panel">
        <h2 style={{ fontSize: 16 }}>Histórico do pedido</h2>
        <div className="timeline">
          {order.timeline?.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nenhum evento registrado ainda.</p>}
          {order.timeline?.map((item: any) => (
            <div className="timelineItem" key={item.id}>
              <span />
              <div>
                <strong style={{ fontSize: 15 }}>{item.title}</strong>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "2px 0 0" }}>{item.description}</p>
                <small style={{ fontSize: 12 }}>{new Date(item.created_at).toLocaleString("pt-BR")}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Products */}
      {order.items?.length > 0 && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 16 }}>Seus produtos</h2>
          {order.items.map((item: any) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span><strong>{item.quantity}x</strong> {item.description}</span>
              {item.requires_assembly && <span className="badge badge--em-analise">Montagem</span>}
            </div>
          ))}
        </section>
      )}

      {/* Main actions */}
      {!showSchedule && !showHelp && (
        <section className="panel spacedPanel actionsBig">
          {hasAssembly && (
            <ActionButton onClick={loadSlots} loadingLabel="Buscando horários...">
              📅 Agendar montagem
            </ActionButton>
          )}
          {hasAssembly && !alreadyReviewed && (
            <a className="ghostButton" href={`/montadores/avaliacao/${token}`} style={{ justifyContent: "center", minHeight: 50, fontSize: 16 }}>
              ⭐ Avaliar montagem
            </a>
          )}
          {alreadyReviewed && <div className="badge badge--aprovado" style={{ textAlign: "center", padding: "12px", fontSize: 14 }}>✓ Montagem avaliada — Obrigado!</div>}
          <button className="dangerButton" style={{ fontSize: 16, minHeight: 50 }} onClick={() => setShowHelp(true)}>
            ✋ Preciso de ajuda
          </button>
        </section>
      )}

      {/* Schedule panel */}
      {showSchedule && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 16 }}>Escolha um horário</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Selecione o dia e período de sua preferência:</p>
          {slotsLoading && <LoadingState message="Buscando disponibilidade..." />}
          {!slotsLoading && slots.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nenhum horário disponível no momento. Entre em contato.</p>}
          <div className="slotGrid">
            {slots.map((slot) => (
              <button
                key={`${slot.providerId}-${slot.date}-${slot.period}`}
                className="slot"
                onClick={() => scheduleSlot(slot)}
              >
                <strong>{new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</strong>
                <span>{slot.period === "MANHA" ? "🌅 Manhã" : "🌇 Tarde"}</span>
                <small>{slot.providerName}</small>
              </button>
            ))}
          </div>
          <div className="actionsBig">
            <button className="ghostButton" onClick={() => setShowSchedule(false)}>Voltar</button>
          </div>
        </section>
      )}

      {/* Help panel */}
      {showHelp && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 16 }}>Preciso de ajuda</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>Descreva o que está acontecendo e nossa equipe entrará em contato.</p>
          <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 12 }}>
            Qual é o problema?
            <input
              value={helpReason}
              onChange={(e) => setHelpReason(e.target.value)}
              placeholder="Ex: Produto com defeito, montagem incorreta..."
              style={{ fontSize: 16 }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
            Detalhe o que aconteceu
            <textarea
              value={helpDesc}
              onChange={(e) => setHelpDesc(e.target.value)}
              placeholder="Quanto mais detalhes, mais rápido poderemos ajudar."
              style={{ fontSize: 16, minHeight: 100 }}
            />
          </label>
          <div className="actionsBig">
            <ActionButton
              onClick={submitHelp}
              className="dangerButton"
              disabled={!helpReason.trim() || !helpDesc.trim()}
              loadingLabel="Enviando..."
            >
              Enviar solicitação de ajuda
            </ActionButton>
            <button className="ghostButton" style={{ minHeight: 50, fontSize: 16 }} onClick={() => setShowHelp(false)}>Cancelar</button>
          </div>
        </section>
      )}
    </main>
  );
}
