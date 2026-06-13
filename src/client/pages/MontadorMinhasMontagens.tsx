import { useEffect, useReducer, useState } from "react";
import { LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(val: unknown): string {
  if (!val) return "—";
  try { return new Date(String(val)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return "—"; }
}

function fmtDatetime(val: unknown): string {
  if (!val) return "—";
  try { return new Date(String(val)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

function fmtCurrency(val: unknown): string {
  const n = Number(val ?? 0);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseAddress(raw: unknown): string {
  if (!raw) return "—";
  try {
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    return [a.street, a.city, a.uf].filter(Boolean).join(", ") || "—";
  } catch { return "—"; }
}

const PERIOD_LABELS: Record<string, string> = {
  "":           "Todo período",
  HOJE:         "Hoje",
  ONTEM:        "Ontem",
  SEMANA:       "Esta semana",
  MES:          "Este mês",
  PERSONALIZADO:"Personalizado",
};

const STATUS_COLORS: Record<string, React.CSSProperties> = {
  FINALIZADA:              { background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" },
  EM_EXECUCAO:             { background: "#fff8e1", color: "#f57f17", border: "1px solid #ffe082" },
  AGENDADA:                { background: "#e3f2fd", color: "#1565c0", border: "1px solid #90caf9" },
  CANCELADA:               { background: "#fce4ec", color: "#b71c1c", border: "1px solid #f48fb1" },
  AGUARDANDO_AGENDAMENTO:  { background: "var(--bg-secondary)", color: "var(--text-muted)", border: "1px solid var(--border)" },
};

const PAY_COLORS: Record<string, React.CSSProperties> = {
  PAGO:                       { background: "#e8f5e9", color: "#1b5e20" },
  LIBERADO:                   { background: "#e8f5e9", color: "#2e7d32" },
  PROGRAMADO:                 { background: "#e3f2fd", color: "#1565c0" },
  BLOQUEADO:                  { background: "#fce4ec", color: "#b71c1c" },
  AGUARDANDO_FINALIZACAO:     { background: "#fff8e1", color: "#e65100" },
  AGUARDANDO_AVALIACAO_CLIENTE: { background: "#f3e5f5", color: "#6a1b9a" },
};

const PAY_LABELS: Record<string, string> = {
  PAGO:                         "Pago",
  LIBERADO:                     "Liberado",
  PROGRAMADO:                   "Programado",
  BLOQUEADO:                    "Bloqueado",
  AGUARDANDO_FINALIZACAO:       "Aguardando finalização",
  AGUARDANDO_AVALIACAO_CLIENTE: "Aguardando avaliação",
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: "var(--bg-card)",
      border: `1px solid ${accent ?? "var(--border)"}`,
      borderRadius: 10,
      padding: "14px 16px",
      minWidth: 140,
      flex: "0 0 auto",
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--text-primary)", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Job card (list) ─────────────────────────────────────────────────────────

function JobCard({ job, onClick }: { job: any; onClick: () => void }) {
  const hasComplaint = !!job.complaint_reason;
  const payStatus    = String(job.payment_status ?? "");
  const score        = job.score != null ? Number(job.score) : null;

  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "var(--bg-card)",
        border: hasComplaint ? "1.5px solid #f48fb1" : "1px solid var(--border)",
        borderRadius: 10, padding: "14px 16px", cursor: "pointer",
        transition: "box-shadow .15s",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Pedido {job.numped}</strong>
          {hasComplaint && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: "#fce4ec", color: "#b71c1c", border: "1px solid #f48fb1", borderRadius: 4, padding: "1px 6px" }}>
              ⚠ reclamação
            </span>
          )}
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{job.customer_name}</div>
          {(job.city || job.uf) && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>📍 {[job.city, job.uf].filter(Boolean).join(" — ")}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6, ...STATUS_COLORS[job.status] }}>
            {job.status?.replace(/_/g, " ")}
          </span>
          {payStatus && (
            <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, ...PAY_COLORS[payStatus] }}>
              {PAY_LABELS[payStatus] ?? payStatus}
            </div>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "var(--text-muted)" }}>
        <span>📅 {fmtDate(job.finished_at ?? job.scheduled_date)}</span>
        <span>📦 {Number(job.item_qty ?? 0)} produto(s)</span>
        <span>📷 {Number(job.photo_count ?? 0)} foto(s)</span>
        {score != null && (
          <span style={{ color: score >= 7 ? "#2e7d32" : score >= 5 ? "#e65100" : "#b71c1c", fontWeight: 600 }}>
            ⭐ {score.toFixed(1)}
          </span>
        )}
        {job.sac_status && (
          <span style={{ color: "#6a1b9a", fontWeight: 600 }}>🔵 SAC: {job.sac_status}</span>
        )}
      </div>
    </button>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────────

function JobDetail({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const [job, setJob]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");
  const toast = useToast();

  useEffect(() => {
    api<any>(`/montador/minhas-montagens/${jobId}`)
      .then(setJob)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <LoadingState message="Carregando detalhes..." />;
  if (error) return (
    <div style={{ padding: 20 }}>
      <button className="ghostButton" onClick={onBack} style={{ marginBottom: 16 }}>← Voltar</button>
      <div className="errorState">{error}</div>
    </div>
  );
  if (!job) return null;

  const payStatus = String(job.payment_status ?? "");
  const score     = job.score != null ? Number(job.score) : null;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 0 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingTop: 4 }}>
        <button className="ghostButton" onClick={onBack}>← Voltar</button>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 6, ...STATUS_COLORS[job.status] }}>
          {job.status?.replace(/_/g, " ")}
        </span>
      </div>

      {/* Pedido */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>Pedido #{job.numped}</h2>
        <dl className="descList">
          <dt>Cliente</dt><dd><strong>{job.customer_name}</strong></dd>
          <dt>Telefone</dt><dd>{job.customer_phone ?? "—"}</dd>
          <dt>Endereço</dt><dd>{parseAddress(job.address_json)}</dd>
          <dt>Cidade / UF</dt><dd>{[job.city, job.uf].filter(Boolean).join(" — ") || "—"}</dd>
          {job.scheduled_date && (
            <><dt>Agendado</dt><dd>{fmtDate(job.scheduled_date + "T12:00:00")} — {job.scheduled_period === "MANHA" ? "Manhã" : "Tarde"}</dd></>
          )}
          <dt>Iniciado em</dt><dd>{fmtDatetime(job.started_at)}</dd>
          <dt>Finalizado em</dt><dd>{fmtDatetime(job.finished_at)}</dd>
          {job.notes && <><dt>Observações</dt><dd>{job.notes}</dd></>}
        </dl>
      </div>

      {/* Produtos */}
      {Array.isArray(job.items) && job.items.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📦 Produtos montados</h3>
          {job.items.map((item: any, i: number) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{item.description}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.product_id}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 600 }}>Qtd: {item.quantity}</div>
                {Number(item.assembly_cost) > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtCurrency(item.assembly_cost)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fotos */}
      {Array.isArray(job.photos) && job.photos.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📷 Fotos ({job.photos.length})</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
            {job.photos.map((p: any, i: number) => (
              <a key={i} href={p.file_url} target="_blank" rel="noreferrer"
                style={{ display: "block", background: "var(--bg-secondary)", borderRadius: 6, padding: 8, fontSize: 12, color: "var(--brand)", textAlign: "center", wordBreak: "break-all" }}>
                📷 Foto {i + 1}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Avaliação */}
      {score != null && (
        <div className="panel" style={{ marginBottom: 12, background: score >= 7 ? "#f1f8e9" : score >= 5 ? "#fff8e1" : "#fce4ec" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>⭐ Avaliação do cliente</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: score >= 7 ? "#2e7d32" : score >= 5 ? "#e65100" : "#b71c1c" }}>{score.toFixed(1)}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>{job.classification}</span>
          </div>
          {job.review_comment && (
            <p style={{ margin: "10px 0 0", fontSize: 14, fontStyle: "italic", color: "var(--text-secondary)" }}>
              "{job.review_comment}"
            </p>
          )}
          {job.complaint_reason && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "#fce4ec", border: "1px solid #f48fb1", borderRadius: 6, fontSize: 13, color: "#b71c1c" }}>
              ⚠ <strong>Reclamação:</strong> {job.complaint_reason}
            </div>
          )}
        </div>
      )}

      {/* SAC */}
      {job.sac_id && (
        <div className="panel" style={{ marginBottom: 12, background: "#f3e5f5" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>🔵 Caso SAC</h3>
          <dl className="descList">
            <dt>Status</dt><dd style={{ fontWeight: 700, color: "#6a1b9a" }}>{job.sac_status}</dd>
            <dt>Motivo</dt><dd>{job.sac_reason}</dd>
            {job.sac_description && <><dt>Descrição</dt><dd>{job.sac_description}</dd></>}
          </dl>
        </div>
      )}

      {/* Pagamento */}
      {payStatus && (
        <div className="panel" style={{ marginBottom: 12, ...PAY_COLORS[payStatus] && { background: "var(--bg-card)" } }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>💰 Pagamento</h3>
          <dl className="descList">
            <dt>Status</dt>
            <dd>
              <span style={{ fontWeight: 700, padding: "2px 10px", borderRadius: 6, ...PAY_COLORS[payStatus] }}>
                {PAY_LABELS[payStatus] ?? payStatus}
              </span>
            </dd>
            {Number(job.payment_amount) > 0 && <><dt>Valor</dt><dd><strong>{fmtCurrency(job.payment_amount)}</strong></dd></>}
            {job.payment_programmed_for && <><dt>Previsto para</dt><dd>{fmtDate(job.payment_programmed_for)}</dd></>}
            {job.payment_paid_at && <><dt>Pago em</dt><dd>{fmtDatetime(job.payment_paid_at)}</dd></>}
            {job.payment_blocked_reason && (
              <><dt>Motivo do bloqueio</dt><dd style={{ color: "#b71c1c" }}>{job.payment_blocked_reason}</dd></>
            )}
          </dl>
          {job.invoice_url && (
            <div style={{ marginTop: 12 }}>
              <a href={job.invoice_url} target="_blank" rel="noreferrer"
                style={{ color: "var(--brand)", fontSize: 14 }}>
                📎 Ver nota fiscal
              </a>
              {job.invoice_submitted_at && (
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>enviada {fmtDate(job.invoice_submitted_at)}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {Array.isArray(job.events) && job.events.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>🕐 Histórico de eventos</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {job.events.map((ev: any, i: number) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", flexShrink: 0, marginTop: 5 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{String(ev.type ?? "").replace(/_/g, " ")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDatetime(ev.created_at)} — {ev.origin}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

type Filters = {
  periodo: string;
  dataInicio: string;
  dataFim: string;
  statusMontagem: string;
  statusPagamento: string;
  comReclamacao: string;
};

const EMPTY_FILTERS: Filters = {
  periodo: "", dataInicio: "", dataFim: "",
  statusMontagem: "", statusPagamento: "", comReclamacao: "",
};

function FiltersBar({
  filters, onChange, onSearch,
}: {
  filters: Filters;
  onChange: (f: Partial<Filters>) => void;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const f = (key: keyof Filters, val: string) => onChange({ [key]: val });

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Period chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {Object.entries(PERIOD_LABELS).filter(([k]) => k !== "PERSONALIZADO").map(([key, label]) => {
          const active = filters.periodo === key;
          return (
            <button key={key} onClick={() => { f("periodo", key); if (key !== "PERSONALIZADO") onSearch(); }}
              style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                background: active ? "var(--brand)" : "var(--bg-secondary)",
                color: active ? "#fff" : "var(--text-secondary)",
                fontWeight: active ? 700 : 400,
              }}>
              {label}
            </button>
          );
        })}
        <button onClick={() => setOpen((v) => !v)}
          style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
            border: `1px solid ${open ? "var(--brand)" : "var(--border)"}`,
            background: open ? "var(--brand-light)" : "var(--bg-secondary)",
            color: open ? "var(--brand)" : "var(--text-secondary)",
          }}>
          {open ? "▲ Filtros" : "▼ Filtros"}
        </button>
      </div>

      {/* Expanded filters */}
      {open && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
          {filters.periodo === "PERSONALIZADO" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                De
                <input type="date" value={filters.dataInicio} onChange={(e) => f("dataInicio", e.target.value)} style={{ fontSize: 13 }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Até
                <input type="date" value={filters.dataFim} onChange={(e) => f("dataFim", e.target.value)} style={{ fontSize: 13 }} />
              </label>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Status da montagem
              <select value={filters.statusMontagem} onChange={(e) => f("statusMontagem", e.target.value)} style={{ fontSize: 13 }}>
                <option value="">Todos</option>
                <option value="FINALIZADA">Finalizada</option>
                <option value="EM_EXECUCAO">Em execução</option>
                <option value="AGENDADA">Agendada</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Status do pagamento
              <select value={filters.statusPagamento} onChange={(e) => f("statusPagamento", e.target.value)} style={{ fontSize: 13 }}>
                <option value="">Todos</option>
                <option value="PAGO">Pago</option>
                <option value="LIBERADO">Liberado</option>
                <option value="PROGRAMADO">Programado</option>
                <option value="BLOQUEADO">Bloqueado</option>
                <option value="AGUARDANDO_FINALIZACAO">Aguardando finalização</option>
              </select>
            </label>
          </div>
          <label className="inlineCheck" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={filters.comReclamacao === "true"}
              onChange={(e) => f("comReclamacao", e.target.checked ? "true" : "")} />
            Somente com reclamação
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onSearch} style={{ flex: 1, padding: "8px", background: "var(--brand)", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              Aplicar filtros
            </button>
            <button onClick={() => { onChange(EMPTY_FILTERS); onSearch(); }}
              style={{ padding: "8px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type ListState = {
  rows: any[];
  total: number;
  page: number;
  pageSize: number;
};

export function MontadorMinhasMontagens() {
  const [resumo, setResumo]       = useState<any>(null);
  const [list, setList]           = useState<ListState>({ rows: [], total: 0, page: 1, pageSize: 20 });
  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingList, setLoadingList]     = useState(true);
  const [errorMsg, setErrorMsg]   = useState("");
  const [filters, setFilters]     = useState<Filters>(EMPTY_FILTERS);
  const [detailId, setDetailId]   = useState<string | null>(null);
  const toast = useToast();

  // force re-fetch counter
  const [fetchCount, dispatch] = useReducer((s: number) => s + 1, 0);

  async function loadResumo(f: Filters) {
    setLoadingResumo(true);
    try {
      const params = buildParams(f);
      const data   = await api<any>(`/montador/minhas-montagens/resumo?${params}`);
      setResumo(data);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingResumo(false);
    }
  }

  async function loadList(f: Filters, page = 1) {
    setLoadingList(true);
    try {
      const params = buildParams(f, page);
      const data   = await api<ListState>(`/montador/minhas-montagens?${params}`);
      setList(data);
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setLoadingList(false);
    }
  }

  function buildParams(f: Filters, page = 1): string {
    const p = new URLSearchParams();
    if (f.periodo)         p.set("periodo",         f.periodo);
    if (f.dataInicio)      p.set("dataInicio",       f.dataInicio);
    if (f.dataFim)         p.set("dataFim",          f.dataFim);
    if (f.statusMontagem)  p.set("statusMontagem",   f.statusMontagem);
    if (f.statusPagamento) p.set("statusPagamento",  f.statusPagamento);
    if (f.comReclamacao)   p.set("comReclamacao",    f.comReclamacao);
    p.set("page", String(page));
    return p.toString();
  }

  useEffect(() => {
    void loadResumo(filters);
    void loadList(filters, 1);
  }, [fetchCount]);

  function applyFilters() {
    dispatch();
  }

  function changePage(newPage: number) {
    void loadList(filters, newPage);
  }

  if (detailId) {
    return (
      <Page title="Detalhe da Montagem" subtitle="">
        <JobDetail jobId={detailId} onBack={() => setDetailId(null)} />
      </Page>
    );
  }

  return (
    <Page title="Minhas Montagens" subtitle="Histórico analítico e sintético dos seus serviços">
      {/* ── KPIs ── */}
      {loadingResumo ? (
        <div style={{ height: 100, display: "flex", alignItems: "center" }}><LoadingState message="Carregando resumo..." /></div>
      ) : resumo ? (
        <div style={{ overflowX: "auto", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 10, paddingBottom: 4, minWidth: "max-content" }}>
            <KpiCard label="Montagens"    value={Number(resumo.total_montagens ?? 0)} />
            <KpiCard label="Produtos"     value={Number(resumo.total_produtos ?? 0)} />
            <KpiCard label="Clientes"     value={Number(resumo.total_clientes ?? 0)} />
            <KpiCard label="Finalizadas"  value={Number(resumo.finalizadas ?? 0)}    accent="#2e7d32" />
            <KpiCard label="Aprovadas"    value={Number(resumo.aprovadas ?? 0)}      accent="#388e3c" />
            <KpiCard label="Nota média"   value={Number(resumo.nota_media ?? 0).toFixed(1)} accent="#f57f17"
              sub={`${Number(resumo.aguardando_avaliacao ?? 0)} aguardando`} />
            <KpiCard label="Reclamações"  value={Number(resumo.com_reclamacao ?? 0)} accent={Number(resumo.com_reclamacao) > 0 ? "#b71c1c" : undefined} />
            <KpiCard label="SAC aberto"   value={Number(resumo.sac_aberto ?? 0)}     accent={Number(resumo.sac_aberto) > 0 ? "#6a1b9a" : undefined} />
            <KpiCard label="Pgto Liberado"   value={Number(resumo.pgto_liberado ?? 0)}   accent="#2e7d32" />
            <KpiCard label="Pgto Bloqueado"  value={Number(resumo.pgto_bloqueado ?? 0)}  accent={Number(resumo.pgto_bloqueado) > 0 ? "#b71c1c" : undefined} />
            <KpiCard label="Pgto Programado" value={Number(resumo.pgto_programado ?? 0)} accent="#1565c0" />
            <KpiCard label="Pago"            value={Number(resumo.pgto_pago ?? 0)}        accent="#1b5e20" />
            <KpiCard label="Total fotos"     value={Number(resumo.total_fotos ?? 0)} />
            {Number(resumo.sem_foto) > 0 && (
              <KpiCard label="Sem foto"    value={Number(resumo.sem_foto ?? 0)} accent="#e65100"
                sub="Envio pendente" />
            )}
          </div>
        </div>
      ) : null}

      {/* ── Filters ── */}
      <FiltersBar
        filters={filters}
        onChange={(f) => setFilters((prev) => ({ ...prev, ...f }))}
        onSearch={applyFilters}
      />

      {/* ── List ── */}
      {loadingList ? (
        <LoadingState message="Carregando suas montagens..." />
      ) : errorMsg ? (
        <div className="errorState">{errorMsg}</div>
      ) : list.rows.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">🔨</div>
          <strong>Nenhuma montagem encontrada</strong>
          <p>
            {Object.values(filters).some(Boolean)
              ? "Nenhuma montagem encontrada com os filtros selecionados."
              : "Você ainda não possui montagens finalizadas neste período."}
          </p>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {list.total} montagem(ns) encontrada(s)
          </div>
          <div style={{ display: "grid", gap: 10, maxWidth: 700 }}>
            {list.rows.map((job: any) => (
              <JobCard key={job.id} job={job} onClick={() => setDetailId(String(job.id))} />
            ))}
          </div>

          {/* Pagination */}
          {list.total > list.pageSize && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
              <button
                disabled={list.page <= 1}
                onClick={() => changePage(list.page - 1)}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", cursor: "pointer", fontSize: 13 }}
              >
                ← Anterior
              </button>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Página {list.page} de {Math.ceil(list.total / list.pageSize)}
              </span>
              <button
                disabled={list.page >= Math.ceil(list.total / list.pageSize)}
                onClick={() => changePage(list.page + 1)}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", cursor: "pointer", fontSize: 13 }}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
