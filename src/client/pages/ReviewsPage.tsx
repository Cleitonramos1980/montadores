import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, LoadingState, MetricCard, Page, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";
import { exportAnalyticsXlsx, exportConsolidatedXlsx, exportReviewsXlsx } from "../lib/exportXlsx";

type Phase = {
  key: string;
  label: string;
  description: string;
  triggerLabel: string;
  sent: number;
  received: number;
  avgScore: number;
  positive: number;
  neutral: number;
  negative: number;
  faturados: number;
  pendentes: number;
};

type AtendimentoPendente = {
  numped: string;
  data: string | null;
  vltotal: number;
  codcli: string;
  cliente: string;
  telent: string | null;
  codusur: string | null;
  nome_vendedor: string | null;
  enviada: number;
};

type ReviewData = {
  summary: { total: number; positive: number; neutral: number; negative: number; averageScore: number } | null;
  reviews: any[];
  phases: Phase[];
};

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ATENDIMENTO: { bg: "#e3f2fd", text: "#1565c0", border: "#90caf9" },
  ENTREGA:     { bg: "#f3e5f5", text: "#6a1b9a", border: "#ce93d8" },
  MONTAGEM:    { bg: "#e8f5e9", text: "#1b5e20", border: "#a5d6a7" },
};

const PHASE_STEP: Record<string, string> = {
  ATENDIMENTO: "Pedido criado no WinThor",
  ENTREGA:     "Pedido entregue",
  MONTAGEM:    "Montador executa serviço",
};

function scoreColor(score: number) {
  if (score <= 0) return "var(--text-muted)";
  if (score <= 6) return "var(--danger)";
  if (score <= 8) return "var(--warn)";
  return "var(--ok)";
}

const EMPTY_PHASES: Phase[] = [
  { key: "ATENDIMENTO", label: "Atendimento", description: "Pedido faturado no WinThor (CONDVENDA=7)", triggerLabel: "POSICAO=F · CONDVENDA=7",         sent: 0, received: 0, avgScore: 0, positive: 0, neutral: 0, negative: 0, faturados: 0, pendentes: 0 },
  { key: "ENTREGA",     label: "Entrega",      description: "Pedido entregue",                         triggerLabel: "ENTREGA REALIZADA",                sent: 0, received: 0, avgScore: 0, positive: 0, neutral: 0, negative: 0, faturados: 0, pendentes: 0 },
  { key: "MONTAGEM",    label: "Montagem",     description: "Montador executa serviço",                triggerLabel: "LINK AVALIAÇÃO MONTAGEM ENVIADO",  sent: 0, received: 0, avgScore: 0, positive: 0, neutral: 0, negative: 0, faturados: 0, pendentes: 0 },
];

