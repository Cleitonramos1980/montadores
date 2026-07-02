import { useEffect, useState } from "react";
import { api } from "../lib/api";

// ─── Brand palette ────────────────────────────────────────────────────────────
const C = {
  primary:    "#1F2855",
  primaryDim: "rgba(31,40,85,.08)",
  action:     "#3563AD",
  actionDark: "#2850A0",
  actionLight:"#EEF3FB",
  white:      "#FFFFFF",
  bg:         "#F7F9FC",
  border:     "#E2E8F0",
  muted:      "#F1F5F9",
  textPri:    "#1F2855",
  textSec:    "#475569",
  error:      "#DC2626",
  errorBg:    "#FEF2F2",
  errorBd:    "#FECACA",
  success:    "#16A34A",
  successBg:  "#F0FDF4",
  successBd:  "#BBF7D0",
  warn:       "#92400E",
  warnBg:     "#FFFBEB",
  warnBd:     "#FDE68A",
};

// Font stack — Mazzard first; place .woff2 files in /public/fonts/ and @font-face in index.html
const FONT = "'Mazzard', 'Nunito', Arial, sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────
type EvalQuestion = {
  id: string;
  position: number;
  type: string;
  label: string;
  required: boolean;
  minLabel: string | null;
  maxLabel: string | null;
  options: string[] | null;
};

type LinkInfo = {
  linkId: string;
  token: string;
  phase: string;
  numped: string | null;
  expiresAt: string;
  usedAt: string | null;
  config: {
    title: string;
    description: string | null;
    questions: EvalQuestion[];
  };
  order: {
    numped: string | null;
    customerName: string | null;
  };
};

type PageStatus =
  | "loading"
  | "valid"
  | "expired"
  | "invalid"
  | "used"
  | "submitting"
  | "success"
  | "submit_error";

const PHASE_LABELS: Record<string, string> = {
  ATENDIMENTO: "Atendimento",
  ENTREGA:     "Entrega",
  MONTAGEM:    "Montagem",
};

