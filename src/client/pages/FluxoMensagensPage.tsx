import { useCallback, useEffect, useState } from "react";
import { Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type EventConfig = {
  event_key: string;
  label: string;
  ativo_dashboard: number;
  ativo_mensagem: number;
  modo_envio: string;
  telefones_teste: string | null;
  observacao: string | null;
  atualizado_em: string;
};

type SyncRun = {
  id: string;
  modo: string;
  pedidos_encontrados: number;
  eventos_gerados: number;
  msgs_simuladas: number;
  msgs_enviadas: number;
  msgs_ignoradas: number;
  msgs_erro: number;
  run_status: string;
  iniciado_em: string;
  finalizado_em: string | null;
};

type MessageLog = {
  id: string;
  numped: string;
  codcli: string;
  event_key: string;
  destino: string | null;
  canal: string;
  status: string;
  modo_envio: string;
  enviado_em: string | null;
  criado_em: string;
};

type SyncConfig = Record<string, string>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDt(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("pt-BR"); } catch { return d; }
}

const STATUS_COLOR: Record<string, string> = {
  ENVIADO:                       "var(--ok)",
  SIMULADO_DRY_RUN:              "#1565c0",
  ERRO:                          "var(--danger)",
  IGNORADO_DUPLICIDADE:          "var(--text-muted)",
  IGNORADO_EVENTO_INATIVO:       "var(--text-muted)",
  IGNORADO_SEM_TELEFONE:         "var(--warn)",
  IGNORADO_FORA_DO_MODELO:       "var(--text-muted)",
  IGNORADO_TEMPLATE_INATIVO:     "var(--warn)",
  IGNORADO_REGRA_NAO_VALIDADA:   "var(--warn)",
};

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3, borderRadius: 20,
      padding: "2px 8px", color, background: `${color}18`, border: `1px solid ${color}44`,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const colors: Record<string, string> = {
    DRY_RUN:    "#1565c0",
    HOMOLOGACAO: "#e65100",
    PRODUCAO:   "var(--ok)",
  };
  const c = colors[mode] ?? "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
      color: c, background: `${c}18`, border: `1px solid ${c}`,
    }}>
      {mode}
    </span>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function SyncControls({ config, onRan }: { config: SyncConfig; onRan: () => void }) {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [diag, setDiag]       = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const toast = useToast();

  const run = async (modo: "DRY_RUN" | "PRODUCAO") => {
    setRunning(true);
    setLastResult(null);
    try {
      const r = await api<any>("/fluxo/sync/run", {
        method: "POST",
        body: JSON.stringify({ modo }),
        headers: { "Content-Type": "application/json" },
      });
      setLastResult(r);
      if (r.status === "ERRO" && r.erros?.length) {
        toast(`Erro: ${r.erros[0].message}`, "error");
      } else {
        toast(`Sync concluído: ${r.pedidosEncontrados} pedidos, ${r.eventosGerados} eventos`, "success");
      }
      onRan();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRunning(false);
    }
  };

  const runDiag = async () => {
    setDiagLoading(true);
    setDiag(null);
    try {
      const r = await api<any>("/fluxo/diagnostico");
      setDiag(r);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Sincronização WinThor</h3>
        <ModeBadge mode={config.MESSAGE_TRIGGER_MODE ?? "DRY_RUN"} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Janela: últimos {config.SYNC_DAYS_BACK ?? "7"} dias &nbsp;·&nbsp; CONDVENDA={config.CONDVENDA_DEFAULT ?? "8"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button disabled={running} onClick={() => run("DRY_RUN")}>
            {running ? "Executando..." : "▶ Simulação (DRY_RUN)"}
          </button>
          <button
            disabled={running}
            style={{ background: "var(--danger)", color: "#fff", border: "none" }}
            onClick={() => {
              if (confirm("Executar sincronização em PRODUCAO? Mensagens serão enviadas se configuradas.")) {
                run("PRODUCAO");
              }
            }}
          >
            ⚡ Sincronizar (PRODUCAO)
          </button>
          <button
            className="ghostButton"
            style={{ fontSize: 12 }}
            disabled={diagLoading}
            onClick={runDiag}
          >
            {diagLoading ? "Analisando..." : "🔍 Diagnóstico"}
          </button>
          <a href="/montadores/mensagens-templates" className="ghostButton" style={{ fontSize: 12 }}>Templates →</a>
        </div>
      </div>

      {lastResult && (
        <div style={{
          background: lastResult.status === "ERRO" ? "#fff3f3" : "var(--bg-secondary)",
          borderRadius: 8, padding: "10px 14px",
          fontSize: 13, display: "flex", gap: 16, flexWrap: "wrap",
        }}>
          <span><strong>{lastResult.pedidosEncontrados}</strong> pedidos</span>
          <span><strong>{lastResult.eventosGerados}</strong> eventos</span>
          <span style={{ color: "#1565c0" }}><strong>{lastResult.msgsSimuladas}</strong> simuladas</span>
          <span style={{ color: "var(--ok)" }}><strong>{lastResult.msgsEnviadas}</strong> enviadas</span>
          <span style={{ color: "var(--text-muted)" }}><strong>{lastResult.msgsIgnoradas}</strong> ignoradas</span>
          {lastResult.msgsErro > 0 && (
            <span style={{ color: "var(--danger)" }}><strong>{lastResult.msgsErro}</strong> erros</span>
          )}
          <ModeBadge mode={lastResult.modo} />
          {lastResult.status === "ERRO" && lastResult.erros?.length > 0 && (
            <details style={{ width: "100%", marginTop: 4 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--danger)" }}>Ver erros</summary>
              <pre style={{ fontSize: 11, marginTop: 6, whiteSpace: "pre-wrap", color: "var(--danger)" }}>
                {lastResult.erros.map((e: any) => `[${e.numped}] ${e.message}`).join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}

      {diag && (
        <div style={{ marginTop: 12, fontSize: 12, background: "#f8f9ff", border: "1px solid #cdd", borderRadius: 8, padding: "12px 14px" }}>
          <strong style={{ fontSize: 13 }}>Diagnóstico WinThor</strong>
          <div style={{ marginTop: 8 }}>
            <strong>Colunas PCPEDC:</strong>{" "}
            {Object.entries(diag.colunas_pcpedc ?? {}).map(([col, ok]) => (
              <span key={col} style={{ marginRight: 10, color: ok === true ? "var(--ok)" : "var(--danger)" }}>
                {col}: {ok === true ? "✓" : "✗ " + ok}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>Pedidos por CONDVENDA (últimos 60 dias):</strong>
            <table style={{ marginTop: 4, fontSize: 12 }}>
              <thead><tr><th>CONDVENDA</th><th>TOTAL</th></tr></thead>
              <tbody>
                {(diag.condvendas ?? []).map((r: any) => (
                  <tr key={r.condvenda} style={{ background: String(r.condvenda) === String(config.CONDVENDA_DEFAULT ?? "8") ? "#e8f5e9" : undefined }}>
                    <td>{r.condvenda}</td>
                    <td>{r.total}</td>
                  </tr>
                ))}
                {(diag.condvendas ?? []).length === 0 && <tr><td colSpan={2} style={{ color: "var(--text-muted)" }}>Nenhum pedido encontrado nos últimos 60 dias</td></tr>}
              </tbody>
            </table>
          </div>
          {diag.amostra_condvenda_8_erro && (
            <div style={{ marginTop: 6, color: "var(--danger)" }}>CONDVENDA=8 erro: {diag.amostra_condvenda_8_erro}</div>
          )}
          {(diag.amostra_condvenda_8 ?? []).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Amostra CONDVENDA=8 (últimos 7 dias):</strong>{" "}
              {(diag.amostra_condvenda_8 as any[]).map((r) => `${r.numped} (${r.posicao})`).join(", ")}
            </div>
          )}
          {(diag.pedidos_recentes ?? []).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Pedidos mais recentes (qualquer CONDVENDA):</strong>{" "}
              {(diag.pedidos_recentes as any[]).map((r) => `#${r.numped} CV=${r.condvenda}`).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventConfigTable({ events, onSave }: { events: EventConfig[]; onSave: (key: string, patch: any) => void }) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14 }}>
        Configuração de Eventos
      </div>
      <table>
        <thead>
          <tr>
            <th>Evento</th>
            <th>Label</th>
            <th style={{ textAlign: "center" }}>Dashboard</th>
            <th style={{ textAlign: "center" }}>Mensagem</th>
            <th>Modo Envio</th>
            <th>Telefones Teste</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.event_key}>
              <td><code style={{ fontSize: 11 }}>{ev.event_key}</code></td>
              <td style={{ fontSize: 13 }}>{ev.label}</td>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={Number(ev.ativo_dashboard) === 1}
                  onChange={(e) => onSave(ev.event_key, { ativo_dashboard: e.target.checked ? 1 : 0 })}
                />
              </td>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={Number(ev.ativo_mensagem) === 1}
                  onChange={(e) => onSave(ev.event_key, { ativo_mensagem: e.target.checked ? 1 : 0 })}
                />
              </td>
              <td>
                <select
                  value={ev.modo_envio}
                  style={{ fontSize: 12, padding: "2px 6px" }}
                  onChange={(e) => onSave(ev.event_key, { modo_envio: e.target.value })}
                >
                  <option value="DRY_RUN">DRY_RUN</option>
                  <option value="HOMOLOGACAO">HOMOLOGACAO</option>
                  <option value="PRODUCAO">PRODUCAO</option>
                </select>
              </td>
              <td>
                <input
                  style={{ fontSize: 11, width: 160, padding: "2px 6px" }}
                  defaultValue={ev.telefones_teste ?? ""}
                  placeholder="+5511..."
                  onBlur={(e) => {
                    if (e.target.value !== (ev.telefones_teste ?? "")) {
                      onSave(ev.event_key, { telefones_teste: e.target.value });
                    }
                  }}
                />
              </td>
              <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDt(ev.atualizado_em)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageLogsSection() {
  const [rows, setRows]     = useState<MessageLog[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [statusF, setStatusF] = useState("");
  const [numpedF, setNumpedF] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = useCallback((p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), pageSize: "20" });
    if (statusF) params.set("status", statusF);
    if (numpedF) params.set("numped", numpedF);
    api<{ rows: MessageLog[]; total: number }>(`/fluxo/message-logs?${params}`)
      .then((r) => { setRows(r.rows); setTotal(r.total); setPage(p); })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [statusF, numpedF, toast]);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Logs de Mensagens</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{total} registros</span>
        <input
          placeholder="Pedido..."
          value={numpedF}
          onChange={(e) => setNumpedF(e.target.value)}
          style={{ fontSize: 12, padding: "3px 8px", width: 100 }}
        />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={{ fontSize: 12, padding: "3px 8px" }}>
          <option value="">Todos status</option>
          <option value="ENVIADO">ENVIADO</option>
          <option value="SIMULADO_DRY_RUN">SIMULADO_DRY_RUN</option>
          <option value="ERRO">ERRO</option>
          <option value="IGNORADO_DUPLICIDADE">IGNORADO_DUPLICIDADE</option>
          <option value="IGNORADO_EVENTO_INATIVO">IGNORADO_EVENTO_INATIVO</option>
          <option value="IGNORADO_SEM_TELEFONE">IGNORADO_SEM_TELEFONE</option>
          <option value="IGNORADO_TEMPLATE_INATIVO">IGNORADO_TEMPLATE_INATIVO</option>
        </select>
        <button className="ghostButton" style={{ fontSize: 12 }} onClick={() => load(1)}>Filtrar</button>
      </div>

      {loading ? (
        <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Carregando...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>Nenhum log encontrado.</div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Evento</th>
                <th>Status</th>
                <th>Destino</th>
                <th>Canal</th>
                <th>Modo</th>
                <th>Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.numped}</strong></td>
                  <td><code style={{ fontSize: 11 }}>{r.event_key}</code></td>
                  <td><StatusChip status={r.status} /></td>
                  <td style={{ fontSize: 12 }}>{r.destino || "—"}</td>
                  <td style={{ fontSize: 12 }}>{r.canal}</td>
                  <td><ModeBadge mode={r.modo_envio} /></td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDt(r.enviado_em ?? r.criado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="ghostButton" style={{ fontSize: 12 }} disabled={page <= 1} onClick={() => load(page - 1)}>← Anterior</button>
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>{page}/{totalPages}</span>
              <button className="ghostButton" style={{ fontSize: 12 }} disabled={page >= totalPages} onClick={() => load(page + 1)}>Próxima →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SyncRunsSection({ runs, loading }: { runs: SyncRun[]; loading: boolean }) {
  const runColor = (s: string) => s === "CONCLUIDO" ? "var(--ok)" : s === "ERRO" ? "var(--danger)" : "var(--warn)";
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14 }}>
        Histórico de Execuções
      </div>
      {loading ? (
        <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>Carregando...</div>
      ) : runs.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>Nenhuma execução encontrada. Execute uma simulação para começar.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Modo</th>
              <th>Pedidos</th>
              <th>Eventos</th>
              <th>Simuladas</th>
              <th>Enviadas</th>
              <th>Ignoradas</th>
              <th>Erros</th>
              <th>Status</th>
              <th>Iniciado</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const dur = r.finalizado_em && r.iniciado_em
                ? Math.round((new Date(r.finalizado_em).getTime() - new Date(r.iniciado_em).getTime()) / 1000)
                : null;
              return (
                <tr key={r.id}>
                  <td><ModeBadge mode={r.modo} /></td>
                  <td style={{ fontWeight: 600 }}>{r.pedidos_encontrados}</td>
                  <td>{r.eventos_gerados}</td>
                  <td style={{ color: "#1565c0" }}>{r.msgs_simuladas}</td>
                  <td style={{ color: "var(--ok)" }}>{r.msgs_enviadas}</td>
                  <td style={{ color: "var(--text-muted)" }}>{r.msgs_ignoradas}</td>
                  <td style={{ color: r.msgs_erro > 0 ? "var(--danger)" : "var(--text-muted)" }}>{r.msgs_erro}</td>
                  <td><span style={{ fontWeight: 700, fontSize: 12, color: runColor(r.run_status) }}>{r.run_status}</span></td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDt(r.iniciado_em)}</td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{dur != null ? `${dur}s` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FluxoMensagensPage() {
  const [events, setEvents]   = useState<EventConfig[]>([]);
  const [runs, setRuns]       = useState<SyncRun[]>([]);
  const [config, setConfig]   = useState<SyncConfig>({});
  const [runsLoading, setRunsLoading] = useState(false);
  const toast = useToast();

  const loadAll = useCallback(async () => {
    setRunsLoading(true);
    try {
      const [evts, cfg, runsData] = await Promise.all([
        api<EventConfig[]>("/fluxo/events"),
        api<SyncConfig>("/fluxo/sync/config"),
        api<{ rows: SyncRun[] }>("/fluxo/sync/runs?pageSize=10"),
      ]);
      setEvents(evts);
      setConfig(cfg);
      setRuns(runsData.rows);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRunsLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleSaveEvent = async (key: string, patch: any) => {
    try {
      await api(`/fluxo/events/${key}/config`, {
        method: "PUT",
        body: JSON.stringify(patch),
        headers: { "Content-Type": "application/json" },
      });
      setEvents((prev) => prev.map((e) => e.event_key === key ? { ...e, ...patch } : e));
      toast("Configuração salva", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <Page
      title="Mensagens — Fluxo WinThor"
      subtitle="Controle de sincronização, gatilhos, eventos e logs do fluxo de pedidos"
    >
      <SyncControls config={config} onRan={loadAll} />
      <EventConfigTable events={events} onSave={handleSaveEvent} />
      <MessageLogsSection />
      <SyncRunsSection runs={runs} loading={runsLoading} />
    </Page>
  );
}
