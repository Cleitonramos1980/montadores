import { useEffect, useState } from "react";
import { api } from "../lib/api";

const C = {
  primary:   "#1F2855",
  action:    "#3563AD",
  white:     "#FFFFFF",
  bg:        "#F7F9FC",
  border:    "#E2E8F0",
  textMuted: "#64748B",
  textSec:   "#475569",
  success:   "#16A34A",
  successBg: "#F0FDF4",
  successBd: "#BBF7D0",
  error:     "#DC2626",
  errorBg:   "#FEF2F2",
  warn:      "#92400E",
  warnBg:    "#FFFBEB",
};

const FONT = "'Mazzard', Arial, system-ui, -apple-system, sans-serif";

const COMPLAINT_REASONS = [
  "Montagem incorreta",
  "Produto com defeito",
  "Montador não compareceu",
  "Serviço incompleto",
  "Falta de profissionalismo",
  "Dano ao produto ou imóvel",
  "Outro",
];

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.white, borderRadius: 16, padding: "20px",
    marginBottom: 14, boxShadow: "0 2px 8px rgba(31,40,85,.06)",
    ...extra,
  };
}

export function PublicReviewPage({ token }: { token: string }) {
  const [order, setOrder]               = useState<any>();
  const [score, setScore]               = useState<number | null>(null);
  const [comment, setComment]           = useState("");
  const [complaintReason, setComplaintReason] = useState("");
  const [loading, setLoading]           = useState(false);
  const [fetchError, setFetchError]     = useState("");
  const [done, setDone]                 = useState<any>(null);
  const [submitError, setSubmitError]   = useState("");

  useEffect(() => {
    api<any>(`/public/journey/${token}`)
      .then(setOrder)
      .catch((err) => setFetchError(err.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score === null) { setSubmitError("Selecione uma nota de 0 a 10."); return; }
    if (score <= 6 && !complaintReason) { setSubmitError("Informe o motivo para notas abaixo de 7."); return; }
    setLoading(true);
    setSubmitError("");
    try {
      const result = await api<any>(`/public/reviews/${token}/assembly`, {
        method: "POST",
        body: JSON.stringify({
          score,
          comment: comment || undefined,
          complaintReason: complaintReason || undefined,
        }),
      });
      setDone(result);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const wrap = (children: React.ReactNode) => (
    <div style={{ fontFamily: FONT, minHeight: "100vh", background: C.bg, color: C.primary }}>
      <header style={{ background: C.primary, padding: "28px 20px 40px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
          <p style={{ color: "rgba(255,255,255,.55)", fontSize: 11, margin: "0 0 6px", letterSpacing: "2px", textTransform: "uppercase" }}>
            Rodrigues Colchões
          </p>
          <h1 style={{ color: C.white, fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.3px" }}>
            Avaliação de Montagem
          </h1>
        </div>
      </header>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 16px 40px" }}>
        {children}
      </div>
    </div>
  );

  // Loading
  if (!order && !fetchError) {
    return wrap(
      <div style={{ ...card({ marginTop: -20 }), textAlign: "center", color: C.textMuted, fontSize: 14, padding: "32px 20px" }}>
        Carregando...
      </div>,
    );
  }

  // Fatal fetch error
  if (fetchError && !order) {
    return wrap(
      <div style={{ ...card({ marginTop: -20 }), textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontSize: 17, color: C.primary, margin: "0 0 8px" }}>
          {fetchError.includes("expirado") ? "Link expirado" : fetchError.includes("localizado") ? "Link inválido" : "Algo deu errado"}
        </h2>
        <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>
          {fetchError.includes("expirado") ? "Este link de avaliação expirou. Solicite um novo link à empresa." : "Verifique o link recebido ou entre em contato com a empresa."}
        </p>
      </div>,
    );
  }

  const alreadyReviewed = order?.reviews?.some((r: any) => r.service_type === "MONTAGEM");

  // Already reviewed or just submitted
  if (alreadyReviewed || done) {
    const classification = done?.classification ?? order?.reviews?.find((r: any) => r.service_type === "MONTAGEM")?.classification;
    const payment = done?.payment;
    const isPositive = classification === "POSITIVA";
    const isNegative = classification === "NEGATIVA";

    return wrap(
      <>
        <div style={{ ...card({ marginTop: -20 }), textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>
            {isPositive ? "🎉" : isNegative ? "😔" : "📋"}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.primary, margin: "0 0 6px" }}>
            {isPositive ? "Obrigado pelo seu feedback!" : isNegative ? "Lamentamos pela experiência" : "Avaliação registrada"}
          </h2>
          <p style={{ fontSize: 14, color: C.textSec, margin: "0 0 12px" }}>
            Pedido #{order?.numped}
          </p>
          <div style={{
            background: isPositive ? C.successBg : isNegative ? C.errorBg : C.warnBg,
            border: `1px solid ${isPositive ? C.successBd : isNegative ? "#FECACA" : "#FDE68A"}`,
            borderRadius: 12, padding: "12px 16px", fontSize: 14,
            color: isPositive ? C.success : isNegative ? C.error : C.warn,
          }}>
            {isPositive && (
              <>Sua avaliação positiva foi registrada.{payment === "LIBERADO" ? " O pagamento ao montador foi liberado." : ""}</>
            )}
            {isNegative && "Um caso SAC foi aberto e nossa equipe entrará em contato. O pagamento está bloqueado até a resolução."}
            {!isPositive && !isNegative && "Recebemos sua avaliação. Nosso time irá analisar para sempre melhorar o serviço."}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <a
            href={`/montadores/jornada-publica/${token}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: C.action, color: C.white, textDecoration: "none",
              borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 700,
            }}
          >
            Ver minha jornada
          </a>
        </div>
      </>,
    );
  }

  // Classification based on score
  const classification = score === null ? null : score <= 6 ? "NEGATIVA" : score <= 8 ? "NEUTRA" : "POSITIVA";
  const classLabel = classification === "POSITIVA" ? "Ótima experiência!" : classification === "NEUTRA" ? "Experiência razoável." : "Experiência negativa.";
  const classColor = classification === "POSITIVA" ? C.success : classification === "NEGATIVA" ? C.error : C.warn;
  const assemblyItems = order?.items?.filter((i: any) => i.requires_assembly) ?? [];

  return wrap(
    <>
      {/* Order identity card */}
      <div style={{ ...card({ marginTop: -20 }) }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.primary, marginBottom: 3 }}>
          Pedido #{order?.numped}
        </div>
        <div style={{ fontSize: 14, color: C.textSec }}>{order?.customer_name}</div>
      </div>

      {/* Products */}
      {assemblyItems.length > 0 && (
        <div style={card()}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, margin: "0 0 14px", textTransform: "uppercase", letterSpacing: "1.5px" }}>
            Produtos montados
          </h2>
          {assemblyItems.map((item: any) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 14, color: C.primary }}>
                <strong style={{ color: C.action }}>{item.quantity}x</strong> {item.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Evaluation form */}
      <div style={card()}>
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.primary, margin: "0 0 6px" }}>
            Como foi a montagem?
          </h2>
          <p style={{ fontSize: 14, color: C.textMuted, margin: "0 0 18px" }}>
            De 0 a 10, qual nota você dá para o serviço?
          </p>

          {/* Score grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginBottom: 8 }}>
            {Array.from({ length: 11 }, (_, i) => {
              const isSelected = score === i;
              const colorBg = i <= 6 ? "#FEF2F2" : i <= 8 ? "#FFFBEB" : "#F0FDF4";
              const colorText = i <= 6 ? C.error : i <= 8 ? C.warn : C.success;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setScore(i); setSubmitError(""); }}
                  style={{
                    background: isSelected ? (i <= 6 ? C.error : i <= 8 ? "#D97706" : C.success) : colorBg,
                    color: isSelected ? C.white : colorText,
                    border: `2px solid ${isSelected ? "transparent" : C.border}`,
                    borderRadius: 10, padding: "10px 4px",
                    fontSize: 15, fontWeight: 700,
                    cursor: "pointer", fontFamily: FONT,
                    boxShadow: isSelected ? "0 2px 8px rgba(0,0,0,.15)" : "none",
                    transition: "all .15s",
                  }}
                >
                  {i}
                </button>
              );
            })}
          </div>

          {score !== null && (
            <p style={{ color: classColor, fontWeight: 700, fontSize: 14, margin: "10px 0 16px" }}>
              {classLabel}
            </p>
          )}

          {score !== null && score <= 8 && (
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: C.textSec, marginBottom: 14 }}>
              Motivo {score <= 6 ? <strong style={{ color: C.error }}>(obrigatório)</strong> : "(opcional)"}
              <select
                value={complaintReason}
                onChange={(e) => setComplaintReason(e.target.value)}
                style={{ fontFamily: FONT, fontSize: 15 }}
              >
                <option value="">Selecione...</option>
                {COMPLAINT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}

          <label style={{ display: "grid", gap: 6, fontSize: 14, color: C.textSec, marginBottom: 18 }}>
            Comentário (opcional)
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Conte mais sobre sua experiência..."
              style={{ minHeight: 100, fontFamily: FONT, fontSize: 15 }}
            />
          </label>

          {submitError && (
            <div style={{
              background: C.errorBg, border: `1px solid #FECACA`,
              borderRadius: 10, padding: "10px 14px",
              fontSize: 14, color: C.error, marginBottom: 14,
            }}>
              {submitError}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              type="submit"
              disabled={loading || score === null}
              style={{
                background: score !== null && score <= 6 ? C.error : C.action,
                color: C.white, border: "none", borderRadius: 14,
                padding: "14px 20px", fontSize: 16, fontWeight: 700,
                cursor: loading || score === null ? "not-allowed" : "pointer",
                opacity: loading || score === null ? 0.6 : 1,
                fontFamily: FONT, minHeight: 52,
                boxShadow: "0 4px 16px rgba(53,99,173,.28)",
              }}
            >
              {loading ? "Enviando..." : score !== null && score <= 6 ? "Registrar reclamação" : "Enviar avaliação"}
            </button>
            <a
              href={`/montadores/jornada-publica/${token}`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: C.white, color: C.textSec,
                border: `1.5px solid ${C.border}`, borderRadius: 14,
                padding: "13px 20px", fontSize: 15, fontWeight: 600,
                textDecoration: "none", fontFamily: FONT,
              }}
            >
              ← Voltar para a jornada
            </a>
          </div>
        </form>
      </div>
    </>,
  );
}
