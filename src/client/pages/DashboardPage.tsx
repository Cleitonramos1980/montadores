import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { LoadingState, MetricCard, Page, useToast } from "../components/Ui";

const AUTO_REFRESH_MS = 60_000;

type FluxoPhase = {
  key: string;
  label: string;
  count: number;
  order: number;
  ativoDashboard: boolean;
  ativoMensagem: boolean;
  modoEnvio: string;
};

type FluxoSummary = {
  phases: FluxoPhase[];
  lastRun: {
    iniciado_em: string;
    pedidos_encontrados: number;
    eventos_gerados: number;
    msgs_simuladas: number;
    msgs_enviadas: number;
    run_status: string;
  } | null;
};

type DrillRow = {
  numped: string;
  codcli: string;
  nome_cliente: string;
  codfilial: string;
  posicao: string;
  fluxo_status_atual: string;
  data_digitacao: string;
  data_emissao_mapa: string | null;
  numnota: string | null;
  ultima_sincronizacao: string;
};

const PHASE_COLORS: Record<string, string> = {
  AGUARDANDO_MAPA_ESTOQUE:           "#607d8b",
  MAPA_EMITIDO_AGUARDANDO_SEPARACAO: "#1565c0",
  EM_SEPARACAO_CONFERENCIA:          "#6a1b9a",
  CONFERIDO_AGUARDANDO_FATURAMENTO:  "#e65100",
  FATURADO_AGUARDANDO_SAIDA:         "#2e7d32",
  FINALIZADO:                        "#00695c",
};

function fmtDt(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("pt-BR"); } catch { return d; }
}

