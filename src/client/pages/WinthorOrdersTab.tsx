import { useEffect, useState } from "react";
import { ActionButton, LoadingState, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const POSICAO_LABEL: Record<string, string> = {
  " ": "Em aberto", "": "Em aberto",
  L: "Liberado", E: "Em separação", F: "Faturado",
  C: "Cancelado", B: "Bloqueado", T: "Transferência",
};

const POSICAO_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "NULL", label: "Em aberto" },
  { value: "L", label: "Liberado" },
  { value: "E", label: "Em separação" },
  { value: "F", label: "Faturado" },
  { value: "C", label: "Cancelado" },
  { value: "B", label: "Bloqueado" },
];

const PERIOD_OPTIONS = [
  { value: "7",  label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "180",label: "Últimos 6 meses" },
];

function fmtDate(v: any) {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("pt-BR"); } catch { return v; }
}
function fmtCur(v: any) {
  return Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type WOrder = {
  numped: number; data: string; codcli: number; cliente: string;
  codfilial: number; vltotal: number; dtentrega: string | null;
  posicao: string | null; numcar: number | null; dtfat: string | null;
  chavenfe: string | null; has_assembly: number; synced_id: string | null;
};

type WItem = {
  numped: number; numseq: number; codprod: string; qt: number;
  pvenda: number; ptabela: number; perdesc: number;
  descricao: string; unidade: string; vlmaodeobra: number; requer_montagem: number;
};

type WDetail = {
  order: Record<string, any>;
  items: WItem[];
  invoice: Record<string, any> | null;
  synced_id: string | null;
};

function posicaoBadgeStyle(p: string | null) {
  const v = p ?? "";
  if (v === "F") return { background: "#e8f5e9", color: "#2e7d32" };
  if (v === "C") return { background: "#fce4ec", color: "#c62828" };
  if (v === "B") return { background: "#fff3e0", color: "#e65100" };
  if (v === "L") return { background: "#e3f2fd", color: "#1565c0" };
  return { background: "var(--bg-secondary)", color: "var(--text-secondary)" };
}

export function WinthorOrdersTab() {
  const [rows, setRows]             = useState<WOrder[]>([]);
  const [loading, setLoading]       = useState(true);
  const [period, setPeriod]         = useState("30");
  const [posicao, setPosicao]       = useState("");
  const [onlyAssembly, setOnlyAssembly] = useState(false);
  const [q, setQ]                   = useState("");
  const [qInput, setQInput]         = useState("");
  const [offset, setOffset]         = useState(0);
  const [hasMore, setHasMore]       = useState(false);
  const [detail, setDetail]         = useState<WDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncing, setSyncing]       = useState<number | null>(null);
  const toast = useToast();

  const PAGE = 100;

  async function load(nextOffset = 0, append = false) {
    setLoading(true);
    try {
      const since = new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
      const params = new URLSearchParams({
        since,
        offset: String(nextOffset),
        limit: String(PAGE),
        ...(posicao ? { posicao } : {}),
        ...(q ? { q } : {}),
        ...(onlyAssembly ? { hasAssembly: "1" } : {}),
      });
      const data = await api<WOrder[]>(`/winthor/orders?${params}`);
      setRows(append ? (prev) => [...prev, ...data] : data);
      setHasMore(data.length === PAGE);
      setOffset(nextOffset);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0); }, [period, posicao, onlyAssembly, q]);

  async function openDetail(numped: number) {
    setDetail(null);
    setLoadingDetail(true);
    try {
      const data = await api<WDetail>(`/winthor/orders/${numped}`);
      setDetail(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function syncOrder(numped: number) {
    setSyncing(numped);
    try {
      const result = await api<{ id: string }>(`/integration/winthor/orders/${numped}/sync`, {
        method: "POST", body: "{}",
      });
      toast(`Pedido ${numped} sincronizado com sucesso!`);
      // Update in-place
      setRows((prev) => prev.map((r) => r.numped === numped ? { ...r, synced_id: result.id } : r));
      if (detail && Number(detail.order.numped) === numped) {
        setDetail((d) => d ? { ...d, synced_id: result.id } : d);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSyncing(null);
    }
  }

  // ── Detail panel ──────────────────────────────────────────────────────────
  if (detail || loadingDetail) {
    const o = detail?.order;
    return (
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <button className="ghostButton" style={{ marginBottom: 16 }} onClick={() => setDetail(null)}>
          ← Voltar à lista
        </button>

        {loadingDetail && <LoadingState message="Carregando pedido WinThor..." />}

        {detail && (
          <>
            {/* Header */}
            <div className="panel" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: "0 0 4px" }}>Pedido WinThor #{o?.numped}</h2>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>CODCLI {o?.codcli} · {o?.nome_vendedor ?? ""}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 13, fontWeight: 600, ...posicaoBadgeStyle(o?.posicao) }}>
                    {POSICAO_LABEL[o?.posicao ?? ""] ?? o?.posicao ?? "Em aberto"}
                  </span>
                  {detail.synced_id ? (
                    <a href={`/montadores/pedidos/${detail.synced_id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)" }}>
                      ✓ Ver no App →
                    </a>
                  ) : (
                    <ActionButton
                      onClick={() => syncOrder(Number(o?.numped))}
                      loadingLabel="Sincronizando..."
                      className=""
                    >
                      ⇄ Sincronizar com App
                    </ActionButton>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {[
                  ["Cliente", o?.cliente ?? `CODCLI ${o?.codcli}`],
                  ["Data do pedido", fmtDate(o?.data)],
                  ["Previsão entrega", fmtDate(o?.dtentrega)],
                  ["Filial", o?.codfilial ?? "—"],
                  ["NF faturada em", fmtDate(o?.dtfat)],
                  ["Valor total", fmtCur(o?.vltotal)],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ background: "var(--bg-secondary)", borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
                  </div>
                ))}
              </div>

              {detail.invoice && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--ok-bg)", border: "1px solid var(--ok-border)", borderRadius: 6, fontSize: 13 }}>
                  📄 NF-e {detail.invoice.numnota} · Chave: <span style={{ fontFamily: "monospace", fontSize: 11 }}>{detail.invoice.chavenfe}</span>
                  {detail.invoice.dtcanhoto && <span style={{ color: "var(--ok)", marginLeft: 8 }}>· Canhoto confirmado</span>}
                </div>
              )}
            </div>

            {/* Items */}
            <div className="panel">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>
                Itens do pedido — PCPEDI ({detail.items.length} produto{detail.items.length !== 1 ? "s" : ""})
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ fontSize: 13, width: "100%" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-secondary)" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Código</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Descrição</th>
                      <th style={{ textAlign: "center", padding: "8px 10px" }}>Un</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Qtd</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Vlr Unit.</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Desc %</th>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>Mão de Obra</th>
                      <th style={{ textAlign: "center", padding: "8px 10px" }}>Montagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)", background: item.requer_montagem ? "rgba(var(--brand-rgb,33,112,197),0.04)" : undefined }}>
                        <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{item.codprod}</td>
                        <td style={{ padding: "8px 10px", maxWidth: 260 }}>{item.descricao}</td>
                        <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-muted)" }}>{item.unidade}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{Number(item.qt).toLocaleString("pt-BR")}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtCur(item.pvenda)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text-muted)" }}>
                          {item.perdesc > 0 ? `${Number(item.perdesc).toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: item.vlmaodeobra > 0 ? "var(--brand)" : "var(--text-muted)", fontWeight: item.vlmaodeobra > 0 ? 700 : 400 }}>
                          {item.vlmaodeobra > 0 ? fmtCur(item.vlmaodeobra) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          {item.requer_montagem
                            ? <span style={{ color: "var(--brand)", fontWeight: 700 }}>Sim</span>
                            : <span style={{ color: "var(--text-muted)" }}>Não</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-secondary)" }}>
                      <td colSpan={4} style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>Total do pedido:</td>
                      <td colSpan={3} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "var(--brand)" }}>
                        {fmtCur(o?.vltotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ minWidth: 160 }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select value={posicao} onChange={(e) => setPosicao(e.target.value)} style={{ minWidth: 160 }}>
          {POSICAO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer", background: "var(--bg-secondary)", padding: "6px 12px", borderRadius: 6 }}>
          <input type="checkbox" checked={onlyAssembly} onChange={(e) => setOnlyAssembly(e.target.checked)} />
          Apenas com montagem
        </label>

        <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 200 }}>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQ(qInput)}
            placeholder="Buscar nº pedido ou cliente..."
            style={{ flex: 1 }}
          />
          <button className="ghostButton" onClick={() => setQ(qInput)}>Buscar</button>
          {q && <button className="ghostButton" onClick={() => { setQ(""); setQInput(""); }}>✕</button>}
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <LoadingState message="Consultando PCPEDC..." />
      ) : rows.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">📋</div>
          <strong>Nenhum pedido encontrado</strong>
          <p>Ajuste os filtros ou o período.</p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Filial</th>
                  <th>Status PCPEDC</th>
                  <th>Montagem</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Entrega</th>
                  <th>App</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.numped}
                    style={{ cursor: "pointer" }}
                    onClick={() => openDetail(row.numped)}
                  >
                    <td><strong>{row.numped}</strong></td>
                    <td style={{ fontSize: 13 }}>{fmtDate(row.data)}</td>
                    <td>
                      <div>{row.cliente ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>CODCLI {row.codcli}</div>
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{row.codfilial}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, ...posicaoBadgeStyle(row.posicao) }}>
                        {POSICAO_LABEL[row.posicao ?? ""] ?? row.posicao ?? "Em aberto"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {row.has_assembly
                        ? <span style={{ color: "var(--brand)", fontWeight: 700, fontSize: 13 }}>Sim</span>
                        : <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCur(row.vltotal)}</td>
                    <td style={{ fontSize: 13 }}>{fmtDate(row.dtentrega)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {row.synced_id ? (
                        <a href={`/montadores/pedidos/${row.synced_id}`} style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>
                          ✓ Sincronizado
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Não sincronizado</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {!row.synced_id && (
                        <button
                          className="ghostButton"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          disabled={syncing === row.numped}
                          onClick={() => syncOrder(row.numped)}
                        >
                          {syncing === row.numped ? "..." : "⇄ Sync"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              {rows.length} pedido{rows.length !== 1 ? "s" : ""} carregado{rows.length !== 1 ? "s" : ""}
            </p>
            {hasMore && (
              <button className="ghostButton" style={{ fontSize: 13 }} disabled={loading} onClick={() => load(offset + PAGE, true)}>
                {loading ? "Carregando..." : "Carregar mais"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
