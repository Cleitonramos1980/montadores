import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

type AgendaStatus =
  | "AGUARDANDO_ENTREGA"
  | "ENTREGUE_APTO_AGENDAMENTO"
  | "CONVITE_ENVIADO"
  | "AGUARDANDO_CLIENTE_AGENDAR"
  | "MONTAGEM_AGENDADA"
  | "MONTAGEM_REALIZADA"
  | "FINALIZADO";

type Candidato = {
  orderId: string | null;
  numped: string;
  codcli: string;
  nomeCliente: string;
  telefone: string | null;
  codfilial: string | null;
  numcar: string | null;
  numnota: string | null;
  dataFaturamento: string | null;
  dataSaidaNota: string | null;
  dataEntregaConfirmada: string | null;
  currentStatus: string | null;
  statusAgenda: AgendaStatus;
  conviteEnviado: boolean;
  dataEnvioConvite: string | null;
  montagemAgendada: boolean;
  aptoParaAgendamento: boolean;
};

type EligibilityResult = {
  numped: string;
  eligible: boolean;
  eligibleProducts: { codprod: string; descricao: string | null; calculationType: string; commissionPercent: number; fixedAmount: number | null; estimatedCommission: number }[];
  ineligibleProducts: { codprod: string; descricao: string | null }[];
  totalEstimatedCommission: number;
  dataSource: "winthor_pcpedi" | "oracle_disabled";
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return d; }
}