// ─── Shared CSS injected once ─────────────────────────────────────────────────
const EVAL_STYLES = `
@keyframes eval-spin { to { transform: rotate(360deg); } }
@keyframes eval-fadein { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }

.eval-root {
  min-height: 100vh;
  background: ${C.bg};
  font-family: ${FONT};
  color: ${C.textPri};
}
.eval-header {
  background: ${C.primary};
  padding: 24px 20px 28px;
  text-align: center;
}
.eval-header-brand {
  font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
  color: rgba(255,255,255,.55); margin-bottom: 2px; font-family: ${FONT};
}
.eval-header-company {
  font-size: 15px; font-weight: 700; color: rgba(255,255,255,.9);
  margin-bottom: 10px; font-family: ${FONT};
}
.eval-header-title {
  font-size: 22px; font-weight: 800; color: #fff;
  margin: 0 0 6px; font-family: ${FONT}; line-height: 1.25;
}
.eval-header-sub {
  font-size: 13px; color: rgba(255,255,255,.65); font-family: ${FONT};
  margin: 0; line-height: 1.5;
}
.eval-wrap { max-width: 600px; margin: 0 auto; padding: 16px 14px 56px; }
.eval-card {
  background: ${C.white};
  border: 1px solid ${C.border};
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 20px;
  margin-bottom: 12px;
  animation: eval-fadein .25s ease;
}
.eval-q-label {
  font-family: ${FONT}; font-size: 15px; font-weight: 600;
  color: ${C.textPri}; margin: 0 0 14px; line-height: 1.45;
}
.eval-required { color: ${C.error}; margin-left: 2px; }

/* Score grid */
.eval-score-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}
.eval-score-btn {
  min-height: 46px; border-radius: 8px; border: 2px solid ${C.border};
  background: ${C.white}; color: ${C.textPri};
  font-family: ${FONT}; font-size: 15px; font-weight: 500;
  cursor: pointer; transition: all .12s; padding: 0;
}
.eval-score-btn:hover { border-color: ${C.action}; background: ${C.actionLight}; }
.eval-score-btn.selected {
  border-color: ${C.action}; background: ${C.action};
  color: ${C.white}; font-weight: 700;
}

/* Stars */
.eval-stars { display: flex; gap: 8px; justify-content: center; }
.eval-star-btn {
  font-size: 36px; background: none; border: none; cursor: pointer;
  color: ${C.border}; padding: 4px; min-height: 48px; transition: color .12s;
}
.eval-star-btn.selected { color: #F59E0B; }

/* Yes/No */
.eval-yn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.eval-yn-btn {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 8px; border-radius: 10px; border: 2px solid ${C.border};
  background: ${C.white}; color: ${C.textPri};
  font-family: ${FONT}; font-size: 15px; font-weight: 600;
  cursor: pointer; min-height: 80px; transition: all .12s;
}
.eval-yn-btn:hover { border-color: ${C.action}; background: ${C.actionLight}; }
.eval-yn-btn.selected-yes { border-color: ${C.success}; background: ${C.successBg}; color: ${C.success}; }
.eval-yn-btn.selected-no  { border-color: ${C.error};   background: ${C.errorBg};   color: ${C.error}; }
.eval-yn-icon { font-size: 26px; }

/* Single choice */
.eval-choice-opt {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 10px; border: 2px solid ${C.border};
  background: ${C.white}; color: ${C.textPri};
  font-family: ${FONT}; font-size: 14px; font-weight: 400;
  cursor: pointer; text-align: left; width: 100%;
  transition: all .12s; margin-bottom: 8px;
}
.eval-choice-opt:last-child { margin-bottom: 0; }
.eval-choice-opt:hover { border-color: ${C.action}; }
.eval-choice-opt.selected-pos { border-color: ${C.action}; background: ${C.actionLight}; color: ${C.action}; font-weight: 600; }
.eval-choice-opt.selected-neg { border-color: ${C.error};  background: ${C.errorBg};    color: ${C.error};  font-weight: 600; }
.eval-radio-dot {
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid ${C.border}; background: transparent;
  display: flex; align-items: center; justify-content: center; transition: all .12s;
}
.eval-radio-inner { width: 8px; height: 8px; border-radius: 50%; background: ${C.white}; display: block; }

/* Textarea */
.eval-textarea {
  width: 100%; border: 1.5px solid ${C.border}; border-radius: 8px;
  padding: 12px; font-family: ${FONT}; font-size: 14px; color: ${C.textPri};
  resize: vertical; min-height: 90px; outline: none; box-sizing: border-box;
  transition: border-color .12s;
}
.eval-textarea:focus { border-color: ${C.action}; box-shadow: 0 0 0 3px rgba(53,99,173,.1); }

/* Submit */
.eval-submit {
  width: 100%; background: ${C.action}; color: ${C.white}; border: none;
  border-radius: 10px; padding: 16px; font-family: ${FONT};
  font-size: 16px; font-weight: 700; cursor: pointer; transition: background .15s;
  min-height: 54px; margin-top: 4px;
}
.eval-submit:hover:not(:disabled) { background: ${C.actionDark}; }
.eval-submit:disabled { opacity: .6; cursor: not-allowed; }
.eval-submit:focus-visible { outline: 3px solid ${C.action}; outline-offset: 3px; }

/* Alerts */
.eval-alert {
  border-radius: 8px; padding: 12px 14px; font-family: ${FONT};
  font-size: 13px; line-height: 1.5; margin-bottom: 10px;
}
.eval-alert-warn  { background: ${C.warnBg};   border: 1px solid ${C.warnBd};   color: ${C.warn}; }
.eval-alert-error { background: ${C.errorBg};  border: 1px solid ${C.errorBd};  color: ${C.error}; }
.eval-alert-ok    { background: ${C.successBg}; border: 1px solid ${C.successBd}; color: ${C.success}; }

/* State screens */
.eval-state {
  max-width: 500px; margin: 32px auto; padding: 0 16px;
  text-align: center; animation: eval-fadein .3s ease;
}
.eval-state-card {
  background: ${C.white}; border: 1px solid ${C.border};
  border-radius: 14px; box-shadow: 0 4px 20px rgba(0,0,0,.08);
  padding: 36px 28px;
}
.eval-state-icon { font-size: 48px; margin-bottom: 12px; display: block; }
.eval-state-title { font-family: ${FONT}; font-size: 22px; font-weight: 800; color: ${C.textPri}; margin: 0 0 10px; }
.eval-state-text  { font-family: ${FONT}; font-size: 14px; color: ${C.textSec}; line-height: 1.6; margin: 0; }

/* Order chip */
.eval-order-chip {
  background: ${C.primary}; border-radius: 10px; padding: 14px 18px;
  color: rgba(255,255,255,.9); font-family: ${FONT}; margin-bottom: 12px;
}
.eval-order-chip-name { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
.eval-order-chip-num  { font-size: 12px; opacity: .65; }

/* Footer note */
.eval-footer-note {
  text-align: center; font-size: 11px; color: ${C.textSec};
  font-family: ${FONT}; margin-top: 16px; line-height: 1.5; padding: 0 8px;
}

/* Spinner */
.eval-spinner {
  width: 38px; height: 38px; border: 3px solid ${C.border};
  border-top-color: ${C.action}; border-radius: 50%;
  animation: eval-spin 0.85s linear infinite; margin: 0 auto;
}

@media (max-width: 380px) {
  .eval-score-grid { grid-template-columns: repeat(4, 1fr); }
  .eval-header-title { font-size: 20px; }
}
`;

