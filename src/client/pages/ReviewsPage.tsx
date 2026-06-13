import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, MetricCard, Page, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

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

function PhaseCard({ phase, index }: { phase: Phase; index: number }) {
  const pct = phase.sent > 0 ? Math.round((phase.received / phase.sent) * 100) : 0;
  const c = PHASE_COLORS[phase.key] ?? PHASE_COLORS.MONTAGEM;
  const barColor = pct >= 70 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--danger)";

  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: "var(--bg)",
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      padding: "20px 22px",
    }}>
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

      {/* Breakdown */}
      {phase.received > 0 ? (
        <div style={{ display: "flex", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
          <span style={{ color: "var(--ok)",     fontWeight: 600 }}>✓ {phase.positive} positivas</span>
          <span style={{ color: "var(--warn)",   fontWeight: 600 }}>◑ {phase.neutral} neutras</span>
          <span style={{ color: "var(--danger)", fontWeight: 600 }}>✗ {phase.negative} negativas</span>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Nenhuma avaliação recebida ainda</div>
      )}
    </div>
  );
}

const PHASE_SECTIONS = [
  { key: "ATENDIMENTO", label: "1. Atendimento",   step: "Pedido criado no WinThor" },
  { key: "ENTREGA",     label: "2. Entrega",        step: "Pedido entregue" },
  { key: "MONTAGEM",    label: "3. Montagem",       step: "Montador executa serviço" },
];

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

export function ReviewsPage() {
  const [data, setData]       = useState<ReviewData>({ summary: null, reviews: [], phases: EMPTY_PHASES });
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  const [pendentes, setPendentes]           = useState<AtendimentoPendente[]>([]);
  const [pendentesTotal, setPendentesTotal] = useState(0);
  const [pendentesPage, setPendentesPage]   = useState(1);
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

  const byPhase = (key: string) => data.reviews.filter((r) => r.service_type === key);

  return (
    <Page
      title="Avaliações"
      subtitle="Funil de avaliações por fase — Atendimento · Entrega · Montagem"
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
          {/* ── 3-phase pipeline ── */}
          <div style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 24 }}>
            {data.phases.map((phase, i) => (
              <Fragment key={phase.key}>
                <PhaseCard phase={phase} index={i} />
                {i < data.phases.length - 1 && (
                  <div style={{ display: "flex", alignItems: "center", flexShrink: 0, color: "var(--text-muted)", fontSize: 22 }}>
                    →
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {/* ── Summary metrics ── */}
          <div className="metricsGrid" style={{ marginBottom: 32 }}>
            <MetricCard label="Total de avaliações" value={data.summary?.total ?? 0} />
            <MetricCard label="Nota média geral"    value={Number(data.summary?.averageScore ?? 0).toFixed(1)} />
            <MetricCard label="Positivas (9–10)"    value={data.summary?.positive ?? 0} tone="ok" />
            <MetricCard label="Neutras (7–8)"       value={data.summary?.neutral  ?? 0} tone="warn" />
            <MetricCard label="Negativas (0–6)"     value={data.summary?.negative ?? 0} tone="danger" />
          </div>

          {/* ── Separate review sections per phase ── */}
          {PHASE_SECTIONS.map((section) => {
            const c = PHASE_COLORS[section.key];
            const phaseReviews = byPhase(section.key);
            const idx = section.key === "ATENDIMENTO" ? "1" : section.key === "ENTREGA" ? "2" : "3";
            return (
              <div
                key={section.key}
                style={{
                  marginBottom: 28,
                  border: `1px solid ${c.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                {/* Section header */}
                <div style={{
                  background: c.bg,
                  borderBottom: `1px solid ${c.border}`,
                  padding: "14px 20px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "#fff", color: c.text,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 13, border: `2px solid ${c.border}`,
                    flexShrink: 0,
                  }}>
                    {idx}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: c.text }}>{section.label}</div>
                    <div style={{ fontSize: 12, color: c.text, opacity: 0.75 }}>{section.step}</div>
                  </div>
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 13, fontWeight: 600,
                    color: c.text,
                    background: "#fff",
                    border: `1px solid ${c.border}`,
                    borderRadius: 20,
                    padding: "3px 12px",
                  }}>
                    {phaseReviews.length} avaliação{phaseReviews.length !== 1 ? "ões" : ""}
                  </span>
                </div>

                {/* ATENDIMENTO: show WinThor pending orders before received reviews */}
                {section.key === "ATENDIMENTO" && (
                  <div style={{ borderBottom: `1px solid ${c.border}` }}>
                    <div style={{
                      padding: "10px 20px",
                      background: "#fffde7",
                      borderBottom: "1px solid #fff9c4",
                      fontSize: 13, fontWeight: 600, color: "#f57f17",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span>Pendentes de avaliação — WinThor (POSICAO=F, CONDVENDA=7)</span>
                      <span style={{
                        marginLeft: "auto", fontSize: 12, fontWeight: 700,
                        background: "#f57f17", color: "#fff",
                        borderRadius: 20, padding: "2px 10px",
                      }}>
                        {pendentesTotal}
                      </span>
                    </div>
                    <AtendimentoPendentesTable
                      rows={pendentes}
                      loading={pendentesLoading}
                      page={pendentesPage}
                      total={pendentesTotal}
                      pageSize={20}
                      onPage={loadPendentes}
                      onMarcar={handleMarcar}
                    />
                  </div>
                )}

                {/* Received evaluations */}
                <div style={{ padding: "0 0 4px" }}>
                  <ReviewTable reviews={phaseReviews} search={search} />
                </div>
              </div>
            );
          })}
        </>
      )}
    </Page>
  );
}
