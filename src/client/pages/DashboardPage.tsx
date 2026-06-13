import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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

function fmtPct(v: number | null | undefined) {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

function fmtHours(v: number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  return n >= 24 ? `${(n / 24).toFixed(1)} dias` : `${n.toFixed(1)} h`;
}

function fmtMoney(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Panel({ title, children, href }: { title: string; children: ReactNode; href?: string }) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        {href && <a href={href} style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>Abrir origem</a>}
      </div>
      <div style={{ padding: "10px 16px" }}>{children}</div>
    </div>
  );
}

const financeStatusLabel: Record<string, string> = {
  PODE_PAGAR: "Pode pagar com segurança",
  FALTA_NOTA: "Falta nota/comprovante",
  SAC_ABERTO: "SAC aberto",
  BLOQUEADO: "Bloqueado",
  AGUARDANDO_AVALIACAO_CLIENTE: "Aguardando avaliação",
  LIBERADO: "Liberado",
  PROGRAMADO: "Programado",
};

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
  const [pipelineOpen, setPipelineOpen] = useState(true);
  const [transitOpen, setTransitOpen]   = useState(true);
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

          <section style={{ marginBottom: 24 }}>
            <h2 className="sectionTitle">Integração</h2>
            <div className="metricsGrid">
              <MetricCard label="Falhas WinThor" value={data?.integration?.failures ?? 0} tone={data?.integration?.failures > 0 ? "danger" : "default"} href="/montadores/integracao-winthor" />
            </div>
          </section>

          {/* ── Executivo ── */}
          {data?.executive && (
            <section style={{ marginBottom: 24 }}>
              <h2 className="sectionTitle">Indicadores Executivos</h2>
              <div className="metricsGrid" style={{ marginBottom: 20 }}>
                <MetricCard
                  label="NPS médio (montagens)"
                  value={data.executive.avgScore != null ? `${Number(data.executive.avgScore).toFixed(1)} / 5` : "—"}
                  tone={data.executive.avgScore >= 4 ? "ok" : data.executive.avgScore >= 3 ? "warn" : "danger"}
                  href="/montadores/avaliacoes"
                />
                <MetricCard
                  label="Custo médio/montagem"
                  value={data.executive.avgCommissionPaid != null
                    ? Number(data.executive.avgCommissionPaid).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    : "—"}
                  href="/montadores/comissoes"
                />
                <MetricCard
                  label="Taxa de agendamento"
                  value={data.executive.scheduleRate != null ? `${data.executive.scheduleRate}%` : "—"}
                  tone={data.executive.scheduleRate >= 70 ? "ok" : "warn"}
                  href="/montadores/agenda"
                />
                <MetricCard
                  label="Taxa de SAC / montagem"
                  value={data.executive.sacRate != null ? `${data.executive.sacRate}%` : "—"}
                  tone={data.executive.sacRate <= 5 ? "ok" : data.executive.sacRate <= 15 ? "warn" : "danger"}
                  href="/montadores/sac"
                />
              </div>

              {/* Por filial */}
              {data.executive.byFilial?.length > 0 && (
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
                    Montagens por filial
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Filial</th>
                        <th style={{ textAlign: "right" }}>Total</th>
                        <th style={{ textAlign: "right" }}>Finalizadas</th>
                        <th style={{ textAlign: "right" }}>Conclusão</th>
                        <th style={{ textAlign: "right" }}>NPS</th>
                        <th style={{ textAlign: "right" }}>Pago ao montador</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.executive.byFilial.map((f: any) => {
                        const rate = f.total_jobs > 0 ? Math.round((f.finished / f.total_jobs) * 100) : 0;
                        return (
                          <tr key={f.codfilial}>
                            <td><strong>{f.codfilial}</strong></td>
                            <td style={{ textAlign: "right" }}>{f.total_jobs}</td>
                            <td style={{ textAlign: "right" }}>{f.finished}</td>
                            <td style={{ textAlign: "right" }}>
                              <span style={{ color: rate >= 70 ? "var(--ok)" : rate >= 40 ? "var(--warn)" : "var(--danger)", fontWeight: 600 }}>
                                {rate}%
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {f.avg_score != null ? (
                                <span style={{ color: f.avg_score >= 4 ? "var(--ok)" : f.avg_score >= 3 ? "var(--warn)" : "var(--danger)" }}>
                                  {"★".repeat(Math.round(f.avg_score))} {Number(f.avg_score).toFixed(1)}
                                </span>
                              ) : "—"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {Number(f.total_paid).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Previsão de demanda */}
              {(data.executive.pipeline30d?.length > 0 || data.executive.winthorInTransit?.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {data.executive.pipeline30d?.length > 0 && (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      <div
                        onClick={() => setPipelineOpen((v) => !v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setPipelineOpen((v) => !v);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={pipelineOpen}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 16px", cursor: "pointer", userSelect: "none",
                          borderBottom: pipelineOpen ? "1px solid var(--border)" : "none",
                          background: "var(--bg-secondary)",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 13 }}>Pipeline interno — últimos 30 dias</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)" }}>
                          {pipelineOpen ? "▲ Fechar" : "▼ Expandir"}
                        </span>
                      </div>
                      {pipelineOpen && (
                        <div style={{ padding: "10px 16px" }}>
                          {data.executive.pipeline30d.map((p: any) => (
                            <div
                              key={p.status}
                              onClick={() => { location.href = "/montadores/pedidos"; }}
                              style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "1px solid var(--border-subtle, #f0f0f0)", cursor: "pointer" }}
                              title="Abrir origem em Pedidos"
                            >
                              <span style={{ color: "var(--text-secondary)" }}>{p.status.replace(/_/g, " ")}</span>
                              <strong>{p.cnt}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {data.executive.winthorInTransit?.length > 0 && (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      <div
                        onClick={() => setTransitOpen((v) => !v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setTransitOpen((v) => !v);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={transitOpen}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 16px", cursor: "pointer", userSelect: "none",
                          borderBottom: transitOpen ? "1px solid var(--border)" : "none",
                          background: "var(--bg-secondary)",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 13 }}>
                          Em trânsito (WinThor) — por filial
                          <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>PCCARREG sem DTFECHA</span>
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)" }}>
                          {transitOpen ? "▲ Fechar" : "▼ Expandir"}
                        </span>
                      </div>
                      {transitOpen && (
                        <div style={{ padding: "10px 16px" }}>
                          {data.executive.winthorInTransit.map((w: any) => (
                            <div
                              key={w.codfilial}
                              onClick={() => { location.href = "/montadores/integracao-winthor"; }}
                              style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "1px solid var(--border-subtle, #f0f0f0)", cursor: "pointer" }}
                              title="Abrir origem na integração WinThor"
                            >
                              <span style={{ color: "var(--text-secondary)" }}>Filial {w.codfilial}</span>
                              <strong>{w.cnt} entregas pendentes</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Fluxo WinThor ── */}
          {data?.process && (
            <section style={{ marginBottom: 24 }}>
              <h2 className="sectionTitle">Gestão Operacional</h2>
              <div className="metricsGrid" style={{ marginBottom: 16 }}>
                <MetricCard label="Entrega → agendamento" value={fmtHours(data.process.leadTimes?.deliveryToScheduleHours)} tone="warn" href="/montadores/agenda" />
                <MetricCard label="Agendamento → finalização" value={fmtHours(data.process.leadTimes?.scheduleToFinishHours)} href="/montadores/app" />
                <MetricCard label="Cliente agenda sozinho" value={fmtPct(data.process.conversion?.clientSelfSchedulePct)} href="/montadores/agenda" />
                <MetricCard label="Sem contato humano" value={fmtPct(data.process.conversion?.noHumanContactPct)} href="/montadores/pedidos" />
                <MetricCard label="Conversão convite → agenda" value={fmtPct(data.process.conversion?.invitationToSchedulePct)} href="/montadores/agenda" />
                <MetricCard label="Taxa de no-show" value={fmtPct(data.process.quality?.noShowPct)} tone={(data.process.quality?.noShowPct ?? 0) > 5 ? "danger" : "default"} href="/montadores/agenda" />
                <MetricCard label="Taxa de retrabalho" value={fmtPct(data.process.quality?.reworkPct)} tone={(data.process.quality?.reworkPct ?? 0) > 3 ? "danger" : "default"} href="/montadores/prestadores" />
                <MetricCard label="Idade média pendências" value={data.process.pending?.avgAgeDays == null ? "—" : `${Number(data.process.pending.avgAgeDays).toFixed(1)} dias`} tone="warn" href="/montadores/sac" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
                <Panel title="SAC vencendo e impacto financeiro" href="/montadores/sac">
                  {data.process.sac?.atRisk?.length ? (
                    <table>
                      <thead><tr><th>Pedido</th><th>Motivo</th><th style={{ textAlign: "right" }}>Impacto</th></tr></thead>
                      <tbody>
                        {data.process.sac.atRisk.map((s: any) => (
                          <tr key={s.id}>
                            <td><strong>{s.numped}</strong></td>
                            <td style={{ fontSize: 12 }}>{s.reason}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(s.impact_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Nenhum SAC em risco imediato.</p>}
                </Panel>

                <Panel title="Financeiro: o que pode pagar" href="/montadores/financeiro">
                  {data.process.finance?.safePayments?.length ? (
                    <table>
                      <thead><tr><th>Situação</th><th style={{ textAlign: "right" }}>Qtd.</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
                      <tbody>
                        {data.process.finance.safePayments.map((r: any) => (
                          <tr key={r.status}>
                            <td>{financeStatusLabel[r.status] ?? r.status}</td>
                            <td style={{ textAlign: "right" }}>{r.cnt}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Nenhum pagamento pendente classificado.</p>}
                </Panel>

                <Panel title="Pagamentos bloqueados por motivo" href="/montadores/financeiro">
                  {data.process.finance?.blockedByReason?.length ? (
                    <table>
                      <thead><tr><th>Motivo</th><th style={{ textAlign: "right" }}>Qtd.</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
                      <tbody>
                        {data.process.finance.blockedByReason.map((r: any) => (
                          <tr key={r.reason}>
                            <td style={{ fontSize: 12 }}>{r.reason}</td>
                            <td style={{ textAlign: "right" }}>{r.cnt}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Sem pagamentos bloqueados.</p>}
                </Panel>

                <Panel title="Ranking de filiais com atraso" href="/montadores/agenda">
                  {data.process.rankings?.branchDelay?.length ? (
                    <table>
                      <thead><tr><th>Filial</th><th style={{ textAlign: "right" }}>Atrasadas</th><th style={{ textAlign: "right" }}>Média</th></tr></thead>
                      <tbody>
                        {data.process.rankings.branchDelay.map((r: any) => (
                          <tr key={r.codfilial}>
                            <td><strong>{r.codfilial}</strong></td>
                            <td style={{ textAlign: "right" }}>{r.delayed_jobs}</td>
                            <td style={{ textAlign: "right" }}>{Number(r.avg_delay_days ?? 0).toFixed(1)} dias</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Nenhuma filial com montagem atrasada.</p>}
                </Panel>

                <Panel title="Produtos com mais SAC/retrabalho" href="/montadores/comissoes">
                  {data.process.rankings?.productIssues?.length ? (
                    <table>
                      <thead><tr><th>Produto</th><th style={{ textAlign: "right" }}>SAC</th><th style={{ textAlign: "right" }}>Retr.</th></tr></thead>
                      <tbody>
                        {data.process.rankings.productIssues.map((r: any) => (
                          <tr key={r.product_id}>
                            <td style={{ fontSize: 12 }}><strong>{r.product_id}</strong> {r.description}</td>
                            <td style={{ textAlign: "right" }}>{r.sac_cases}</td>
                            <td style={{ textAlign: "right" }}>{r.reworks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Sem produtos com SAC ou retrabalho.</p>}
                </Panel>

                <Panel title="Gestor: gargalos por montador" href="/montadores/prestadores">
                  {data.process.rankings?.providerPerformance?.length ? (
                    <table>
                      <thead><tr><th>Montador</th><th style={{ textAlign: "right" }}>NPS</th><th style={{ textAlign: "right" }}>Retr.</th><th style={{ textAlign: "right" }}>Atrasos</th></tr></thead>
                      <tbody>
                        {data.process.rankings.providerPerformance.map((r: any) => (
                          <tr key={r.provider_id}>
                            <td style={{ fontSize: 12 }}><strong>{r.provider_name}</strong><br /><span style={{ color: "var(--text-muted)" }}>score {Number(r.score ?? 0).toFixed(1)}</span></td>
                            <td style={{ textAlign: "right" }}>{r.avg_score == null ? "—" : Number(r.avg_score).toFixed(1)}</td>
                            <td style={{ textAlign: "right" }}>{r.reworks}</td>
                            <td style={{ textAlign: "right" }}>{r.delayed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Sem gargalos por montador ainda.</p>}
                </Panel>
              </div>
            </section>
          )}

          {fluxo && (
            <section
              onClick={() => { location.href = "/montadores/mensagens"; }}
              style={{ marginTop: 8, cursor: "pointer" }}
              title="Abrir origem das informações do fluxo"
            >
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setDrillPhase(p);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setDrillPhase(p);
                        }
                      }}
                      role="button"
                      tabIndex={0}
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