// ─── Sub-components ────────────────────────────────────────────────────────────

function EvalHeader({ phase }: { phase?: string }) {
  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : undefined;
  return (
    <header className="eval-header">
      <div className="eval-header-brand">Jornada Pós-venda</div>
      <div className="eval-header-company">Rodrigues Colchões</div>
      <h1 className="eval-header-title">
        {phaseLabel ? `Avaliação de ${phaseLabel}` : "Avaliação"}
      </h1>
      <p className="eval-header-sub">
        Sua opinião ajuda a manter a qualidade do nosso atendimento.
      </p>
    </header>
  );
}

function LoadingScreen() {
  return (
    <div className="eval-state">
      <div className="eval-spinner" />
      <p style={{ color: C.textSec, fontFamily: FONT, marginTop: 16 }}>Carregando avaliação...</p>
    </div>
  );
}

function BrandSignature({ classification }: { classification?: string }) {
  const isNeg = classification === "NEGATIVA";
  return (
    <div style={{
      marginTop: 28,
      paddingTop: 22,
      borderTop: `1px solid ${C.border}`,
      textAlign: "center",
    }}>
      {/* Logo-like "R" badge */}
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        background: "#3563AD",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 10px",
        boxShadow: "0 2px 8px rgba(53,99,173,.25)",
      }}>
        <span style={{ fontFamily: FONT, fontWeight: 900, fontSize: 22, color: "#fff", lineHeight: 1 }}>R</span>
      </div>

      {/* Company name */}
      <div style={{ fontFamily: FONT, lineHeight: 1.2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#475569", letterSpacing: 1, textTransform: "uppercase" }}>
          Rodrigues
        </span>
        {" "}
        <span style={{ fontSize: 13, fontWeight: 900, color: "#3563AD", letterSpacing: 1, textTransform: "uppercase" }}>
          Colchões
        </span>
      </div>

      {/* Context message */}
      <p style={{
        fontFamily: FONT, fontSize: 12, color: C.textSec,
        margin: "8px 0 0", lineHeight: 1.5,
      }}>
        {isNeg
          ? "A Rodrigues Colchões pede desculpas pela experiência e se compromete a resolver."
          : "A Rodrigues Colchões agradece a sua confiança e avaliação."}
      </p>
    </div>
  );
}

function StateScreen({ icon, title, text, extra, classification }: {
  icon: string; title: string; text: string;
  extra?: React.ReactNode;
  classification?: string;
}) {
  const showBrand = classification !== undefined;
  return (
    <div className="eval-state">
      <div className="eval-state-card">
        <span className="eval-state-icon">{icon}</span>
        <h2 className="eval-state-title">{title}</h2>
        <p className="eval-state-text">{text}</p>
        {extra}
        {showBrand && <BrandSignature classification={classification} />}
      </div>
    </div>
  );
}

// ─── Score 0-10 ───────────────────────────────────────────────────────────────
function ScaleInput({ question, value, onChange }: {
  question: EvalQuestion; value: number | null; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="eval-score-grid">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            aria-label={`Nota ${i}`}
            aria-pressed={value === i}
            className={`eval-score-btn${value === i ? " selected" : ""}`}
          >
            {i}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSec, fontFamily: FONT }}>
        <span>{question.minLabel ?? "0 = muito insatisfeito"}</span>
        <span>{question.maxLabel ?? "10 = muito satisfeito"}</span>
      </div>
    </div>
  );
}