export function SchedulePage() {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [slots, setSlots]           = useState<any[]>([]);
  const [selectedNumped, setSelectedNumped] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [loading, setLoading]       = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [showAll, setShowAll]       = useState(false);
  const [filialFilter, setFilialFilter] = useState("");
  const [eligibilityResult, setEligibilityResult] = useState<EligibilityResult | null>(null);
  const [commissionCount, setCommissionCount] = useState<number | null>(null);
  const [diag, setDiag]             = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const agendaRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const loadCandidatos = useCallback(async (all = showAll) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ daysBack: "60", somenteEntregues: all ? "0" : "1" });
      const [data, commissions] = await Promise.all([
        api<Candidato[]>(`/agenda/candidatos?${params}`),
        api<{ count: number }>("/commissions/count").catch(() => null),
      ]);
      setCandidatos(data);
      if (commissions !== null) setCommissionCount(commissions.count);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [showAll, toast]);

  const filiais = Array.from(new Set(candidatos.map((c) => c.codfilial).filter(Boolean))) as string[];
  const candidatosFiltrados = filialFilter
    ? candidatos.filter((c) => c.codfilial === filialFilter)
    : candidatos;

  useEffect(() => { loadCandidatos(); }, [loadCandidatos]);

  function scrollToAgenda() {
    setTimeout(() => agendaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function selectCandidato(c: Candidato) {
    setSlots([]);
    setEligibilityResult(null);
    setSelectedNumped(c.numped);
    scrollToAgenda();
    setLoadingSlots(true);

    let orderId = c.orderId;

    // Auto-sync pedido se ainda não entrou no sistema
    if (!orderId) {
      try {
        toast("Sincronizando pedido com WinThor...", "info" as any);
        const result = await api<{ orderId: string }>(`/integration/winthor/orders/${c.numped}/sync`, {
          method: "POST",
          body: "{}",
        });
        orderId = result.orderId;
        toast("Pedido sincronizado. Buscando horários...");
        void loadCandidatos();
      } catch (err) {
        toast(`Não foi possível sincronizar: ${(err as Error).message}`, "error");
        setLoadingSlots(false);
        setSelectedOrderId("");
        return;
      }
    }

    setSelectedOrderId(orderId);
    try {
      const [slotsData, eligData] = await Promise.all([
        api<any[]>(`/orders/${orderId}/slots`),
        api<EligibilityResult>(`/orders/${orderId}/eligible-products`).catch(() => null),
      ]);
      setSlots(slotsData);
      setEligibilityResult(eligData);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function loadSlots(orderId: string, numped: string) {
    const c = candidatos.find((x) => x.numped === numped);
    if (c) { await selectCandidato(c); return; }
    if (!numped) { setSlots([]); setSelectedNumped(""); setSelectedOrderId(""); return; }
    // Construct a synthetic candidato so selectCandidato can handle sync if needed
    await selectCandidato({ numped, orderId: orderId || null } as Candidato);
  }

  async function schedule(slot: any) {
    try {
      await api(`/orders/${selectedOrderId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ providerId: slot.providerId, date: slot.date, period: slot.period }),
      });
      toast("Montagem agendada e registrada na timeline.");
      // Mark locally
      await api(`/agenda/candidatos/${selectedNumped}/montagem-agendada`, { method: "POST" });
      setSlots([]);
      setSelectedNumped("");
      setSelectedOrderId("");
      loadCandidatos();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function runDiag() {
    setDiagLoading(true);
    setDiag(null);
    try {
      const r = await api<any>("/agenda/diagnostico");
      setDiag(r);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setDiagLoading(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api<any>("/agenda/sync", {
        method: "POST",
        body: JSON.stringify({ modo: "DRY_RUN", daysBack: 60 }),
        headers: { "Content-Type": "application/json" },
      });
      setSyncResult(r);
      toast(`Sync agenda: ${r.aptosEntregues} entregues, ${r.convitesSimulados} simulados`, "success");
      loadCandidatos();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  const aptos = candidatosFiltrados.filter((c) => c.aptoParaAgendamento);
  const selectedCandidato = candidatos.find((c) => c.numped === selectedNumped);

  return (
    <Page
      title="Agenda Inteligente"
      subtitle="Horários disponíveis consideram apenas montadores aprovados, ativos e documentados"
    >
      {/* Controls bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => { setShowAll(e.target.checked); loadCandidatos(e.target.checked); }}
          />
          Mostrar todos (incluindo aguardando entrega)
        </label>
        {filiais.length > 0 && (
          <select
            value={filialFilter}
            onChange={(e) => setFilialFilter(e.target.value)}
            style={{ fontSize: 13, padding: "4px 8px", minHeight: "auto", minWidth: 140 }}
          >
            <option value="">Todas as filiais</option>
            {filiais.sort().map((f) => (
              <option key={f} value={f}>Filial {f}</option>
            ))}
          </select>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="ghostButton" style={{ fontSize: 12 }} disabled={diagLoading} onClick={runDiag}>
            {diagLoading ? "Analisando..." : "🔍 Diagnóstico"}
          </button>
          <button className="ghostButton" style={{ fontSize: 12 }} disabled={syncing} onClick={runSync}>
            {syncing ? "Sincronizando..." : "🔄 Sincronizar entregas"}
          </button>
        </div>
      </div>

      {syncResult && (
        <div style={{ background: "#f0f7ff", border: "1px solid #90caf9", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><strong>{syncResult.totalEncontrados}</strong> encontrados</span>
          <span style={{ color: "#1976d2" }}><strong>{syncResult.aptosEntregues}</strong> entregues</span>
          <span style={{ color: "#e65100" }}><strong>{syncResult.convitesSimulados}</strong> simulados (DRY_RUN)</span>
          <span style={{ color: "var(--text-muted)" }}><strong>{syncResult.ignorados?.length ?? 0}</strong> ignorados</span>
          {syncResult.erros?.length > 0 && <span style={{ color: "var(--danger)" }}><strong>{syncResult.erros.length}</strong> erros</span>}
        </div>
      )}

      {diag && (
        <div style={{ background: "#f8f9ff", border: "1px solid #cdd", borderRadius: 8, padding: "14px 16px", fontSize: 12, marginBottom: 16 }}>
          <strong style={{ fontSize: 13 }}>Diagnóstico WinThor — Agenda</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 10 }}>
            {[
              ["PCPEDC.NUMCAR", diag.pcpedc_numcar],
              ["PCCARREG.DTFECHA", diag.pccarreg_dtfecha],
              ["PCPRODUT.VLMAODEOBRA", diag.pcprodut_vlmaodeobra],
            ].map(([label, val]) => (
              <div key={String(label)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: val === true ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>{val === true ? "✓" : "✗"}</span>
                <span><strong>{String(label)}</strong>: {val === true ? "existe" : String(val)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            <div><strong>PCPEDC com montagem (60d):</strong> {JSON.stringify(diag.pcpedc_com_montagem_60d ?? diag.pcpedc_com_montagem_60d_erro)}</div>
            <div><strong>Carregamentos fechados (60d):</strong> {JSON.stringify(diag.carregamentos_fechados_60d ?? diag.carregamentos_fechados_60d_erro)}</div>
            <div><strong>MONT_ORDERS HAS_ASSEMBLY=1:</strong> {JSON.stringify(diag.mont_orders_has_assembly ?? diag.mont_orders_has_assembly_erro)}</div>
            <div style={{ color: (diag.comissoes_produto_ativas?.total === 0 && diag.comissoes_depto_ativas?.total === 0) ? "var(--danger)" : "inherit" }}>
              <strong>Comissões por produto:</strong>{" "}
              {diag.comissoes_produto_ativas_erro ? String(diag.comissoes_produto_ativas_erro) : (diag.comissoes_produto_ativas?.total ?? "—")}
              {" | "}
              <strong>Por departamento:</strong>{" "}
              {diag.comissoes_depto_ativas_erro ? String(diag.comissoes_depto_ativas_erro) : (diag.comissoes_depto_ativas?.total ?? "—")}
              {(diag.comissoes_produto_ativas?.total === 0 && diag.comissoes_depto_ativas?.total === 0) && (
                <span style={{ color: "var(--danger)" }}> ⚠ Nenhuma — configure em Comissões</span>
              )}
            </div>
            <div style={{ color: diag.pedidos_elegiveis_60d?.total === 0 ? "var(--warn)" : "var(--ok)" }}>
              <strong>Pedidos elegíveis (60d):</strong>{" "}
              {diag.pedidos_elegiveis_60d_erro ? String(diag.pedidos_elegiveis_60d_erro) : (diag.pedidos_elegiveis_60d?.total ?? "—")}
            </div>
          </div>
          {diag.amostra_join_dtfecha && (
            <div style={{ marginTop: 8 }}>
              <strong>Join PCPEDC→PCCARREG com DTFECHA ({(diag.amostra_join_dtfecha as any[]).length} amostra):</strong>
              {(diag.amostra_join_dtfecha as any[]).length === 0
                ? <span style={{ color: "var(--danger)" }}> ⚠ Nenhum resultado — join não está funcionando ou nenhum carregamento fechado vinculado a PCPEDC</span>
                : <span style={{ color: "var(--ok)" }}> {(diag.amostra_join_dtfecha as any[]).map((r: any) => `#${r.numped}`).join(", ")}</span>
              }
            </div>
          )}
          {diag.amostra_join_dtfecha_erro && <div style={{ color: "var(--danger)", marginTop: 8 }}>Join erro: {diag.amostra_join_dtfecha_erro}</div>}
          {diag.amostra_com_montagem && (
            <div style={{ marginTop: 8 }}>
              <strong>Pedidos com montagem (VLMAODEOBRA) últimos 60d ({(diag.amostra_com_montagem as any[]).length} amostra):</strong>
              {(diag.amostra_com_montagem as any[]).length === 0
                ? <span style={{ color: "var(--warn)" }}> ⚠ Nenhum — VLMAODEOBRA=0 para todos os produtos ou PCPEDI sem match</span>
                : <span style={{ color: "var(--ok)" }}> {(diag.amostra_com_montagem as any[]).map((r: any) => `#${r.numped} (${r.posicao})`).join(", ")}</span>
              }
            </div>
          )}
          {diag.amostra_com_montagem_erro && <div style={{ color: "var(--danger)", marginTop: 8 }}>Montagem erro: {diag.amostra_com_montagem_erro}</div>}
        </div>
      )}

      {loading ? (
        <LoadingState message="Carregando entregas confirmadas..." />
      ) : (
        <>
          {/* Order selector + slot area */}
          <div ref={agendaRef} style={{ marginBottom: 20, scrollMarginTop: 16 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", maxWidth: 520 }}>
              Pedido elegível para montagem
              <select
                value={selectedNumped}
                onChange={(e) => {
                  const c = candidatos.find((x) => x.numped === e.target.value);
                  if (c) void selectCandidato(c);
                  else { setSlots([]); setSelectedNumped(""); setSelectedOrderId(""); }
                }}
                style={{ minWidth: 300 }}
              >
                <option value="">Selecione um pedido</option>
                {aptos.map((c) => (
                  <option value={c.numped} key={c.numped}>
                    {c.numped} — {c.nomeCliente}
                    {c.dataEntregaConfirmada ? ` · Entregue ${fmtDate(c.dataEntregaConfirmada)}` : ""}
                    {!c.orderId ? " · ⚠ não sincronizado" : ""}
                    {c.conviteEnviado ? " · ✉ Convite enviado" : ""}
                  </option>
                ))}
              </select>
            </label>

            {aptos.length === 0 && !loading && (
              commissionCount === 0 ? (
                <div style={{ marginTop: 8, padding: "10px 14px", background: "#fff8e1", border: "1px solid #ffcc02", borderRadius: 8, fontSize: 13 }}>
                  <strong style={{ color: "#e65100" }}>Nenhuma regra de comissão configurada</strong>
                  <p style={{ margin: "4px 0 0", color: "var(--text-secondary)" }}>
                    A Agenda exibe somente pedidos com produtos cadastrados em{" "}
                    <a href="/montadores/comissoes" style={{ color: "var(--brand)", fontWeight: 600 }}>Comissões de Montagem</a>.
                    Configure os produtos primeiro para que os pedidos apareçam aqui.
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
                  Nenhum pedido elegível disponível para agendamento.
                  {candidatos.length > 0 && !showAll && " Ative \"Mostrar todos\" para incluir pedidos aguardando entrega."}
                </p>
              )
            )}
          </div>

          {/* Selected candidato info card */}
          {selectedCandidato && (
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <StatusBadge value={selectedCandidato.statusAgenda} />
                <span><strong>Pedido:</strong> {selectedCandidato.numped}</span>
                <span><strong>Cliente:</strong> {selectedCandidato.nomeCliente}</span>
                {selectedCandidato.dataEntregaConfirmada && (
                  <span style={{ color: "var(--ok)" }}>
                    <strong>Entregue em:</strong> {fmtDate(selectedCandidato.dataEntregaConfirmada)}
                    {selectedCandidato.numcar ? ` (Carregamento #${selectedCandidato.numcar})` : ""}
                  </span>
                )}
                {selectedCandidato.conviteEnviado && selectedCandidato.dataEnvioConvite && (
                  <span style={{ color: "#e65100" }}>
                    <strong>Convite enviado em:</strong> {fmtDate(selectedCandidato.dataEnvioConvite)}
                  </span>
                )}
                {!selectedCandidato.orderId && (
                  <span style={{ color: "var(--warn)" }}>⚠ Pedido não sincronizado — use Integração WinThor para sincronizar</span>
                )}
              </div>
            </div>
          )}

          {/* Eligible products summary — shown for context once an order is selected */}
          {eligibilityResult && eligibilityResult.dataSource === "winthor_pcpedi" && eligibilityResult.eligible && (
            <div style={{
              background: "#f1f8e9", border: "1px solid #aed581",
              borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <span style={{ color: "#388e3c", fontWeight: 700 }}>
                ✓ {eligibilityResult.eligibleProducts.length} produto(s) elegível(is) para montagem
              </span>
              {eligibilityResult.totalEstimatedCommission > 0 && (
                <span style={{ color: "var(--text-muted)" }}>
                  Comissão estimada:{" "}
                  <strong>R$ {eligibilityResult.totalEstimatedCommission.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                </span>
              )}
              {eligibilityResult.ineligibleProducts.length > 0 && (
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  ({eligibilityResult.ineligibleProducts.length} produto(s) sem comissão não entram no fluxo)
                </span>
              )}
            </div>
          )}

          {loadingSlots && <LoadingState message="Sincronizando e buscando disponibilidade..." />}

          {!loadingSlots && selectedOrderId && slots.length === 0 && (
            <EmptyState
              title="Sem horários disponíveis"
              description="Não há montadores aprovados com disponibilidade para este pedido."
            />
          )}

          {!loadingSlots && slots.length > 0 && (
            <>
              <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 12 }}>
                {slots.length} horários disponíveis — clique para agendar:
              </p>
              <div className="slotGrid">
                {slots.map((slot) => (
                  <button
                    className="slot"
                    key={`${slot.providerId}-${slot.date}-${slot.period}`}
                    onClick={() => schedule(slot)}
                  >
                    <strong>{new Date(slot.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</strong>
                    <span>{slot.period === "MANHA" ? "🌅 Manhã" : "🌇 Tarde"}</span>
                    <small>{slot.providerName}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {!selectedNumped && !loading && (
            <EmptyState
              title="Selecione um pedido"
              description="Escolha um pedido entregue e confirmado (PCCARREG.DTFECHA) para ver os horários disponíveis."
            />
          )}

          {/* Status overview table */}
          {candidatosFiltrados.length > 0 && (
            <div style={{ marginTop: 32, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14 }}>
                Pedidos elegíveis para montagem ({candidatosFiltrados.length}
                {filialFilter ? ` · filial ${filialFilter}` : ""})
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Filial</th>
                    <th>NF</th>
                    <th>Carregamento</th>
                    <th>Entregue em</th>
                    <th>Status</th>
                    <th>Convite</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatosFiltrados.map((c) => (
                    <tr
                      key={c.numped}
                      style={{
                        cursor: c.aptoParaAgendamento ? "pointer" : "default",
                        background: c.numped === selectedNumped ? "var(--brand-bg, #e8f5e9)" : undefined,
                        outline: c.numped === selectedNumped ? "2px solid var(--brand)" : undefined,
                      }}
                      title={c.aptoParaAgendamento ? "Clique para agendar montagem" : undefined}
                      onClick={() => { if (c.aptoParaAgendamento) void selectCandidato(c); }}
                    >
                      <td><strong>{c.numped}</strong></td>
                      <td style={{ fontSize: 13 }}>{c.nomeCliente}</td>
                      <td style={{ fontSize: 12 }}>{c.codfilial ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>{c.numnota ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>{c.numcar ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(c.dataEntregaConfirmada)}</td>
                      <td><StatusBadge value={c.statusAgenda} /></td>
                      <td style={{ fontSize: 12 }}>
                        {c.conviteEnviado ? `✉ ${fmtDate(c.dataEnvioConvite)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
