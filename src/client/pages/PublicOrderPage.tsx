import { useEffect, useState } from "react";
import { LoadingState } from "../components/Ui";
import { api } from "../lib/api";

// ── Design tokens — idênticos à CustomerJourneyPage ──────────────────────────
const C = {
  primary:   "#1F2855",
  action:    "#3563AD",
  white:     "#FFFFFF",
  bg:        "#F7F9FC",
  border:    "#E2E8F0",
  textMuted: "#64748B",
  textSec:   "#475569",
};
const FONT = "'Mazzard', Arial, system-ui, -apple-system, sans-serif";

// Etapas base — todas as fases operacionais visíveis ao cliente
// Cada etapa aceita múltiplos event_keys para avançar o indicador
const BASE_STEPS = [
  { keys: ["PEDIDO_CRIADO"],                                                  label: "Pedido\nrecebido" },
  { keys: ["AGUARDANDO_MAPA_ESTOQUE", "MAPA_EMITIDO_AGUARDANDO_SEPARACAO"],  label: "Mapa\nemitido" },
  { keys: ["EM_SEPARACAO_CONFERENCIA"],                                        label: "Em\nseparação" },
  { keys: ["CONFERIDO_AGUARDANDO_FATURAMENTO"],                                label: "Conferido" },
  { keys: ["FATURADO_AGUARDANDO_SAIDA"],                                       label: "Faturado" },
  { keys: ["SAIU_PARA_ENTREGA"],                                               label: "Saiu para\nentrega" },
  { keys: ["ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM"],                             label: "Entregue" },
];

// Etapas de montagem — só incluídas se o pedido tiver produtos com montagem
const MONTAGEM_STEPS = [
  { keys: ["MONTAGEM_AGENDADA"],   label: "Montagem\nagendada" },
  { keys: ["MONTAGEM_FINALIZADA"], label: "Montagem\nconcluída" },
];

type JourneyStep = { keys: string[]; label: string };

function buildSteps(hasAssembly: boolean): JourneyStep[] {
  return hasAssembly ? [...BASE_STEPS, ...MONTAGEM_STEPS] : BASE_STEPS;
}

// Mapeamento event_key → título legível para o histórico
const EVENT_TITLE: Record<string, string> = {
  PEDIDO_CRIADO:                          "Pedido recebido",
  AGUARDANDO_MAPA_ESTOQUE:                "Aguardando mapa de estoque",
  MAPA_EMITIDO_AGUARDANDO_SEPARACAO:      "Mapa emitido",
  EM_SEPARACAO_CONFERENCIA:               "Em separação / conferência",
  CONFERIDO_AGUARDANDO_FATURAMENTO:       "Conferido",
  FATURADO_AGUARDANDO_SAIDA:              "Faturado",
  SAIU_PARA_ENTREGA:                      "Saiu para entrega",
  ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM:    "Entregue",
  MONTAGEM_AGENDADA:                      "Montagem agendada",
  MONTAGEM_FINALIZADA:                    "Montagem concluída",
  PEDIDO_PAGAMENTO_APROVADO:              "Pagamento aprovado",
  PEDIDO_PAGAMENTO_RECUSADO:              "Pagamento recusado",
  ENTREGA_AVALIADA:                       "Avaliação de entrega recebida",
};

function getStepIndex(timeline: any[], steps: JourneyStep[]): number {
  const seen = new Set(
    (timeline ?? []).map((e: any) => String(e.type ?? e.event_key ?? "").toUpperCase()),
  );
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].keys.some((k) => seen.has(k))) return i;
  }
  return 0;
}

// Mesmo botão da CustomerJourneyPage
function CjBtn({ children, onClick, variant = "primary" }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
}) {
  const base: React.CSSProperties = {
    fontFamily: FONT, fontWeight: 700, fontSize: 16,
    border: "none", borderRadius: 14, minHeight: 52,
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", gap: 8, width: "100%",
    transition: "opacity .15s", textDecoration: "none",
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: { ...base, background: C.action, color: C.white, boxShadow: "0 4px 16px rgba(53,99,173,.30)" },
    outline:  { ...base, background: "transparent", color: C.action, border: `2px solid ${C.action}`, minHeight: 50 },
    ghost:    { ...base, background: C.white, color: C.primary, border: `1.5px solid ${C.border}`, boxShadow: "0 2px 6px rgba(31,40,85,.06)", fontWeight: 600, fontSize: 15 },
  };
  return <button style={styles[variant]} onClick={onClick}>{children}</button>;
}