// ─── Stars 1-5 ───────────────────────────────────────────────────────────────
function StarsInput({ value, onChange }: {
  question: EvalQuestion; value: number | null; onChange: (v: number) => void;
}) {
  return (
    <div className="eval-stars">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-label={`${s} estrela${s > 1 ? "s" : ""}`}
          aria-pressed={value !== null && value >= s}
          className={`eval-star-btn${value !== null && value >= s ? " selected" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── Sim / Não ────────────────────────────────────────────────────────────────
function YesNoInput({ value, onChange }: {
  value: string | null; onChange: (v: string) => void;
}) {
  const opts = [
    { label: "Sim", icon: "👍", cls: "selected-yes" },
    { label: "Não", icon: "👎", cls: "selected-no" },
  ];
  return (
    <div className="eval-yn-grid">
      {opts.map(({ label, icon, cls }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(label)}
          aria-pressed={value === label}
          className={`eval-yn-btn${value === label ? ` ${cls}` : ""}`}
        >
          <span className="eval-yn-icon">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Single choice (card) ─────────────────────────────────────────────────────
function SingleChoiceInput({ question, value, onChange }: {
  question: EvalQuestion; value: string | null; onChange: (v: string) => void;
}) {
  const options = question.options ?? [];
  return (
    <div>
      {options.map((opt) => {
        const selected = value === opt;
        const isNeg = opt.toLowerCase().startsWith("não") || opt.toLowerCase().includes("reclamação");
        const cls = selected ? (isNeg ? "selected-neg" : "selected-pos") : "";
        const dotColor = selected ? (isNeg ? C.error : C.action) : C.border;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={selected}
            className={`eval-choice-opt ${cls}`}
          >
            <span
              className="eval-radio-dot"
              style={{ borderColor: dotColor, background: selected ? dotColor : "transparent" }}
            >
              {selected && <span className="eval-radio-inner" />}
            </span>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Multiple choice (checkboxes) ─────────────────────────────────────────────
function MultipleChoiceInput({ question, value, onChange }: {
  question: EvalQuestion; value: string | null; onChange: (v: string) => void;
}) {
  const options = question.options ?? [];
  const selected: string[] = (() => {
    try { return value ? JSON.parse(value) : []; } catch { return []; }
  })();

  function toggle(opt: string) {
    const next = selected.includes(opt)
      ? selected.filter((o) => o !== opt)
      : [...selected, opt];
    onChange(JSON.stringify(next));
  }

  return (
    <div>
      {options.map((opt) => {
        const checked = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            aria-pressed={checked}
            className={`eval-choice-opt${checked ? " selected-pos" : ""}`}
          >
            <span
              className="eval-radio-dot"
              style={{
                borderColor: checked ? C.action : C.border,
                background: checked ? C.action : "transparent",
                borderRadius: 4,
              }}
            >
              {checked && <span className="eval-radio-inner" />}
            </span>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────
function EvalForm({
  linkInfo,
  submitting,
  onSubmit,
}: {
  linkInfo: LinkInfo;
  submitting: boolean;
  onSubmit: (answers: Record<string, { text?: string; number?: number }>, comment: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, { text?: string; number?: number }>>({});
  const [comment, setComment] = useState("");
  const [validationMsg, setValidationMsg] = useState("");

  function setAnswer(qId: string, update: { text?: string; number?: number }) {
    setAnswers((prev) => ({ ...prev, [qId]: { ...prev[qId], ...update } }));
    setValidationMsg("");
  }

  const commentRequired = linkInfo.config.questions.some((q) => {
    const a = answers[q.id];
    if (!a) return false;
    if (q.type === "SCALE" && a.number !== undefined && a.number <= 6) return true;
    if (q.type === "YES_NO" && a.text === "Não") return true;
    if (q.type === "SINGLE_CHOICE" && a.text) {
      const t = a.text.toLowerCase();
      return t.startsWith("não") || t.includes("reclamação");
    }
    return false;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    for (const q of linkInfo.config.questions) {
      if (!q.required) continue;
      const a = answers[q.id];
      if ((q.type === "SCALE" || q.type === "STARS") && a?.number === undefined) {
        setValidationMsg(`Por favor, responda: "${q.label}"`);
        return;
      }
      if (["TEXT", "YES_NO", "SINGLE_CHOICE"].includes(q.type) && !a?.text?.trim()) {
        setValidationMsg(`Por favor, responda: "${q.label}"`);
        return;
      }
      if (q.type === "MULTIPLE_CHOICE") {
        try {
          const sel = a?.text ? JSON.parse(a.text) : [];
          if (!Array.isArray(sel) || sel.length === 0) {
            setValidationMsg(`Por favor, selecione ao menos uma opção: "${q.label}"`);
            return;
          }
        } catch {
          setValidationMsg(`Por favor, responda: "${q.label}"`);
          return;
        }
      }
    }
    if (commentRequired && !comment.trim()) {
      setValidationMsg("Por favor, descreva o que aconteceu para que possamos te ajudar.");
      return;
    }
    onSubmit(answers, comment);
  }

  return (
    <div className="eval-wrap">
      {/* Order chip */}
      {(linkInfo.order.customerName || linkInfo.order.numped) && (
        <div className="eval-order-chip">
          {linkInfo.order.customerName && (
            <div className="eval-order-chip-name">
              Olá, {linkInfo.order.customerName.split(" ")[0]}!
            </div>
          )}
          {linkInfo.order.numped && (
            <div className="eval-order-chip-num">Pedido nº {linkInfo.order.numped}</div>
          )}
        </div>
      )}

      <p style={{ textAlign: "center", fontSize: 13, color: C.textSec, fontFamily: FONT, margin: "4px 0 14px", lineHeight: 1.5 }}>
        Responda as perguntas abaixo. Leva menos de 1 minuto.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {linkInfo.config.questions.map((q) => {
          const a = answers[q.id];
          const lowScore = q.type === "SCALE" && a?.number !== undefined && a.number <= 6;
          return (
            <div key={q.id} className="eval-card">
              <p className="eval-q-label">
                {q.label}
                {q.required && <span className="eval-required">*</span>}
              </p>

              {q.type === "SCALE" && (
                <ScaleInput
                  question={q}
                  value={a?.number ?? null}
                  onChange={(v) => setAnswer(q.id, { number: v })}
                />
              )}
              {q.type === "STARS" && (
                <StarsInput
                  question={q}
                  value={a?.number ?? null}
                  onChange={(v) => setAnswer(q.id, { number: v })}
                />
              )}
              {q.type === "TEXT" && (
                <textarea
                  className="eval-textarea"
                  value={a?.text ?? ""}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  placeholder="Escreva sua resposta..."
                />
              )}
              {q.type === "YES_NO" && (
                <YesNoInput
                  value={a?.text ?? null}
                  onChange={(v) => setAnswer(q.id, { text: v })}
                />
              )}
              {q.type === "SINGLE_CHOICE" && (
                <SingleChoiceInput
                  question={q}
                  value={a?.text ?? null}
                  onChange={(v) => setAnswer(q.id, { text: v })}
                />
              )}
              {q.type === "MULTIPLE_CHOICE" && (
                <MultipleChoiceInput
                  question={q}
                  value={a?.text ?? null}
                  onChange={(v) => setAnswer(q.id, { text: v })}
                />
              )}

              {lowScore && (
                <div className="eval-alert eval-alert-warn" style={{ marginTop: 12, marginBottom: 0 }}>
                  Conte rapidamente o que aconteceu para que possamos te ajudar.
                </div>
              )}
            </div>
          );
        })}

        {/* Comment */}
        <div className="eval-card">
          <p className="eval-q-label" style={{ fontWeight: commentRequired ? 700 : 500, color: commentRequired ? C.textPri : C.textSec }}>
            {commentRequired
              ? <>Descreva o que aconteceu <span className="eval-required">*</span></>
              : "Comentário adicional (opcional)"}
          </p>
          {commentRequired && (
            <p style={{ margin: "0 0 8px", fontSize: 12, color: C.textSec, fontFamily: FONT, lineHeight: 1.5 }}>
              Sua descrição ajuda a equipe a entender o ocorrido e resolver o problema mais rapidamente.
            </p>
          )}
          <textarea
            className="eval-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={commentRequired
              ? "Descreva o ocorrido com detalhes..."
              : "Conte mais sobre sua experiência..."}
            rows={commentRequired ? 4 : 3}
          />
        </div>

        {validationMsg && (
          <div className="eval-alert eval-alert-error">{validationMsg}</div>
        )}

        <button
          type="submit"
          className="eval-submit"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Enviando..." : "Enviar avaliação"}
        </button>

        <p className="eval-footer-note">
          Ao responder, você concorda que suas respostas serão usadas para melhoria da qualidade do serviço da Rodrigues Colchões.
        </p>
      </form>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function PublicEvaluationPage({ token }: { token: string }) {
  const [status, setStatus]           = useState<PageStatus>("loading");
  const [linkInfo, setLinkInfo]       = useState<LinkInfo | null>(null);
  const [submitResult, setSubmitResult] = useState<{ classification: string } | null>(null);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    api<LinkInfo>(`/public/eval/${token}`)
      .then((data) => {
        if (data.usedAt) { setStatus("used"); return; }
        if (new Date(data.expiresAt) < new Date()) { setStatus("expired"); return; }
        setLinkInfo(data);
        setStatus("valid");
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  async function handleSubmit(
    answers: Record<string, { text?: string; number?: number }>,
    comment: string,
  ) {
    if (!linkInfo) return;
    setStatus("submitting");

    try {
      const answersPayload = linkInfo.config.questions
        .map((q) => ({
          questionId: q.id,
          valueText:   answers[q.id]?.text,
          valueNumber: answers[q.id]?.number,
        }))
        .filter((a) => a.valueText !== undefined || a.valueNumber !== undefined);

      const result = await api<{ classification: string }>(`/public/eval/${token}/respond`, {
        method: "POST",
        body: JSON.stringify({ answers: answersPayload, comment: comment || undefined }),
      });
      setSubmitResult(result);
      setStatus("success");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.toLowerCase().includes("já foi respondid") || msg.toLowerCase().includes("already")) {
        setStatus("used");
      } else if (msg.toLowerCase().includes("expirad") || msg.toLowerCase().includes("expired")) {
        setStatus("expired");
      } else {
        setSubmitError(msg || "Erro ao enviar. Tente novamente.");
        setStatus("submit_error");
      }
    }
  }

  const phase = linkInfo?.phase;
  const cl    = submitResult?.classification ?? "NEUTRA";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: EVAL_STYLES }} />
      <div className="eval-root">
        <EvalHeader phase={phase} />

        {status === "loading" && <LoadingScreen />}

        {status === "invalid" && (
          <StateScreen
            icon="🔗"
            title="Link não disponível"
            text="Este link de avaliação não está mais disponível ou é inválido. Se precisar de ajuda, entre em contato com nosso atendimento."
          />
        )}

        {status === "expired" && (
          <StateScreen
            icon="⏱️"
            title="Link expirado"
            text="O prazo para responder esta avaliação encerrou. Caso precise de ajuda, entre em contato com nosso atendimento."
          />
        )}

        {status === "used" && (
          <StateScreen
            icon="✅"
            title="Avaliação já respondida"
            text="Esta avaliação já foi respondida. Obrigado pela sua participação!"
            classification="POSITIVA"
          />
        )}

        {status === "success" && (
          <StateScreen
            icon={cl === "POSITIVA" ? "🌟" : cl === "NEGATIVA" ? "💙" : "👍"}
            title={cl === "POSITIVA" ? "Obrigado!" : "Avaliação registrada"}
            text={
              cl === "POSITIVA"
                ? "Ficamos muito felizes com a sua experiência! Até a próxima."
                : cl === "NEGATIVA"
                ? "Lamentamos pela experiência. Nossa equipe vai analisar seu feedback e entrar em contato em breve."
                : "Obrigado pelo seu feedback. Vamos trabalhar para melhorar cada vez mais."
            }
            classification={cl ?? "NEUTRA"}
            extra={cl === "NEGATIVA" ? (
              <div className="eval-alert eval-alert-warn" style={{ marginTop: 16, textAlign: "left" }}>
                <strong>Reclamação registrada.</strong> Nossa equipe de atendimento irá acompanhar o seu caso.
              </div>
            ) : undefined}
          />
        )}

        {status === "submit_error" && (
          <div className="eval-wrap">
            <div className="eval-alert eval-alert-error">{submitError}</div>
            <button
              className="eval-submit"
              onClick={() => { setSubmitError(""); setStatus("valid"); }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {(status === "valid" || status === "submitting") && linkInfo && (
          <EvalForm
            linkInfo={linkInfo}
            submitting={status === "submitting"}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </>
  );
}
