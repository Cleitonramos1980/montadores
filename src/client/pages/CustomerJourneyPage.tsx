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

type Branding = {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportPhone: string | null;
};

const DEFAULT_BRANDING: Branding = { companyName: "App Montadores", logoUrl: null, primaryColor: "#2e7d32", supportPhone: null };

export function CustomerJourneyPage({ token }: { token: string }) {
  const [order, setOrder] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const toast = useToast();

  const [showHelp, setShowHelp] = useState(false);
  const [helpReason, setHelpReason] = useState("");
  const [helpDesc, setHelpDesc] = useState("");

  const [showSchedule, setShowSchedule] = useState(false);
  const [slots, setSlots] = useState<any[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api<any>(`/public/journey/${token}`).then(setOrder).catch((err) => setError(err.message)),
      api<Branding>("/public/branding").then(setBranding).catch(() => {}),
    ]).finally(() => setLoading(false));
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
        <span className="publicBrand">{branding.companyName}</span>
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

  const scheduledEvent = order?.timeline?.find((t: any) =>
    (t.event_type ?? t.type ?? "").toUpperCase() === "MONTAGEM_AGENDADA",
  );
  const scheduledDate = scheduledEvent?.metadata?.date ?? scheduledEvent?.date ?? null;

  const nextStepMsg: string | null = !hasAssembly ? null
    : currentStep < 3 ? "Aguardamos a confirmação da entrega para agendar a montagem."
    : currentStep === 3 ? "Seu produto foi entregue! Agende agora a montagem."
    : currentStep === 4 ? scheduledDate ? `Montagem agendada para ${new Date(scheduledDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.` : "Montagem agendada — aguarde o contato da equipe."
    : null;

  return (
    <main className="publicPage" style={{ "--brand": branding.primaryColor } as React.CSSProperties}>
      <section className="publicHeader">
        {branding.logoUrl
          ? <img src={branding.logoUrl} alt={branding.companyName} style={{ height: 40, objectFit: "contain", marginBottom: 8, display: "block" }} />
          : <span className="publicBrand" style={{ color: branding.primaryColor }}>{branding.companyName}</span>
        }
        <h1>Pedido {order.numped}</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 8 }}>{order.customer_name}</p>
        <StatusBadge value={order.current_status} />
      </section>

      {/* Next step callout */}
      {nextStepMsg && (
        <div style={{
          background: currentStep === 3 ? "var(--brand)" : "var(--bg-secondary)",
          color: currentStep === 3 ? "#fff" : "var(--text)",
          borderRadius: 12, padding: "14px 18px", marginBottom: 16,
          fontSize: 15, fontWeight: 500, lineHeight: 1.4,
          border: currentStep !== 3 ? "1px solid var(--border)" : "none",
        }}>
          {currentStep === 3 ? "🎉 " : "ℹ️ "}{nextStepMsg}
        </div>
      )}

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

      {/* Main actions — above timeline for mobile scanability */}
      {!showSchedule && !showHelp && (
        <section className="panel spacedPanel actionsBig">
          {hasAssembly && currentStep === 3 && (
            <ActionButton onClick={loadSlots} loadingLabel="Buscando horários...">
              📅 Agendar minha montagem
            </ActionButton>
          )}
          {hasAssembly && currentStep > 3 && currentStep < 5 && !alreadyReviewed && (
            <ActionButton onClick={loadSlots} loadingLabel="Buscando horários..." className="ghostButton">
              📅 Remarcar montagem
            </ActionButton>
          )}
          {hasAssembly && !alreadyReviewed && currentStep >= 5 && (
            <a className="ghostButton" href={`/montadores/avaliacao/${token}`} style={{ justifyContent: "center", minHeight: 50, fontSize: 16 }}>
              ⭐ Avaliar minha montagem
            </a>
          )}
          {alreadyReviewed && (
            <div className="badge badge--aprovado" style={{ textAlign: "center", padding: "14px", fontSize: 14, borderRadius: 10 }}>
              ✓ Avaliação enviada — Obrigado pelo seu feedback!
            </div>
          )}
          <button className="dangerButton" style={{ fontSize: 16, minHeight: 52 }} onClick={() => setShowHelp(true)}>
            ✋ Preciso de ajuda
          </button>
        </section>
      )}

      {/* Timeline */}
      <section className="panel spacedPanel">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Histórico do pedido</h2>
        <div className="timeline">
          {order.timeline?.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nenhum evento registrado ainda.</p>}
          {order.timeline?.map((item: any) => (
            <div className="timelineItem" key={item.id}>
              <span />
              <div>
                <strong style={{ fontSize: 14 }}>{item.title}</strong>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" }}>{item.description}</p>
                <small style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(item.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Products */}
      {order.items?.length > 0 && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Seus produtos</h2>
          {order.items.map((item: any) => (
            <div key={item.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0", borderBottom: "1px solid var(--border)",
            }}>
              <span style={{ fontSize: 14 }}><strong>{item.quantity}x</strong> {item.description}</span>
              {item.requires_assembly && <span className="badge badge--em-analise" style={{ whiteSpace: "nowrap", marginLeft: 8 }}>Montagem</span>}
            </div>
          ))}
        </section>
      )}

      {/* Schedule panel */}
      {showSchedule && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 16 }}>Escolha um horário</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 14 }}>Selecione o dia e período de sua preferência:</p>
          {slotsLoading && <LoadingState message="Buscando disponibilidade..." />}
          {!slotsLoading && slots.length === 0 && (
            <p style={{ color: "var(--text-muted)", padding: "12px 0" }}>
              Nenhum horário disponível no momento. Entre em contato com a loja.
            </p>
          )}
          <div className="slotGrid">
            {slots.map((slot) => (
              <button
                key={`${slot.providerId}-${slot.date}-${slot.period}`}
                className="slot"
                style={{ minHeight: 80, fontSize: 15 }}
                onClick={() => scheduleSlot(slot)}
              >
                <strong style={{ fontSize: 16 }}>
                  {new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                </strong>
                <span style={{ fontSize: 15 }}>{slot.period === "MANHA" ? "🌅 Manhã" : "🌇 Tarde"}</span>
                <small style={{ fontSize: 12, color: "var(--text-muted)" }}>{slot.providerName}</small>
              </button>
            ))}
          </div>
          <div className="actionsBig">
            <button className="ghostButton" style={{ minHeight: 50, fontSize: 16 }} onClick={() => setShowSchedule(false)}>← Voltar</button>
          </div>
        </section>
      )}

      {/* Help panel */}
      {showHelp && (
        <section className="panel spacedPanel">
          <h2 style={{ fontSize: 16 }}>Preciso de ajuda</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>
            Descreva o que está acontecendo e nossa equipe entrará em contato em breve.
          </p>
          <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 14 }}>
            Qual é o problema?
            <input
              value={helpReason}
              onChange={(e) => setHelpReason(e.target.value)}
              placeholder="Ex: Produto com defeito, montagem incorreta..."
              style={{ fontSize: 16 }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 18 }}>
            Detalhe o que aconteceu
            <textarea
              value={helpDesc}
              onChange={(e) => setHelpDesc(e.target.value)}
              placeholder="Quanto mais detalhes, mais rápido poderemos ajudar."
              style={{ fontSize: 16, minHeight: 120 }}
            />
          </label>
          <div className="actionsBig">
            <ActionButton
              onClick={submitHelp}
              className="dangerButton"
              disabled={!helpReason.trim() || !helpDesc.trim()}
              loadingLabel="Enviando..."
            >
              Enviar solicitação
            </ActionButton>
            <button className="ghostButton" style={{ minHeight: 52, fontSize: 16 }} onClick={() => setShowHelp(false)}>Cancelar</button>
          </div>
        </section>
      )}
      {/* Footer com telefone de suporte */}
      {branding.supportPhone && (
        <section style={{ marginTop: 24, textAlign: "center", padding: "16px 0", borderTop: "1px solid var(--border)" }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Precisa de ajuda? Ligue para{" "}
            <a href={`tel:${branding.supportPhone.replace(/\D/g, "")}`} style={{ color: branding.primaryColor, fontWeight: 700 }}>
              {branding.supportPhone}
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