function DrillPanel({
  phase, onClose,
}: {
  phase: FluxoPhase;
  onClose: () => void;
}) {
  const [rows, setRows]   = useState<DrillRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = useCallback((p: number) => {
    setLoading(true);
    api<{ rows: DrillRow[]; total: number }>(`/fluxo/dashboard/phase/${phase.key}?page=${p}&pageSize=20`)
      .then((r) => { setRows(r.rows); setTotal(r.total); setPage(p); })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [phase.key, toast]);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.ceil(total / 20);
  const color = PHASE_COLORS[phase.key] ?? "#555";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--bg)", borderRadius: 12, width: "90vw", maxWidth: 960,
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 8px 40px rgba(0,0,0,.3)",
      }}>
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{phase.label}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{total} pedido{total !== 1 ? "s" : ""} nesta fase</div>
          </div>
          <button className="ghostButton" style={{ marginLeft: "auto" }} onClick={onClose}>✕ Fechar</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Carregando...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Nenhum pedido nesta fase.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Filial</th>
                  <th>Data</th>
                  <th>Emissão Mapa</th>
                  <th>NF</th>
                  <th>Sinc.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.numped} style={{ cursor: "pointer" }}
                    onClick={() => { location.href = `/montadores/fluxo/pedido/${r.numped}`; }}>
                    <td><strong>{r.numped}</strong></td>
                    <td style={{ fontSize: 13 }}>{r.nome_cliente}</td>
                    <td style={{ fontSize: 12 }}>{r.codfilial}</td>
                    <td style={{ fontSize: 12 }}>{fmtDt(r.data_digitacao)}</td>
                    <td style={{ fontSize: 12 }}>{fmtDt(r.data_emissao_mapa)}</td>
                    <td style={{ fontSize: 12 }}>{r.numnota || "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDt(r.ultima_sincronizacao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ghostButton" disabled={page <= 1} onClick={() => load(page - 1)}>← Anterior</button>
            <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>{page}/{totalPages}</span>
            <button className="ghostButton" disabled={page >= totalPages} onClick={() => load(page + 1)}>Próxima →</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [fluxo, setFluxo] = useState<FluxoSummary | null>(null);
  const [drillPhase, setDrillPhase] = useState<FluxoPhase | null>(null);
  const toast = useToast();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [d, f] = await Promise.all([
        api<any>("/dashboard"),
        api<FluxoSummary>("/fluxo/dashboard/summary").catch(() => null),
      ]);
      setData(d);
      setFluxo(f);
      setLastRefresh(new Date());
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => { void load(); }, AUTO_REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function createDemo() {
    try {
      const result = await api<any>("/orders/demo", { method: "POST", body: "{}" });
      toast("Pedido demo criado com sucesso.");
      location.href = `/montadores/pedidos/${result.orderId}`;
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <Page
      title="Dashboard Geral"
      subtitle="Visão operacional em tempo real da jornada pós-venda"
      action={
        <div className="actionsRow">
          {lastRefresh && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Atualizado às {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button className="ghostButton" onClick={load}>↻ Atualizar</button>
          <button onClick={createDemo}>+ Pedido demo</button>
        </div>
      }
    >
      {loading && !data ? (
        <LoadingState message="Carregando indicadores..." />
      ) : (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2 className="sectionTitle">Pedidos</h2>
            <div className="metricsGrid">
              <MetricCard label="Monitorados" value={data?.orders?.monitored ?? 0} href="/montadores/pedidos" />
              <MetricCard label="Criados hoje" value={data?.orders?.createdToday ?? 0} href="/montadores/pedidos" />
              <MetricCard label="Com montagem" value={data?.orders?.withAssembly ?? 0} href="/montadores/pedidos" />
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="sectionTitle">Montagens</h2>
            <div className="metricsGrid">
              <MetricCard label="Aguardando agenda" value={data?.assembly?.awaitingSchedule ?? 0} tone="warn" href="/montadores/agenda" />
              <MetricCard label="Agendadas" value={data?.assembly?.scheduled ?? 0} href="/montadores/agenda" />
              <MetricCard label="Em execução" value={data?.assembly?.inExecution ?? 0} href="/montadores/app" />
              <MetricCard label="Finalizadas" value={data?.assembly?.finished ?? 0} tone="ok" href="/montadores/app" />
              <MetricCard label="Aguardam avaliação" value={data?.assembly?.awaitingReview ?? 0} tone="warn" href="/montadores/avaliacoes" />
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="sectionTitle">SAC</h2>
            <div className="metricsGrid">
              <MetricCard label="Casos abertos" value={data?.sac?.open ?? 0} tone={data?.sac?.open > 0 ? "danger" : "default"} href="/montadores/sac" />
              <MetricCard label="Casos resolvidos" value={data?.sac?.resolved ?? 0} tone="ok" href="/montadores/sac" />
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="sectionTitle">Financeiro</h2>
            <div className="metricsGrid">
              <MetricCard label="Bloqueados" value={data?.finance?.blocked ?? 0} tone={data?.finance?.blocked > 0 ? "danger" : "default"} href="/montadores/financeiro" />
              <MetricCard label="Liberados" value={data?.finance?.released ?? 0} tone={data?.finance?.released > 0 ? "ok" : "default"} href="/montadores/financeiro" />
              <MetricCard label="Programados" value={data?.finance?.programmed ?? 0} tone="warn" href="/montadores/financeiro" />
              <MetricCard label="Pagos" value={data?.finance?.paid ?? 0} tone="ok" href="/montadores/financeiro" />
            </div>
          </section>

          <section>
            <h2 className="sectionTitle">Integração</h2>
            <div className="metricsGrid">
              <MetricCard label="Falhas WinThor" value={data?.integration?.failures ?? 0} tone={data?.integration?.failures > 0 ? "danger" : "default"} href="/montadores/integracao-winthor" />
            </div>
          </section>

          {/* ── Fluxo WinThor ── */}
          {fluxo && (
            <section style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h2 className="sectionTitle" style={{ margin: 0 }}>Fluxo de Pedidos WinThor</h2>
                {fluxo.lastRun && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                    Última sync: {fmtDt(fluxo.lastRun.iniciado_em)} &nbsp;·&nbsp;
                    {fluxo.lastRun.pedidos_encontrados} pedidos &nbsp;·&nbsp;
                    {fluxo.lastRun.eventos_gerados} eventos &nbsp;·&nbsp;
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{fluxo.lastRun.run_status}</span>
                  </span>
                )}
                <a href="/montadores/mensagens" className="ghostButton" style={{ fontSize: 12 }}>
                  Gerenciar Fluxo →
                </a>
              </div>
              <div className="metricsGrid">
                {fluxo.phases.filter((p) => p.ativoDashboard).map((p) => {
                  const color = PHASE_COLORS[p.key] ?? "#555";
                  return (
                    <div
                      key={p.key}
                      onClick={() => setDrillPhase(p)}
                      style={{
                        background: "var(--bg)",
                        border: `2px solid ${color}22`,
                        borderRadius: 10,
                        padding: "14px 16px",
                        cursor: "pointer",
                        transition: "border-color .15s",
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.borderColor = color)}
                      onMouseOut={(e)  => (e.currentTarget.style.borderColor = `${color}22`)}
                    >
                      <div style={{ fontSize: 11, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                        {p.label}
                      </div>
                      <div style={{ fontSize: 30, fontWeight: 800, color: p.count > 0 ? color : "var(--text-muted)" }}>
                        {p.count}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 6 }}>
                        <span>{p.ativoMensagem ? "✉ msg ativa" : "✉ msg inativa"}</span>
                        {p.ativoMensagem && <span style={{ color }}>{p.modoEnvio}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {drillPhase && (
        <DrillPanel phase={drillPhase} onClose={() => setDrillPhase(null)} />
      )}
    </Page>
  );
}
