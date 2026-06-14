import { useEffect, useState } from "react";
import { LoadingState, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const JOURNEY_STEPS = [
  { key: "PEDIDO_CRIADO",       label: "Pedido\nrecebido" },
  { key: "FATURADO",            label: "Faturado" },
  { key: "SAIU_PARA_ENTREGA",   label: "Saiu para\nentrega" },
  { key: "ENTREGA_REALIZADA",   label: "Entregue" },
  { key: "MONTAGEM_AGENDADA",   label: "Montagem\nagendada" },
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

const DEFAULT_BRANDING: Branding = {
  companyName: "Rodrigues Colchões",
  logoUrl: "/logo-rodrigues.svg",
  primaryColor: "#1F2855",
  supportPhone: null,
};

// Design tokens — Rodrigues Colchões identity
const C = {
  primary:   "#1F2855",
  action:    "#3563AD",
  white:     "#FFFFFF",
  bg:        "#F7F9FC",
  border:    "#E2E8F0",
  textMuted: "#64748B",
  textSec:   "#475569",
};

// Mazzard with system-ui fallback; drop font files in public/fonts/mazzard/ when available
const FONT = "'Mazzard', Arial, system-ui, -apple-system, sans-serif";

function CjBtn({
  children, onClick, variant = "primary", disabled = false, fullWidth = true,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const base: React.CSSProperties = {
    fontFamily: FONT, fontWeight: 700, fontSize: 16,
    border: "none", borderRadius: 14, minHeight: 52,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    width: fullWidth ? "100%" : "auto",
    transition: "opacity .15s",
    textDecoration: "none",
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: { ...base, background: C.action, color: C.white, boxShadow: "0 4px 16px rgba(53,99,173,.30)" },
    outline: { ...base, background: "transparent", color: C.action, border: `2px solid ${C.action}`, minHeight: 50 },
    ghost:   { ...base, background: C.white, color: C.primary, border: `1.5px solid ${C.border}`, boxShadow: "0 2px 6px rgba(31,40,85,.06)", fontWeight: 600, fontSize: 15 },
  };
  return <button style={styles[variant]} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function CustomerJourneyPage({ token }: { token: string }) {
  const [order, setOrder] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const toast = useToast();

  const [showHelp, setShowHelp] = useState(false);
  const [helpReason, setHelpReason] = useState("");
  const [helpDesc, setHelpDesc] = useState("");
  const [submittingHelp, setSubmittingHelp] = useState(false);

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
    setSubmittingHelp(true);
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
    } finally {
      setSubmittingHelp(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
        <header style={{ background: C.primary, padding: "24px 20px" }}>
          <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <p style={{ color: "rgba(255,255,255,.65)", fontSize: 12, margin: 0, letterSpacing: "1.5px", textTransform: "uppercase" }}>
              Jornada Pós-venda
            </p>
          </div>
        </header>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingState message="Carregando seu pedido..." />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    const isExpired = error.includes("expirado");
    const isNotFound = error.includes("localizado");
    return (
      <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
        <header style={{ background: C.primary, padding: "28px 20px 36px" }}>
          <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 6 }}>{branding.companyName}</div>
            <p style={{ color: "rgba(255,255,255,.65)", fontSize: 12, margin: 0, letterSpacing: "1.5px", textTransform: "uppercase" }}>
              Jornada Pós-venda
            </p>
          </div>
        </header>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div style={{
            background: C.white, borderRadius: 20, padding: "32px 24px",
            maxWidth: 380, width: "100%", textAlign: "center",
            boxShadow: "0 4px 24px rgba(31,40,85,.10)", marginTop: -20,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "#FEF2F2", display: "flex", alignItems: "center",
              justifyContent: "center", margin: "0 auto 16px", fontSize: 24,
            }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.primary, margin: "0 0 8px" }}>
              {isExpired ? "Link expirado" : isNotFound ? "Link não encontrado" : "Algo deu errado"}
            </h2>
            <p style={{ fontSize: 14, color: C.textSec, margin: "0 0 4px" }}>
              {isExpired ? "Seu link de acompanhamento expirou." : isNotFound ? "Não encontramos este pedido." : "Não foi possível carregar seu pedido."}
            </p>
            <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
              {isExpired ? "Solicite um novo link à empresa." : "Verifique o link recebido ou entre em contato com a empresa."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  const hasAssembly     = order?.has_assembly === 1 || order?.has_assembly === true;
  const alreadyReviewed = order?.reviews?.some((r: any) => r.service_type === "MONTAGEM");
  const currentStep     = getStepIndex(order?.timeline ?? []);
  const timelineItems   = order?.timeline ?? [];

  // Steps 5 e 6 (Montagem agendada / concluída) só aparecem se o pedido tem montagem
  const visibleSteps = hasAssembly ? JOURNEY_STEPS : JOURNEY_STEPS.slice(0, 4);
  const displayStep  = Math.min(currentStep, visibleSteps.length - 1);
  const stepFraction = visibleSteps.length > 1 ? displayStep / (visibleSteps.length - 1) : 1;

  const scheduledEvent = timelineItems.find((t: any) =>
    (t.event_type ?? t.type ?? "").toUpperCase() === "MONTAGEM_AGENDADA",
  );
  const scheduledDate = scheduledEvent?.metadata?.date ?? scheduledEvent?.date ?? null;

  const nextStepMsg: string | null = !hasAssembly ? null
    : currentStep < 3 ? "Aguardamos a confirmação da entrega para agendar a montagem."
    : currentStep === 3 ? "Seu produto foi entregue! Agende agora a montagem."
    : currentStep === 4 ? scheduledDate
      ? `Montagem agendada para ${new Date(scheduledDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.`
      : "Montagem agendada — aguarde o contato da equipe."
    : null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, color: C.primary }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header style={{ background: C.primary, padding: "28px 20px 40px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.companyName}
              style={{ height: 44, objectFit: "contain", display: "block", margin: "0 auto 10px" }}
            />
          ) : (
            <div style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 6, letterSpacing: "-0.3px" }}>
              {branding.companyName}
            </div>
          )}
          <p style={{
            color: "rgba(255,255,255,.6)", fontSize: 11, margin: 0,
            letterSpacing: "2px", textTransform: "uppercase", fontWeight: 500,
          }}>
            Jornada Pós-venda
          </p>
        </div>
      </header>

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>

        {/* Order identity card — overlaps header bottom */}
        <div style={{
          background: C.white, borderRadius: 20, padding: "18px 20px 16px",
          marginTop: -24, marginBottom: 14,
          boxShadow: "0 4px 24px rgba(31,40,85,.14)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.primary, marginBottom: 3, letterSpacing: "-0.2px" }}>
                Pedido #{order.numped}
              </div>
              <div style={{ fontSize: 14, color: C.textSec }}>{order.customer_name}</div>
            </div>
            <StatusBadge value={order.current_status} />
          </div>
        </div>

        {/* Next step CTA */}
        {nextStepMsg && (
          <div style={{
            background: currentStep === 3
              ? `linear-gradient(135deg, ${C.primary} 0%, ${C.action} 100%)`
              : C.white,
            color: currentStep === 3 ? C.white : C.primary,
            borderRadius: 16, padding: "16px 20px", marginBottom: 14,
            fontSize: 15, fontWeight: 500, lineHeight: 1.5,
            border: currentStep !== 3 ? `1px solid ${C.border}` : "none",
            boxShadow: currentStep === 3
              ? "0 4px 20px rgba(53,99,173,.28)"
              : "0 2px 8px rgba(31,40,85,.06)",
          }}>
            <span style={{ marginRight: 8 }}>{currentStep === 3 ? "🎉" : "ℹ️"}</span>
            {nextStepMsg}
          </div>
        )}

        {/* Step progress */}
        <div style={{
          background: C.white, borderRadius: 16,
          padding: "20px 10px 16px", marginBottom: 14,
          boxShadow: "0 2px 8px rgba(31,40,85,.06)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            {/* Connector line */}
            <div style={{
              position: "absolute", top: 13, left: "8%", right: "8%", height: 2, zIndex: 0,
              background: `linear-gradient(to right, ${C.primary} ${stepFraction * 100}%, #E2E8F0 ${stepFraction * 100}%)`,
            }} />
            {visibleSteps.map((step, i) => {
              const isDone    = i < displayStep;
              const isCurrent = i === displayStep;
              return (
                <div key={step.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, position: "relative", zIndex: 1 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isDone ? C.primary : isCurrent ? C.action : "#E2E8F0",
                    color: isDone || isCurrent ? C.white : C.textMuted,
                    fontSize: 11, fontWeight: 700,
                    boxShadow: isCurrent ? `0 0 0 4px rgba(53,99,173,.18)` : "none",
                  }}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <div style={{
                    fontSize: 9, textAlign: "center", marginTop: 5,
                    color: isDone || isCurrent ? C.primary : C.textMuted,
                    fontWeight: isDone || isCurrent ? 600 : 400,
                    lineHeight: 1.25, whiteSpace: "pre-line",
                  }}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main actions */}
        {!showSchedule && !showHelp && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {hasAssembly && currentStep === 3 && (
              <CjBtn onClick={loadSlots} disabled={slotsLoading}>
                {slotsLoading ? "Buscando horários..." : "📅 Agendar minha montagem"}
              </CjBtn>
            )}
            {hasAssembly && currentStep > 3 && currentStep < 5 && !alreadyReviewed && (
              <CjBtn onClick={loadSlots} variant="outline" disabled={slotsLoading}>
                {slotsLoading ? "Buscando horários..." : "📅 Remarcar montagem"}
              </CjBtn>
            )}
            {hasAssembly && !alreadyReviewed && currentStep >= 5 && (
              <a
                href={`/montadores/avaliacao/${token}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: C.action, color: C.white, textDecoration: "none",
                  borderRadius: 14, minHeight: 52, fontSize: 16, fontWeight: 700,
                  boxShadow: "0 4px 16px rgba(53,99,173,.30)",
                }}
              >
                ⭐ Avaliar minha montagem
              </a>
            )}
            {alreadyReviewed && (
              <div style={{
                background: "#F0FDF4", border: "1px solid #BBF7D0",
                color: "#15803D", borderRadius: 14, padding: "14px 20px",
                fontSize: 14, fontWeight: 500, textAlign: "center",
              }}>
                ✓ Avaliação enviada — Obrigado pelo seu feedback!
              </div>
            )}
            <CjBtn onClick={() => setShowHelp(true)} variant="ghost">
              ✋ Preciso de ajuda
            </CjBtn>
          </div>
        )}

        {/* Timeline */}
        <div style={{
          background: C.white, borderRadius: 16, padding: "20px 20px 12px",
          marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)",
        }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "1.5px" }}>
            Histórico do pedido
          </h2>
          {timelineItems.length === 0 && (
            <p style={{ fontSize: 14, color: C.textMuted, margin: 0 }}>Nenhum evento registrado ainda.</p>
          )}
          {timelineItems.map((item: any, idx: number) => {
            const isLatest = idx === timelineItems.length - 1;
            return (
              <div key={item.id} style={{ display: "flex", gap: 14, paddingBottom: 16, position: "relative" }}>
                {/* vertical connector */}
                {idx < timelineItems.length - 1 && (
                  <div style={{
                    position: "absolute", left: 9, top: 22, bottom: 0,
                    width: 2, background: "#E2E8F0", zIndex: 0,
                  }} />
                )}
                {/* dot */}
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                  background: isLatest ? C.action : C.primary,
                  boxShadow: isLatest ? `0 0 0 4px rgba(53,99,173,.14)` : "none",
                  position: "relative", zIndex: 1,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.primary, marginBottom: 2 }}>{item.title}</div>
                  <p style={{ fontSize: 13, color: C.textSec, margin: "0 0 3px" }}>{item.description}</p>
                  <span style={{ fontSize: 11, color: C.textMuted }}>
                    {new Date(item.created_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Products */}
        {order.items?.length > 0 && (
          <div style={{
            background: C.white, borderRadius: 16, padding: "20px 20px 12px",
            marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)",
          }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "1.5px" }}>
              Seus produtos
            </h2>
            {order.items.map((item: any) => (
              <div key={item.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 14, color: C.primary }}>
                  <strong style={{ color: C.action }}>{item.quantity}x</strong>{" "}{item.description}
                </span>
                {item.requires_assembly && (
                  <span style={{
                    background: "#EFF6FF", color: C.action,
                    fontSize: 10, fontWeight: 700,
                    padding: "3px 10px", borderRadius: 20,
                    whiteSpace: "nowrap", marginLeft: 10,
                    border: `1px solid rgba(53,99,173,.20)`,
                  }}>
                    Montagem
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Schedule panel */}
        {showSchedule && (
          <div style={{
            background: C.white, borderRadius: 16, padding: "20px",
            marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)",
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.primary, margin: "0 0 6px" }}>Escolha um horário</h2>
            <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 16px" }}>
              Selecione o dia e período de sua preferência:
            </p>
            {slotsLoading && <LoadingState message="Buscando disponibilidade..." />}
            {!slotsLoading && slots.length === 0 && (
              <p style={{ color: C.textMuted, padding: "12px 0", fontSize: 14 }}>
                Nenhum horário disponível no momento. Entre em contato com a loja.
              </p>
            )}
            {!slotsLoading && slots.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {slots.map((slot) => (
                  <button
                    key={`${slot.providerId}-${slot.date}-${slot.period}`}
                    onClick={() => scheduleSlot(slot)}
                    style={{
                      background: C.bg, border: `2px solid ${C.border}`,
                      borderRadius: 14, padding: "14px 10px", minHeight: 80,
                      cursor: "pointer", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 4,
                      fontFamily: FONT, color: C.primary,
                    }}
                  >
                    <strong style={{ fontSize: 15 }}>
                      {new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", {
                        weekday: "short", day: "2-digit", month: "short",
                      })}
                    </strong>
                    <span style={{ fontSize: 14 }}>{slot.period === "MANHA" ? "🌅 Manhã" : "🌇 Tarde"}</span>
                    <small style={{ fontSize: 11, color: C.textMuted }}>{slot.providerName}</small>
                  </button>
                ))}
              </div>
            )}
            <CjBtn onClick={() => setShowSchedule(false)} variant="ghost">
              ← Voltar
            </CjBtn>
          </div>
        )}

        {/* Help panel */}
        {showHelp && (
          <div style={{
            background: C.white, borderRadius: 16, padding: "20px",
            marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)",
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.primary, margin: "0 0 6px" }}>Preciso de ajuda</h2>
            <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 18px" }}>
              Descreva o que está acontecendo e nossa equipe entrará em contato em breve.
            </p>
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: C.textSec, marginBottom: 14 }}>
              Qual é o problema?
              <input
                value={helpReason}
                onChange={(e) => setHelpReason(e.target.value)}
                placeholder="Ex: Produto com defeito, montagem incorreta..."
                style={{ fontSize: 16 }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: C.textSec, marginBottom: 18 }}>
              Detalhe o que aconteceu
              <textarea
                value={helpDesc}
                onChange={(e) => setHelpDesc(e.target.value)}
                placeholder="Quanto mais detalhes, mais rápido poderemos ajudar."
                style={{ fontSize: 16, minHeight: 120 }}
              />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <CjBtn
                onClick={submitHelp}
                disabled={submittingHelp || !helpReason.trim() || !helpDesc.trim()}
              >
                {submittingHelp ? "Enviando..." : "Enviar solicitação"}
              </CjBtn>
              <CjBtn onClick={() => setShowHelp(false)} variant="ghost">
                Cancelar
              </CjBtn>
            </div>
          </div>
        )}

        {/* Footer */}
        {branding.supportPhone && (
          <div style={{ textAlign: "center", paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>
              Precisa de ajuda? Ligue para{" "}
              <a
                href={`tel:${branding.supportPhone.replace(/\D/g, "")}`}
                style={{ color: C.action, fontWeight: 700, textDecoration: "none" }}
              >
                {branding.supportPhone}
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