export function PublicOrderPage({ numped }: { numped: string }) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!numped) { setError("Número de pedido inválido"); setLoading(false); return; }

    api<any>(`/public/pedido/${numped}`)
      .then((json) => {
        if (json?.redirect) { location.replace(json.redirect); return; }
        setData(json);
      })
      .catch((e: any) => setError(e?.message ?? "Pedido não encontrado"))
      .finally(() => setLoading(false));
  }, [numped]);

  // ── Loading — idêntico à CustomerJourneyPage ─────────────────────────────
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
  if (error || !data) {
    return (
      <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
        <header style={{ background: C.primary, padding: "28px 20px 36px" }}>
          <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.white, marginBottom: 6 }}>Rodrigues Colchões</div>
            <p style={{ color: "rgba(255,255,255,.65)", fontSize: 12, margin: 0, letterSpacing: "1.5px", textTransform: "uppercase" }}>
              Jornada Pós-venda
            </p>
          </div>
        </header>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <div style={{ background: C.white, borderRadius: 20, padding: "32px 24px", maxWidth: 380, width: "100%", textAlign: "center", boxShadow: "0 4px 24px rgba(31,40,85,.10)", marginTop: -20 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 24 }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.primary, margin: "0 0 8px" }}>Pedido não encontrado</h2>
            <p style={{ fontSize: 14, color: C.textSec, margin: "0 0 4px" }}>{error || "Não foi possível carregar o pedido."}</p>
            <p style={{ fontSize: 13, color: C.textMuted, margin: 0 }}>Verifique o link recebido ou entre em contato com a loja.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  const items       = (data.items ?? []) as { codprod: string; descricao: string; qt: number; requer_montagem: number }[];
  const timeline    = (data.timeline ?? []) as any[];
  const hasAssembly = items.some((i) => i.requer_montagem === 1);
  const visibleSteps  = buildSteps(hasAssembly);
  const currentStep = getStepIndex(timeline, visibleSteps);
  const displayStep   = Math.min(currentStep, visibleSteps.length - 1);
  const stepFraction  = visibleSteps.length > 1 ? displayStep / (visibleSteps.length - 1) : 1;
  // Reduz o círculo quando há muitas etapas para caber na tela
  const circleSize    = visibleSteps.length > 7 ? 24 : 28;
  const labelSize     = visibleSteps.length > 7 ? 8 : 9;

  const customerName  = String(data.nome_cliente ?? "");
  const statusLabel   = EVENT_TITLE[String(data.fluxo_event_key_atual ?? "").toUpperCase()]
                        ?? String(data.fluxo_event_key_atual ?? data.posicao ?? "PEDIDO_CRIADO");

  const currentKey = visibleSteps[displayStep]?.keys[0] ?? "";
  const nextStepMsg: string | null =
    currentKey === "ENTREGA_CONFIRMADA_AGENDAR_MONTAGEM" && hasAssembly
      ? "Seu produto foi entregue! Aguarde o contato da nossa equipe para agendar a montagem."
      : null;

  return (
    <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, color: C.primary }}>

      {/* ── HEADER — mesmo da CustomerJourneyPage ─────────────────────── */}
      <header style={{ background: C.primary, padding: "28px 20px 40px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 6, letterSpacing: "-0.3px" }}>
            Rodrigues Colchões
          </div>
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 11, margin: 0, letterSpacing: "2px", textTransform: "uppercase", fontWeight: 500 }}>
            Jornada Pós-venda
          </p>
        </div>
      </header>

      {/* ── CONTENT ─────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 40px" }}>

        {/* Order identity card — sobrepõe o header */}
        <div style={{ background: C.white, borderRadius: 20, padding: "18px 20px 16px", marginTop: -24, marginBottom: 14, boxShadow: "0 4px 24px rgba(31,40,85,.14)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.primary, marginBottom: 3, letterSpacing: "-0.2px" }}>
                Pedido #{data.numped}
              </div>
              <div style={{ fontSize: 14, color: C.textSec }}>{customerName}</div>
            </div>
            <span style={{ background: "#EFF6FF", color: C.action, fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 20, border: `1px solid rgba(53,99,173,.20)`, whiteSpace: "nowrap" }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Next step info */}
        {nextStepMsg && (
          <div style={{ background: C.white, color: C.primary, borderRadius: 16, padding: "16px 20px", marginBottom: 14, fontSize: 15, fontWeight: 500, lineHeight: 1.5, border: `1px solid ${C.border}`, boxShadow: "0 2px 8px rgba(31,40,85,.06)" }}>
            <span style={{ marginRight: 8 }}>ℹ️</span>{nextStepMsg}
          </div>
        )}

        {/* Régua de progresso */}
        <div style={{ background: C.white, borderRadius: 16, padding: "20px 8px 16px", marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            <div style={{ position: "absolute", top: circleSize / 2 - 1, left: "5%", right: "5%", height: 2, zIndex: 0, background: `linear-gradient(to right, ${C.primary} ${stepFraction * 100}%, #E2E8F0 ${stepFraction * 100}%)` }} />
            {visibleSteps.map((step, i) => {
              const isDone    = i < displayStep;
              const isCurrent = i === displayStep;
              return (
                <div key={step.keys[0]} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, position: "relative", zIndex: 1 }}>
                  <div style={{ width: circleSize, height: circleSize, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: isDone ? C.primary : isCurrent ? C.action : "#E2E8F0", color: isDone || isCurrent ? C.white : C.textMuted, fontSize: circleSize <= 24 ? 9 : 11, fontWeight: 700, boxShadow: isCurrent ? `0 0 0 3px rgba(53,99,173,.18)` : "none", flexShrink: 0 }}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <div style={{ fontSize: labelSize, textAlign: "center", marginTop: 5, color: isDone || isCurrent ? C.primary : C.textMuted, fontWeight: isDone || isCurrent ? 600 : 400, lineHeight: 1.25, whiteSpace: "pre-line" }}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Produtos do pedido */}
        {items.length > 0 && (
          <div style={{ background: C.white, borderRadius: 16, padding: "20px 20px 12px", marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)" }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "1.5px" }}>
              Seus produtos
            </h2>
            {items.map((item, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 12, paddingBottom: 12, borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none", marginBottom: idx < items.length - 1 ? 12 : 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15, fontWeight: 700, color: C.primary }}>
                  {item.qt}x
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.primary, lineHeight: 1.35 }}>
                    {item.descricao || item.codprod}
                  </div>
                  {item.requer_montagem === 1 && (
                    <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 700, background: "#EFF6FF", color: C.action, border: `1px solid rgba(53,99,173,.20)`, borderRadius: 6, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Montagem
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preciso de ajuda */}
        <div style={{ marginBottom: 14 }}>
          <CjBtn variant="ghost" onClick={() => {
            const msg = encodeURIComponent(`Olá! Preciso de ajuda com o pedido #${data.numped}`);
            window.open(`https://wa.me/5592993382735?text=${msg}`, "_blank");
          }}>
            ✋ Preciso de ajuda
          </CjBtn>
        </div>

        {/* Histórico do pedido — apenas etapas que ocorreram efetivamente */}
        <div style={{ background: C.white, borderRadius: 16, padding: "20px 20px 12px", marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)" }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "1.5px" }}>
            Histórico do pedido
          </h2>
          {(() => {
            // Mostra etapas 1 até a fase atual (inclusive) — fases futuras ocultas
            const historySteps = visibleSteps.slice(0, displayStep + 1);

            if (historySteps.length === 0) {
              return <p style={{ fontSize: 14, color: C.textMuted, margin: 0 }}>Nenhum evento registrado ainda.</p>;
            }

            return historySteps.map((step, idx) => {
              const isLast    = idx === historySteps.length - 1;
              const isCurrent = isLast;
              const isDone    = !isLast;
              const stepNum   = idx + 1;

              // Busca evento correspondente no timeline (para mostrar data/hora)
              const event = timeline.find((e: any) =>
                step.keys.some((k) => k === String(e.type ?? e.event_key ?? "").toUpperCase()),
              );

              return (
                <div key={step.keys[0]} style={{ display: "flex", gap: 14, paddingBottom: isLast ? 4 : 16, position: "relative" }}>
                  {!isLast && (
                    <div style={{ position: "absolute", left: 9, top: 22, bottom: 0, width: 2, background: C.primary, zIndex: 0 }} />
                  )}
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                    background: isDone ? C.primary : C.action,
                    boxShadow: isCurrent ? "0 0 0 4px rgba(53,99,173,.14)" : "none",
                    position: "relative", zIndex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: 700, color: C.white,
                  }}>
                    {isDone ? "✓" : stepNum}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.primary, marginBottom: 2 }}>
                      {step.label.replace("\n", " ")}
                    </div>
                    {event?.created_at && (
                      <span style={{ fontSize: 11, color: C.textMuted }}>
                        {new Date(event.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>

      </div>
    </div>
  );
}