function PhaseCard({ phase, index, selected, onClick }: {
  phase: Phase; index: number; selected?: boolean; onClick?: () => void;
}) {
  const pct = phase.sent > 0 ? Math.round((phase.received / phase.sent) * 100) : 0;
  const c = PHASE_COLORS[phase.key] ?? PHASE_COLORS.MONTAGEM;
  const barColor = pct >= 70 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--danger)";

  return (
    <div
      onClick={onClick}
      style={{
        flex: 1, minWidth: 0,
        background: "var(--bg)",
        border: selected ? `2px solid ${c.text}` : `1px solid ${c.border}`,
        borderRadius: 12,
        padding: selected ? "19px 21px" : "20px 22px",
        cursor: onClick ? "pointer" : undefined,
        boxShadow: selected ? `0 0 0 3px ${c.bg}` : undefined,
        transition: "border-color .15s, box-shadow .15s",
      }}
    >
      {/* Step number + title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: c.bg, color: c.text,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 13,
        }}>
          {index + 1}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: c.text }}>{phase.label}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{PHASE_STEP[phase.key]}</div>
        </div>
      </div>

      {/* Trigger status chip */}
      <div style={{
        display: "inline-block",
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
        color: c.text, background: c.bg, border: `1px solid ${c.border}`,
        borderRadius: 20, padding: "3px 10px",
        marginBottom: 16,
        textTransform: "uppercase",
      }}>
        {phase.triggerLabel}
      </div>

      {/* WinThor faturados + pendentes (only for ATENDIMENTO) */}
      {phase.key === "ATENDIMENTO" && phase.faturados > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>
            <strong style={{ color: c.text }}>{phase.faturados}</strong> faturados
          </span>
          <span style={{ color: "var(--warn)", fontWeight: 600 }}>
            {phase.pendentes} pendentes de avaliação
          </span>
        </div>
      )}

      {/* Funnel numbers */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Enviadas</div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{phase.sent}</div>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 18, marginBottom: 4 }}>→</div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Recebidas</div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{phase.received}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Nota média</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: scoreColor(phase.avgScore) }}>
            {phase.received > 0 ? phase.avgScore.toFixed(1) : "—"}
          </div>
        </div>
      </div>

      {/* Progress bar + conversion % */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ background: "var(--bg-secondary)", borderRadius: 6, height: 7, overflow: "hidden", marginBottom: 4 }}>
          <div style={{
            width: `${pct}%`, height: "100%", borderRadius: 6,
            background: barColor, transition: "width .4s ease",
          }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 600 }}>{pct}%</span> de conversão
        </div>
      </div>

      {/* Breakdown with percentages */}
      {phase.received > 0 ? (
        <div style={{ display: "grid", gap: 5 }}>
          {[
            { label: "Positivas (9–10)", count: phase.positive, color: "var(--ok)",     icon: "✓" },
            { label: "Neutras (7–8)",    count: phase.neutral,  color: "var(--warn)",   icon: "◑" },
            { label: "Negativas (0–6)",  count: phase.negative, color: "var(--danger)", icon: "✗" },
          ].map(({ label, count, color, icon }) => {
            const pctItem = phase.received > 0 ? Math.round((count / phase.received) * 100) : 0;
            return (
              <div key={label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                  <span style={{ color, fontWeight: 600 }}>{icon} {label}</span>
                  <span style={{ color, fontWeight: 700 }}>{pctItem}% <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({count})</span></span>
                </div>
                <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                  <div style={{ width: `${pctItem}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Nenhuma avaliação recebida ainda</div>
      )}

      {/* Click hint */}
      {onClick && (
        <div style={{
          marginTop: 12, textAlign: "center",
          fontSize: 11, color: c.text, opacity: 0.7,
          fontWeight: 600, letterSpacing: 0.3,
        }}>
          {selected ? "▲ Fechar relatório" : "▼ Ver relatório detalhado"}
        </div>
      )}
    </div>
  );
}


function ReviewTable({ reviews, search }: { reviews: any[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search) return reviews;
    const q = search.toLowerCase();
    return reviews.filter(
      (r) =>
        r.numped?.toLowerCase().includes(q) ||
        r.customer_name?.toLowerCase().includes(q) ||
        r.provider_name?.toLowerCase().includes(q),
    );
  }, [reviews, search]);

  if (filtered.length === 0) {
    return (
      <div style={{ padding: "20px 0", color: "var(--text-muted)", fontSize: 14, textAlign: "center" }}>
        {search ? "Nenhum resultado para a busca." : "Nenhuma avaliação recebida nesta fase ainda."}
      </div>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Pedido</th>
          <th>Cliente</th>
          <th>Montador</th>
          <th>Nota</th>
          <th>Classificação</th>
          <th>Comentário / Reclamação</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((review: any) => (
          <tr key={review.id}>
            <td><strong>{review.numped}</strong></td>
            <td>{review.customer_name}</td>
            <td>
              {review.provider_name
                ? review.provider_name
                : <span style={{ color: "var(--text-muted)" }}>—</span>}
            </td>
            <td>
              <strong style={{ fontSize: 18, color: scoreColor(review.score) }}>{review.score}</strong>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>/10</span>
            </td>
            <td><StatusBadge value={review.classification} /></td>
            <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {review.review_comment || review.complaint_reason
                || <span style={{ color: "var(--text-muted)" }}>—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("pt-BR"); } catch { return d; }
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
}

// ── Analytics types ────────────────────────────────────────────────────────────

type AnswerDist = { value: string; count: number; pct: number };

type QuestionStat = {
  questionId: string;
  label: string;
  type: string;
  position: number;
  minLabel: string | null;
  maxLabel: string | null;
  totalAnswered: number;
  distribution: AnswerDist[];
  textSamples?: string[];
};

type PhaseAnalytics = {
  phase: string;
  totalResponses: number;
  questions: QuestionStat[];
};

// ── DistBar ───────────────────────────────────────────────────────────────────

function DistBar({ d, color, maxPct }: { d: AnswerDist; color: string; maxPct: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <div style={{ width: 90, fontSize: 12, color: "var(--text-secondary)", textAlign: "right", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {d.value}
      </div>
      <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 16, overflow: "hidden" }}>
        <div style={{
          width: maxPct > 0 ? `${(d.pct / maxPct) * 100}%` : "0%",
          height: "100%", background: color, borderRadius: 4,
          transition: "width .4s ease",
          display: "flex", alignItems: "center", paddingLeft: 6,
        }}>
          {d.pct >= 12 && (
            <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{d.pct}%</span>
          )}
        </div>
      </div>
      <div style={{ width: 56, fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
        {d.pct < 12 && <span style={{ fontWeight: 700 }}>{d.pct}%</span>}
        <span style={{ color: "var(--text-muted)", marginLeft: 2 }}>({d.count})</span>
      </div>
    </div>
  );
}

// ── QuestionCard ──────────────────────────────────────────────────────────────

function QuestionCard({ q, phaseColor }: { q: QuestionStat; phaseColor: { bg: string; text: string; border: string } }) {
  const isScale = q.type === "SCALE" || q.type === "STARS";
  const isYesNo = q.type === "YES_NO";
  const isText  = q.type === "TEXT";

  // Build full SCALE 0-10 distribution (fill missing values with 0)
  const scaleDist = useMemo(() => {
    if (!isScale) return [];
    const map = new Map(q.distribution.map((d) => [d.value, d]));
    const max = q.type === "STARS" ? 5 : 10;
    return Array.from({ length: max + 1 }, (_, i) => {
      const key = String(i);
      return map.get(key) ?? { value: key, count: 0, pct: 0 };
    });
  }, [q, isScale]);

  const maxPct = Math.max(...(isScale ? scaleDist : q.distribution).map((d) => d.pct), 1);

  // color per value for SCALE
  function scaleColor(val: string) {
    const n = Number(val);
    if (q.type === "STARS") return n >= 4 ? "var(--ok)" : n >= 3 ? "var(--warn)" : "var(--danger)";
    return n >= 9 ? "var(--ok)" : n >= 7 ? "#42a5f5" : n >= 5 ? "var(--warn)" : "var(--danger)";
  }

  // YES_NO color
  function yesNoColor(val: string) {
    return val.toLowerCase().startsWith("sim") || val.toLowerCase() === "yes" ? "var(--ok)" : "var(--danger)";
  }

  // avg for scale
  const avg = useMemo(() => {
    if (!isScale || q.totalAnswered === 0) return null;
    const total = q.distribution.reduce((s, d) => s + Number(d.value) * d.count, 0);
    return (total / q.totalAnswered).toFixed(1);
  }, [q, isScale]);

  return (
    <div data-print-card style={{
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "16px 18px",
      marginBottom: 10,
    }}>
      {/* Question header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
          background: phaseColor.bg, color: phaseColor.text,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 11,
        }}>
          {q.position}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.3 }}>{q.label}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
              color: phaseColor.text, background: phaseColor.bg,
              border: `1px solid ${phaseColor.border}`, borderRadius: 20, padding: "2px 8px",
            }}>
              {q.type === "SCALE" ? "Escala 0–10" : q.type === "STARS" ? "Estrelas 1–5" : q.type === "YES_NO" ? "Sim / Não" : q.type === "SINGLE_CHOICE" ? "Múltipla escolha" : "Texto livre"}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{q.totalAnswered} resposta{q.totalAnswered !== 1 ? "s" : ""}</span>
            {avg !== null && (
              <span style={{ fontSize: 13, fontWeight: 700, color: scaleColor(String(Math.round(Number(avg)))) }}>
                média {avg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Distribution */}
      {isText ? (
        <div style={{ display: "grid", gap: 6 }}>
          {(q.textSamples ?? []).slice(0, 5).map((t, i) => (
            <div key={i} style={{
              fontSize: 13, color: "var(--text-secondary)",
              background: "var(--bg-secondary)", borderRadius: 6, padding: "7px 10px",
              borderLeft: `3px solid ${phaseColor.border}`,
            }}>
              {t}
            </div>
          ))}
          {!q.textSamples?.length && (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Nenhuma resposta de texto registrada.</div>
          )}
        </div>
      ) : isScale ? (
        <div>
          {q.type === "SCALE" && q.minLabel && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, paddingLeft: 98 }}>
              <span>{q.minLabel}</span><span>{q.maxLabel}</span>
            </div>
          )}
          {scaleDist.filter((d) => d.count > 0 || true).map((d) => (
            <DistBar key={d.value} d={d} color={scaleColor(d.value)} maxPct={maxPct} />
          ))}
        </div>
      ) : isYesNo ? (
        <div>
          {q.distribution.map((d) => (
            <DistBar key={d.value} d={d} color={yesNoColor(d.value)} maxPct={maxPct} />
          ))}
        </div>
      ) : (
        <div>
          {q.distribution.map((d) => (
            <DistBar key={d.value} d={d} color={phaseColor.text} maxPct={maxPct} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── PhaseDetailPanel ──────────────────────────────────────────────────────────

const PHASE_IDX: Record<string, string> = { ATENDIMENTO: "1", ENTREGA: "2", MONTAGEM: "3" };
const PHASE_STEP_LABEL: Record<string, string> = {
  ATENDIMENTO: "Pedido criado no WinThor",
  ENTREGA:     "Pedido entregue",
  MONTAGEM:    "Montador executa serviço",
};

function PhaseDetailPanel({
  phase, reviews, search,
  pendentes, pendentesTotal, pendentesPage, pendentesLoading, onPage, onMarcar,
}: {
  phase: Phase;
  reviews: any[];
  search: string;
  pendentes: AtendimentoPendente[];
  pendentesTotal: number;
  pendentesPage: number;
  pendentesLoading: boolean;
  onPage: (p: number) => void;
  onMarcar: (numped: string) => void;
}) {
  const c = PHASE_COLORS[phase.key] ?? PHASE_COLORS.MONTAGEM;
  const [analytics, setAnalytics]   = useState<PhaseAnalytics | null>(null);
  const [analyticsLoading, setAL]   = useState(false);
  const [analyticsError, setAE]     = useState<string | null>(null);
  const [tab, setTab]               = useState<"respostas" | "avaliacoes">("respostas");
  const loadedRef                   = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setAL(true);
    api<PhaseAnalytics>(`/eval-analytics?phase=${phase.key}`)
      .then(setAnalytics)
      .catch((e) => setAE(e.message))
      .finally(() => setAL(false));
  }, [phase.key]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", border: "none", borderRadius: "8px 8px 0 0",
    background: active ? "var(--bg)" : "transparent",
    color: active ? c.text : "var(--text-muted)",
    borderBottom: active ? `2px solid ${c.text}` : "2px solid transparent",
  });

  return (
    <div style={{
      marginBottom: 32,
      border: `2px solid ${c.text}`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: `0 4px 16px ${c.border}`,
    }}>
      {/* Header */}
      <div style={{
        background: c.bg,
        borderBottom: `1px solid ${c.border}`,
        padding: "14px 22px",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: c.text, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 14, flexShrink: 0,
        }}>
          {PHASE_IDX[phase.key]}
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: c.text }}>{phase.label}</div>
          <div style={{ fontSize: 12, color: c.text, opacity: 0.7 }}>{PHASE_STEP_LABEL[phase.key]}</div>
        </div>
        {/* Quick metrics */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 20, alignItems: "center" }}>
          {[
            { label: "Enviadas",  val: phase.sent },
            { label: "Recebidas", val: phase.received },
            { label: "Nota média", val: phase.received > 0 ? phase.avgScore.toFixed(1) : "—", color: scoreColor(phase.avgScore) },
            { label: "Conversão", val: phase.sent > 0 ? `${Math.round(phase.received / phase.sent * 100)}%` : "—" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: c.text, opacity: 0.65, marginBottom: 2 }}>{label}</div>
              <div style={{ fontWeight: 800, fontSize: 18, color: color ?? c.text, lineHeight: 1 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs + Export buttons */}
      <div style={{
        background: c.bg, borderBottom: `1px solid ${c.border}`,
        padding: "0 22px", display: "flex", gap: 4, alignItems: "flex-end",
      }}>
        <button style={tabStyle(tab === "respostas")} onClick={() => setTab("respostas")}>
          Respostas por pergunta
          {analytics && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 700,
              background: c.text, color: "#fff", borderRadius: 20, padding: "1px 7px",
            }}>
              {analytics.totalResponses}
            </span>
          )}
        </button>
        <button style={tabStyle(tab === "avaliacoes")} onClick={() => setTab("avaliacoes")}>
          Avaliações individuais
          <span style={{
            marginLeft: 8, fontSize: 11, fontWeight: 700,
            background: c.text, color: "#fff", borderRadius: 20, padding: "1px 7px",
          }}>
            {reviews.length}
          </span>
        </button>
        {phase.key === "ATENDIMENTO" && (
          <button style={tabStyle(false)} disabled
            title="WinThor pendentes visíveis na aba Avaliações individuais"
          >
            WinThor pendentes
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 700,
              background: "#f57f17", color: "#fff", borderRadius: 20, padding: "1px 7px",
            }}>
              {pendentesTotal}
            </span>
          </button>
        )}
        {/* Export buttons */}
        <div className="printHide" style={{ marginLeft: "auto", display: "flex", gap: 6, paddingBottom: 6 }}>
          <button
            onClick={() => window.print()}
            style={{
              fontSize: 12, fontWeight: 600, padding: "5px 12px",
              border: `1px solid ${c.border}`, borderRadius: 8, cursor: "pointer",
              background: "#fff", color: c.text, display: "flex", alignItems: "center", gap: 5,
            }}
            title="Exportar PDF"
          >
            🖨 PDF
          </button>
          <button
            onClick={() => {
              const fname = `avaliacoes-${phase.label.toLowerCase()}-${new Date().toISOString().slice(0,10)}`;
              if (tab === "respostas" && analytics) {
                exportAnalyticsXlsx(analytics, reviews, fname);
              } else {
                exportReviewsXlsx(reviews, fname);
              }
            }}
            style={{
              fontSize: 12, fontWeight: 600, padding: "5px 12px",
              border: `1px solid ${c.border}`, borderRadius: 8, cursor: "pointer",
              background: "#fff", color: c.text, display: "flex", alignItems: "center", gap: 5,
            }}
            title="Exportar Excel"
          >
            📊 Excel
          </button>
        </div>
      </div>

      {/* Tab: Respostas consolidadas por pergunta */}
      {tab === "respostas" && (
        <div style={{ padding: "20px 22px", background: "var(--bg-secondary)" }}>
          {analyticsLoading && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "12px 0" }}>Carregando análise das respostas...</div>
          )}
          {analyticsError && (
            <div style={{ color: "var(--danger)", fontSize: 13 }}>Erro ao carregar: {analyticsError}</div>
          )}
          {analytics && !analyticsLoading && analytics.totalResponses === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
              Nenhum formulário respondido nesta fase ainda.
            </div>
          )}
          {analytics && !analyticsLoading && analytics.questions.length > 0 && (
            <div>
              <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
                {analytics.totalResponses} formulário{analytics.totalResponses !== 1 ? "s" : ""} respondido{analytics.totalResponses !== 1 ? "s" : ""}
              </div>
              {analytics.questions.map((q) => (
                <QuestionCard key={q.questionId} q={q} phaseColor={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Avaliações individuais */}
      {tab === "avaliacoes" && (
        <div>
          {/* ATENDIMENTO: WinThor pending orders */}
          {phase.key === "ATENDIMENTO" && (
            <div style={{ borderBottom: `1px solid ${c.border}` }}>
              <div style={{
                padding: "10px 22px",
                background: "#fffde7", borderBottom: "1px solid #fff9c4",
                fontSize: 13, fontWeight: 600, color: "#f57f17",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>Pendentes de avaliação — WinThor (POSICAO=F, CONDVENDA=7)</span>
                <span style={{
                  marginLeft: "auto", fontSize: 12, fontWeight: 700,
                  background: "#f57f17", color: "#fff", borderRadius: 20, padding: "2px 10px",
                }}>
                  {pendentesTotal}
                </span>
              </div>
              <AtendimentoPendentesTable
                rows={pendentes} loading={pendentesLoading}
                page={pendentesPage} total={pendentesTotal} pageSize={20}
                onPage={onPage} onMarcar={onMarcar}
              />
            </div>
          )}
          <div style={{ padding: "0 0 4px" }}>
            <ReviewTable reviews={reviews} search={search} />
          </div>
        </div>
      )}
    </div>
  );
}

function AtendimentoPendentesTable({
  rows, loading, page, total, pageSize, onPage, onMarcar,
}: {
  rows: AtendimentoPendente[];
  loading: boolean;
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onMarcar: (numped: string) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (loading) return <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Carregando pendentes...</div>;
  if (rows.length === 0) return (
    <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
      Nenhum pedido faturado pendente de avaliação.
    </div>
  );
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Telefone</th>
            <th>Vendedor</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.numped}>
              <td><strong>{r.numped}</strong></td>
              <td style={{ fontSize: 13 }}>{fmtDate(r.data)}</td>
              <td style={{ fontSize: 13 }}>{r.cliente}</td>
              <td style={{ fontSize: 13 }}>{r.telent || "—"}</td>
              <td style={{ fontSize: 13 }}>{r.nome_vendedor || "—"}</td>
              <td style={{ fontSize: 13 }}>{fmtCurrency(r.vltotal)}</td>
              <td>
                {r.enviada ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ok)", background: "#e8f5e9", borderRadius: 20, padding: "2px 8px" }}>Enviada</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--warn)", background: "#fff8e1", borderRadius: 20, padding: "2px 8px" }}>Pendente</span>
                )}
              </td>
              <td>
                {!r.enviada && (
                  <button
                    className="ghostButton"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => onMarcar(r.numped)}
                  >
                    Marcar enviado
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <button className="ghostButton" style={{ fontSize: 12 }} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Anterior</button>
          <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>{page} / {totalPages}</span>
          <button className="ghostButton" style={{ fontSize: 12 }} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Próxima →</button>
        </div>
      )}
    </div>
  );
}

type ConsolidatedFilter = "all" | "POSITIVA" | "NEUTRA" | "NEGATIVA";

function ConsolidatedPanel({
  reviews, filter, search,
}: {
  reviews: any[];
  filter: ConsolidatedFilter;
  search: string;
}) {
  const FILTER_LABELS: Record<ConsolidatedFilter, string> = {
    all:      "Todas as avaliações",
    POSITIVA: "Avaliações Positivas (9–10)",
    NEUTRA:   "Avaliações Neutras (7–8)",
    NEGATIVA: "Avaliações Negativas (0–6)",
  };
  const FILTER_COLORS: Record<ConsolidatedFilter, string> = {
    all:      "var(--brand)",
    POSITIVA: "var(--ok)",
    NEUTRA:   "var(--warn)",
    NEGATIVA: "var(--danger)",
  };

  const filtered = useMemo(() => {
    let list = filter === "all" ? reviews : reviews.filter((r) => r.classification === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.numped?.toLowerCase().includes(q) ||
          r.customer_name?.toLowerCase().includes(q) ||
          r.provider_name?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [reviews, filter, search]);

  const color = FILTER_COLORS[filter];
  const label = FILTER_LABELS[filter];

  return (
    <div style={{
      marginBottom: 32,
      border: `2px solid ${color}`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: `0 4px 16px color-mix(in srgb, ${color} 20%, transparent)`,
    }}>
      {/* Header */}
      <div style={{
        background: `color-mix(in srgb, ${color} 10%, white)`,
        borderBottom: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        padding: "14px 22px",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{ fontWeight: 800, fontSize: 16, color }}>
          {label}
        </div>
        <span style={{
          fontSize: 13, fontWeight: 700,
          background: color, color: "#fff",
          borderRadius: 20, padding: "3px 14px",
        }}>
          {filtered.length} avaliação{filtered.length !== 1 ? "ões" : ""}
        </span>
        {/* Export */}
        <div className="printHide" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => window.print()}
            style={{
              fontSize: 12, fontWeight: 600, padding: "5px 12px",
              border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer",
              background: "#fff", color: "var(--text-secondary)",
            }}
          >
            🖨 PDF
          </button>
          <button
            onClick={() => {
              const fname = `relatorio-${filter}-${new Date().toISOString().slice(0,10)}`;
              exportConsolidatedXlsx(reviews, filter, fname);
            }}
            style={{
              fontSize: 12, fontWeight: 600, padding: "5px 12px",
              border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer",
              background: "#fff", color: "var(--text-secondary)",
            }}
          >
            📊 Excel
          </button>
        </div>
      </div>

      {/* Breakdown by phase */}
      {["ATENDIMENTO", "ENTREGA", "MONTAGEM"].map((phase) => {
        const phaseReviews = filtered.filter((r) => r.service_type === phase || r.phase === phase);
        if (phaseReviews.length === 0) return null;
        const c = PHASE_COLORS[phase];
        const phaseLabel = phase === "ATENDIMENTO" ? "Atendimento" : phase === "ENTREGA" ? "Entrega" : "Montagem";
        return (
          <div key={phase} style={{ borderBottom: `1px solid var(--border)` }}>
            <div style={{
              background: c.bg, padding: "8px 22px",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13, fontWeight: 600, color: c.text,
            }}>
              <span>{phaseLabel}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, background: c.text, color: "#fff",
                borderRadius: 20, padding: "1px 8px",
              }}>{phaseReviews.length}</span>
            </div>
            <div style={{ padding: "0 0 4px" }}>
              <ReviewTable reviews={phaseReviews} search="" />
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ padding: "28px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          Nenhuma avaliação encontrada.
        </div>
      )}
    </div>
  );
}

export function ReviewsPage() {
  const [data, setData]                   = useState<ReviewData>({ summary: null, reviews: [], phases: EMPTY_PHASES });
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState("");
  const [selectedPhaseKey, setSelected]   = useState<string | null>(null);
  const [consolidatedFilter, setConsolidatedFilter] = useState<ConsolidatedFilter | null>(null);

  const [pendentes, setPendentes]               = useState<AtendimentoPendente[]>([]);
  const [pendentesTotal, setPendentesTotal]     = useState(0);
  const [pendentesPage, setPendentesPage]       = useState(1);
  const [pendentesLoading, setPendentesLoading] = useState(false);

  const toast = useToast();

  const loadPendentes = useCallback((page: number) => {
    setPendentesLoading(true);
    api<{ rows: AtendimentoPendente[]; total: number }>(`/reviews/atendimento/pendentes?page=${page}&pageSize=20`)
      .then((r) => { setPendentes(r.rows); setPendentesTotal(r.total); setPendentesPage(page); })
      .catch(() => {})
      .finally(() => setPendentesLoading(false));
  }, []);

  useEffect(() => {
    api<ReviewData>("/reviews")
      .then((d) => setData({ ...d, phases: d.phases?.length ? d.phases : EMPTY_PHASES }))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
    loadPendentes(1);
  }, [loadPendentes]);

  const handleMarcar = useCallback((numped: string) => {
    api(`/reviews/atendimento/${numped}/marcar-enviado`, { method: "POST" })
      .then(() => { toast(`Pedido ${numped} marcado como enviado`, "success"); loadPendentes(pendentesPage); })
      .catch((err) => toast(err.message, "error"));
  }, [pendentesPage, loadPendentes, toast]);

  const selectedPhase = data.phases.find((p) => p.key === selectedPhaseKey) ?? null;
  const byPhase = (key: string) => data.reviews.filter((r) => r.service_type === key || r.phase === key);

  const handleCardClick = (key: string) => {
    setSelected((prev) => prev === key ? null : key);
    setConsolidatedFilter(null);
  };

  const handleMetricClick = (filter: ConsolidatedFilter) => {
    setConsolidatedFilter((prev) => prev === filter ? null : filter);
    setSelected(null);
  };

  return (
    <Page
      title="Avaliações"
      subtitle="Funil de avaliações por fase — clique em um card para ver o relatório detalhado"
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar pedido, cliente, montador..." />
          <a
            href="/montadores/eval-config"
            style={{
              padding: "6px 14px", fontSize: 13, fontWeight: 600,
              color: "var(--brand)", border: "1px solid var(--brand)",
              borderRadius: 20, textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            ⚙ Configuração
          </a>
        </div>
      }
    >
      {loading ? (
        <LoadingState message="Carregando avaliações..." />
      ) : (
        <>
          {/* ── 3-phase pipeline (clickable) ── */}
          <div data-phase-pipeline style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 16 }}>
            {data.phases.map((phase, i) => (
              <Fragment key={phase.key}>
                <PhaseCard
                  phase={phase}
                  index={i}
                  selected={selectedPhaseKey === phase.key}
                  onClick={() => handleCardClick(phase.key)}
                />
                {i < data.phases.length - 1 && (
                  <div style={{ display: "flex", alignItems: "center", flexShrink: 0, color: "var(--text-muted)", fontSize: 22 }}>
                    →
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {/* ── Summary metrics (clicáveis) ── */}
          <div className="metricsGrid" style={{ marginBottom: 28 }}>
            <MetricCard
              label="Total de avaliações" value={data.summary?.total ?? 0}
              onClick={() => handleMetricClick("all")}
              active={consolidatedFilter === "all"}
            />
            <MetricCard
              label="Nota média geral" value={Number(data.summary?.averageScore ?? 0).toFixed(1)}
              onClick={() => handleMetricClick("all")}
              active={consolidatedFilter === "all"}
            />
            <MetricCard
              label="Positivas (9–10)" value={data.summary?.positive ?? 0} tone="ok"
              onClick={() => handleMetricClick("POSITIVA")}
              active={consolidatedFilter === "POSITIVA"}
            />
            <MetricCard
              label="Neutras (7–8)" value={data.summary?.neutral ?? 0} tone="warn"
              onClick={() => handleMetricClick("NEUTRA")}
              active={consolidatedFilter === "NEUTRA"}
            />
            <MetricCard
              label="Negativas (0–6)" value={data.summary?.negative ?? 0} tone="danger"
              onClick={() => handleMetricClick("NEGATIVA")}
              active={consolidatedFilter === "NEGATIVA"}
            />
          </div>

          {/* ── Consolidated panel (shown when a metric card is clicked) ── */}
          {consolidatedFilter && (
            <ConsolidatedPanel
              reviews={data.reviews}
              filter={consolidatedFilter}
              search={search}
            />
          )}

          {/* ── Phase detail panel (shown when a phase card is selected) ── */}
          {selectedPhase && (
            <PhaseDetailPanel
              key={selectedPhase.key}
              phase={selectedPhase}
              reviews={byPhase(selectedPhase.key)}
              search={search}
              pendentes={pendentes}
              pendentesTotal={pendentesTotal}
              pendentesPage={pendentesPage}
              pendentesLoading={pendentesLoading}
              onPage={loadPendentes}
              onMarcar={handleMarcar}
            />
          )}

          {/* ── No selection hint ── */}
          {!selectedPhase && (
            <div style={{
              textAlign: "center", padding: "28px 0",
              color: "var(--text-muted)", fontSize: 14,
              border: "1px dashed var(--border)", borderRadius: 12,
            }}>
              Clique em um dos cards acima para ver o relatório detalhado da fase
            </div>
          )}
        </>
      )}
    </Page>
  );
}
