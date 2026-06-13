import { useEffect, useState } from "react";
import { api } from "../lib/api";

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

const PHASE_LABELS: Record<string, string> = {
  ATENDIMENTO: "Atendimento",
  ENTREGA: "Entrega",
  MONTAGEM: "Montagem",
};

function ScaleInput({ question, value, onChange }: { question: EvalQuestion; value: number | null; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            style={{
              width: 38, height: 38, borderRadius: "50%",
              border: `2px solid ${value === i ? "var(--brand)" : "var(--border)"}`,
              background: value === i ? "var(--brand)" : "var(--bg-secondary)",
              color: value === i ? "#fff" : "var(--text-primary)",
              fontWeight: value === i ? 700 : 400,
              fontSize: 14, cursor: "pointer",
            }}
          >
            {i}
          </button>
        ))}
      </div>
      {(question.minLabel || question.maxLabel) && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
          <span>{question.minLabel ?? ""}</span>
          <span>{question.maxLabel ?? ""}</span>
        </div>
      )}
    </div>
  );
}

function StarsInput({ question, value, onChange }: { question: EvalQuestion; value: number | null; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          style={{
            fontSize: 28, background: "none", border: "none", cursor: "pointer",
            color: value !== null && value >= star ? "#f57c00" : "var(--border)",
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function PublicEvaluationPage({ token }: { token: string }) {
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [answers, setAnswers]   = useState<Record<string, { text?: string; number?: number }>>({});
  const [comment, setComment]   = useState("");
  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState<any>(null);
  const [error, setError]       = useState("");

  useEffect(() => {
    api<LinkInfo>(`/public/eval/${token}`)
      .then(setLinkInfo)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function setAnswer(questionId: string, update: { text?: string; number?: number }) {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...update } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkInfo) return;

    // Validate required questions
    for (const q of linkInfo.config.questions) {
      if (!q.required) continue;
      const a = answers[q.id];
      if (q.type === "TEXT" && !a?.text?.trim()) {
        setError(`A pergunta "${q.label}" é obrigatória.`);
        return;
      }
      if ((q.type === "SCALE" || q.type === "STARS") && a?.number === undefined) {
        setError(`A pergunta "${q.label}" é obrigatória.`);
        return;
      }
    }

    setSubmitting(true);
    setError("");
    try {
      const answersPayload = linkInfo.config.questions.map((q) => ({
        questionId: q.id,
        valueText: answers[q.id]?.text,
        valueNumber: answers[q.id]?.number,
      })).filter((a) => a.valueText !== undefined || a.valueNumber !== undefined);

      const result = await api<any>(`/public/eval/${token}/respond`, {
        method: "POST",
        body: JSON.stringify({ answers: answersPayload, comment: comment || undefined }),
      });
      setDone(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="publicPage">Carregando avaliação...</main>;

  if (error && !linkInfo) {
    return (
      <main className="publicPage">
        <section className="publicHeader">
          <strong>App Montadores</strong>
          <h1>Avaliação</h1>
        </section>
        <section className="panel">
          <div className="error">{error}</div>
        </section>
      </main>
    );
  }

  if (done) {
    const cl = done.classification;
    return (
      <main className="publicPage">
        <section className="publicHeader">
          <strong>App Montadores</strong>
          <h1>{cl === "POSITIVA" ? "Obrigado!" : cl === "NEUTRA" ? "Avaliação registrada" : "Avaliação registrada"}</h1>
          <p>Sua avaliação foi enviada com sucesso.</p>
        </section>
        <section className="panel">
          {cl === "POSITIVA" && <p>Ficamos felizes com a sua experiência!</p>}
          {cl === "NEUTRA"   && <p>Obrigado pelo seu feedback. Vamos trabalhar para melhorar.</p>}
          {cl === "NEGATIVA" && <p>Lamentamos pela experiência. Nossa equipe vai analisar seu feedback.</p>}
        </section>
      </main>
    );
  }

  if (!linkInfo) return null;

  const phaseLabel = PHASE_LABELS[linkInfo.phase] ?? linkInfo.phase;

  return (
    <main className="publicPage">
      <section className="publicHeader">
        <strong>App Montadores</strong>
        <h1>{linkInfo.config.title}</h1>
        {linkInfo.order.customerName && <p>{linkInfo.order.customerName}</p>}
        {linkInfo.order.numped && <p>Pedido {linkInfo.order.numped}</p>}
        <p style={{ fontSize: 12, opacity: 0.7 }}>Fase: {phaseLabel}</p>
      </section>

      {linkInfo.config.description && (
        <section className="panel">
          <p style={{ fontSize: 14, color: "#475467", margin: 0 }}>{linkInfo.config.description}</p>
        </section>
      )}

      <section className="panel spacedPanel">
        <form onSubmit={submit}>
          {linkInfo.config.questions.map((q) => (
            <div key={q.id} style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 10, fontSize: 15 }}>
                {q.label}
                {q.required && <span style={{ color: "#b42318", marginLeft: 4 }}>*</span>}
              </label>
              {q.type === "SCALE" && (
                <ScaleInput
                  question={q}
                  value={answers[q.id]?.number ?? null}
                  onChange={(v) => setAnswer(q.id, { number: v })}
                />
              )}
              {q.type === "STARS" && (
                <StarsInput
                  question={q}
                  value={answers[q.id]?.number ?? null}
                  onChange={(v) => setAnswer(q.id, { number: v })}
                />
              )}
              {q.type === "TEXT" && (
                <textarea
                  value={answers[q.id]?.text ?? ""}
                  onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                  placeholder="Escreva sua resposta..."
                  rows={3}
                />
              )}
              {q.type === "SINGLE_CHOICE" && q.options && (
                <div style={{ display: "grid", gap: 6 }}>
                  {q.options.map((opt) => (
                    <label key={opt} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={answers[q.id]?.text === opt}
                        onChange={() => setAnswer(q.id, { text: opt })}
                      />
                      <span style={{ fontSize: 14 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          <label style={{ display: "grid", gap: 6, fontSize: 13, color: "#475467", marginBottom: 16 }}>
            Comentário adicional (opcional)
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Conte mais sobre sua experiência..."
              rows={3}
            />
          </label>

          {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

          <div className="actionsRow">
            <button type="submit" disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar avaliação"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
