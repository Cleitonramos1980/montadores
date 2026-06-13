import { useEffect, useState } from "react";
import { api } from "../lib/api";

const COMPLAINT_REASONS = [
  "Montagem incorreta",
  "Produto com defeito",
  "Montador não compareceu",
  "Serviço incompleto",
  "Falta de profissionalismo",
  "Dano ao produto ou imóvel",
  "Outro",
];

export function PublicReviewPage({ token }: { token: string }) {
  const [order, setOrder] = useState<any>();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [complaintReason, setComplaintReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<any>(`/public/journey/${token}`).then(setOrder).catch((err) => setError(err.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score === null) { setError("Selecione uma nota de 0 a 10."); return; }
    if (score <= 6 && !complaintReason) { setError("Informe o motivo para notas abaixo de 7."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await api<any>(`/public/reviews/${token}/assembly`, {
        method: "POST",
        body: JSON.stringify({ score, comment: comment || undefined, complaintReason: complaintReason || undefined }),
      });
      setDone(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (error && !order) return <main className="publicPage"><div className="error">{error}</div></main>;
  if (!order) return <main className="publicPage">Carregando...</main>;

  const alreadyReviewed = order.reviews?.some((r: any) => r.service_type === "MONTAGEM");

  if (alreadyReviewed || done) {
    const classification = done?.classification ?? order.reviews?.find((r: any) => r.service_type === "MONTAGEM")?.classification;
    const payment = done?.payment;
    return (
      <main className="publicPage">
        <section className="publicHeader">
          <strong>App Montadores</strong>
          <h1>Avaliação registrada!</h1>
          <p>Obrigado pela sua avaliação do pedido <strong>{order.numped}</strong>.</p>
        </section>
        <section className="panel">
          {classification === "POSITIVA" && (
            <>
              <h2>Muito obrigado!</h2>
              <p>Sua avaliação positiva foi registrada.{payment === "LIBERADO" ? " O pagamento ao montador foi liberado automaticamente." : ""}</p>
            </>
          )}
          {classification === "NEUTRA" && (
            <>
              <h2>Avaliação registrada</h2>
              <p>Recebemos sua avaliação. Nosso time irá analisar para sempre melhorar o serviço.</p>
            </>
          )}
          {classification === "NEGATIVA" && (
            <>
              <h2>Lamentamos pela experiência</h2>
              <p>Um caso SAC foi aberto e nosso time entrará em contato para resolver sua situação. O pagamento está bloqueado até a resolução.</p>
            </>
          )}
          <div className="actionsRow" style={{ marginTop: 16 }}>
            <a className="ghostButton" href={`/montadores/jornada-publica/${token}`}>Ver minha jornada</a>
          </div>
        </section>
      </main>
    );
  }

  const classification = score === null ? null : score <= 6 ? "NEGATIVA" : score <= 8 ? "NEUTRA" : "POSITIVA";
  const classColor = classification === "POSITIVA" ? "#067647" : classification === "NEGATIVA" ? "#b42318" : "#93370d";

  return (
    <main className="publicPage">
      <section className="publicHeader">
        <strong>App Montadores</strong>
        <h1>Como foi a montagem?</h1>
        <p>Pedido {order.numped} — {order.customer_name}</p>
      </section>

      {order.items?.length > 0 && (
        <section className="panel">
          <h2>Produtos montados</h2>
          {order.items.filter((i: any) => i.requires_assembly).map((item: any) => (
            <p key={item.id}><strong>{item.quantity}x</strong> {item.description}</p>
          ))}
        </section>
      )}

      <section className="panel spacedPanel">
        <form onSubmit={submit}>
          <h2>De 0 a 10, qual nota você dá para o serviço?</h2>
          <div className="scoreGrid">
            {Array.from({ length: 11 }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`scoreBtn${score === i ? " scoreSelected" : ""}${i <= 6 ? " scoreDanger" : i <= 8 ? " scoreWarn" : " scoreOk"}`}
                onClick={() => { setScore(i); setError(""); }}
              >
                {i}
              </button>
            ))}
          </div>
          {score !== null && (
            <p style={{ color: classColor, fontWeight: 700, marginTop: 12 }}>
              {classification === "POSITIVA" ? "Ótima experiência!" : classification === "NEUTRA" ? "Experiência razoável." : "Experiência negativa."}
            </p>
          )}

          {score !== null && score <= 8 && (
            <label style={{ marginTop: 16, display: "grid", gap: 6, fontSize: 13, color: "#475467" }}>
              Motivo {score <= 6 ? "(obrigatório)" : "(opcional)"}
              <select value={complaintReason} onChange={(e) => setComplaintReason(e.target.value)}>
                <option value="">Selecione...</option>
                {COMPLAINT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}

          <label style={{ marginTop: 16, display: "grid", gap: 6, fontSize: 13, color: "#475467" }}>
            Comentário (opcional)
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Conte mais sobre sua experiência..."
            />
          </label>

          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

          <div className="actionsRow" style={{ marginTop: 16 }}>
            <button type="submit" disabled={loading || score === null}>
              {loading ? "Enviando..." : score !== null && score <= 6 ? "Registrar reclamação" : "Enviar avaliação"}
            </button>
            <a className="ghostButton" href={`/montadores/jornada-publica/${token}`}>Voltar</a>
          </div>
        </form>
      </section>
    </main>
  );
}
