import { useEffect, useState } from "react";
import { ActionButton, ConfirmDialog, JustifyDialog, LoadingState, MetricCard, Page, StatusBadge, useToast } from "../components/Ui";
import { api, getToken } from "../lib/api";

type CalcItem = {
  id: string; codprod: string; descricao: string | null; unidade: string | null;
  qt_vendida: number; pvenda: number; valor_base: number;
  calculation_type: string | null; fixed_amount: number | null;
  percentage_rate: number | null; commission_amount: number;
  note: string | null;
};

function fmtCur(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtNum(v: number) {
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

// ── Commission Detail Panel ───────────────────────────────────────────────────
function CommissionDetail({
  paymentId, onRecalcDone,
}: { paymentId: string; onRecalcDone: () => void }) {
  const [items, setItems]         = useState<CalcItem[] | null>(null);
  const [loading, setLoading]     = useState(true);
  const [recalcing, setRecalcing] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setItems(await api<CalcItem[]>(`/payments/${paymentId}/commission-detail`));
    } catch (err) {
      toast((err as Error).message, "error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function recalculate() {
    setRecalcing(true);
    try {
      const result = await api<{ totalCommission: number; itemsCalculated: number; dataSource: string }>(
        `/payments/${paymentId}/recalculate`, { method: "POST", body: "{}" },
      );
      toast(
        `Recálculo concluído. Total: ${fmtCur(result.totalCommission)} | ${result.itemsCalculated} item(s) com comissão. Fonte: ${result.dataSource === "winthor_pcpedi" ? "PCPEDI" : "sem dados Oracle"}.`,
      );
      await load();
      onRecalcDone();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRecalcing(false);
    }
  }

  useEffect(() => { void load(); }, [paymentId]);

  if (loading) return <div style={{ padding: 12 }}><LoadingState message="Carregando composição da comissão..." /></div>;

  const total = (items ?? []).reduce((s, i) => s + Number(i.commission_amount), 0);
  const semRegra = (items ?? []).filter((i) => i.note === "Produto sem comissão configurada");

  return (
    <div style={{ background: "var(--bg-secondary)", borderTop: "1px solid var(--border)", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong style={{ fontSize: 14 }}>Composição da comissão — PCPEDI</strong>
        <ActionButton
          className="ghostButton"
          loadingLabel="Recalculando..."
          onClick={recalculate}
        >
          {recalcing ? "Recalculando..." : "🔄 Recalcular"}
        </ActionButton>
      </div>

      {(!items || items.length === 0) ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Nenhum item calculado. Clique em "Recalcular" para calcular a comissão com base nos itens reais da PCPEDI.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Descrição</th>
                  <th style={{ textAlign: "right" }}>Qtde</th>
                  <th style={{ textAlign: "right" }}>Preço unit.</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: "right" }}>Regra</th>
                  <th style={{ textAlign: "right" }}>Valor base</th>
                  <th style={{ textAlign: "right" }}>Comissão</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ opacity: item.note ? 0.6 : 1 }}>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{item.codprod}</td>
                    <td style={{ maxWidth: 200 }}>{item.descricao ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmtNum(Number(item.qt_vendida))}</td>
                    <td style={{ textAlign: "right" }}>{fmtCur(Number(item.pvenda))}</td>
                    <td>
                      {item.calculation_type ? (
                        <span style={{
                          display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: item.calculation_type === "FIXED_AMOUNT" ? "var(--info-bg,#e3f2fd)" : "var(--brand-bg,#e8f5e9)",
                          color: item.calculation_type === "FIXED_AMOUNT" ? "var(--info,#1565c0)" : "var(--brand)",
                        }}>
                          {item.calculation_type === "FIXED_AMOUNT" ? "Fixo" : "%"}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {item.calculation_type === "FIXED_AMOUNT"
                        ? fmtCur(Number(item.fixed_amount))
                        : item.calculation_type === "PERCENTAGE"
                          ? `${Number(item.percentage_rate).toFixed(2)}%`
                          : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {item.valor_base > 0 ? fmtCur(Number(item.valor_base)) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: item.commission_amount > 0 ? "var(--ok)" : "var(--text-muted)" }}>
                      {fmtCur(Number(item.commission_amount))}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--warn)" }}>{item.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ textAlign: "right", fontWeight: 700, paddingTop: 6 }}>Total comissão:</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--brand)" }}>{fmtCur(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {semRegra.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
              ⚠ {semRegra.length} produto{semRegra.length !== 1 ? "s" : ""} sem comissão configurada — não gera{semRegra.length !== 1 ? "m" : ""} valor.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function FinancePage() {
  const [payments, setPayments]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(1);
  const [pageSize]                = useState(20);
  const [total, setTotal]         = useState(0);
  const [exporting, setExporting] = useState(false);
  const [programDate, setProgramDate] = useState<Record<string, string>>({});
  const [confirmPay, setConfirmPay]   = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  // Bulk actions
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate]        = useState(new Date().toISOString().slice(0, 10));
  const [bulkReleaseOpen, setBulkReleaseOpen] = useState(false);
  const [bulkJustification, setBulkJustification] = useState("");
  const [bulkLoading, setBulkLoading]  = useState(false);
  const toast = useToast();

  const load = async (p = page) => {
    setLoading(true);
    try {
      const data = await api<{ rows: any[]; total: number; page: number; pageSize: number }>(
        `/payments?page=${p}&pageSize=${pageSize}`,
      );
      setPayments(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(page); }, [page]);

  async function exportCsv() {
    setExporting(true);
    try {
      const token = getToken();
      const res = await fetch("/api/payments/export.csv", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Erro ao exportar CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financeiro_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function doRelease(id: string, justification: string) {
    try {
      await api(`/payments/${id}/release`, { method: "POST", body: JSON.stringify({ justification }) });
      toast("Pagamento liberado.");
      setReleaseTarget(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setReleaseTarget(null);
    }
  }

  async function doProgram(id: string) {
    try {
      const date = programDate[id] ?? new Date().toISOString().slice(0, 10);
      await api(`/payments/${id}/program`, { method: "POST", body: JSON.stringify({ programmedFor: date }) });
      toast("Pagamento programado.");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function doPay(id: string) {
    try {
      await api(`/payments/${id}/pay`, { method: "POST", body: "{}" });
      toast("Pagamento marcado como pago.");
      setConfirmPay(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setConfirmPay(null);
    }
  }

  const totalBlocked    = payments.filter((p) => p.status === "BLOQUEADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalReleased   = payments.filter((p) => p.status === "LIBERADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalProgrammed = payments.filter((p) => p.status === "PROGRAMADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalPaid       = payments.filter((p) => p.status === "PAGO").reduce((s, p) => s + Number(p.amount), 0);

  function goPage(n: number) {
    const next = Math.max(1, Math.min(n, totalPages));
    setPage(next);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = payments.filter((p) => ["BLOQUEADO", "LIBERADO"].includes(p.status)).map((p) => p.id);
    if (selectable.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable));
    }
  }

  async function doBulkRelease() {
    if (!bulkJustification.trim()) return;
    setBulkLoading(true);
    try {
      const ids = [...selected].filter((id) => payments.find((p) => p.id === id)?.status === "BLOQUEADO");
      if (ids.length === 0) { toast("Nenhum pagamento bloqueado selecionado.", "error" as any); return; }
      const r = await api<{ succeeded: number; failed: any[]; total: number }>(
        "/payments/bulk-release", { method: "POST", body: JSON.stringify({ ids, justification: bulkJustification }) },
      );
      toast(`${r.succeeded} de ${r.total} liberado(s) com sucesso.${r.failed.length > 0 ? ` ${r.failed.length} falha(s).` : ""}`);
      setBulkReleaseOpen(false);
      setBulkJustification("");
      setSelected(new Set());
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBulkLoading(false);
    }
  }

  async function doBulkProgram() {
    setBulkLoading(true);
    try {
      const ids = [...selected].filter((id) => payments.find((p) => p.id === id)?.status === "LIBERADO");
      if (ids.length === 0) { toast("Nenhum pagamento liberado selecionado.", "error" as any); return; }
      const r = await api<{ succeeded: number; failed: any[]; total: number }>(
        "/payments/bulk-program", { method: "POST", body: JSON.stringify({ ids, programmedFor: bulkDate }) },
      );
      toast(`${r.succeeded} de ${r.total} programado(s) para ${bulkDate}.${r.failed.length > 0 ? ` ${r.failed.length} falha(s).` : ""}`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBulkLoading(false);
    }
  }

  const payToConfirm  = confirmPay   ? payments.find((p) => p.id === confirmPay)   : null;
  const releasePayment = releaseTarget ? payments.find((p) => p.id === releaseTarget) : null;

  const selectedBlocked  = [...selected].filter((id) => payments.find((p) => p.id === id)?.status === "BLOQUEADO").length;
  const selectedLiberated = [...selected].filter((id) => payments.find((p) => p.id === id)?.status === "LIBERADO").length;

  const canRecalculate = (status: string) =>
    ["AGUARDANDO_FINALIZACAO", "AGUARDANDO_AVALIACAO_CLIENTE", "BLOQUEADO", "LIBERADO"].includes(status);

  return (
    <Page
      title="Financeiro"
      subtitle="Pagamentos só podem ser programados após liberação; bloqueados ficam retidos até SAC resolver"
    >
      {/* CSV Export */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <ActionButton
          className="ghostButton"
          loadingLabel="Exportando..."
          onClick={exportCsv}
        >
          {exporting ? "Exportando..." : "⬇ Exportar CSV"}
        </ActionButton>
      </div>

      {loading ? (
        <LoadingState message="Carregando pagamentos..." />
      ) : (
        <>
          <div className="metricsGrid" style={{ marginBottom: 24 }}>
            <MetricCard label="Bloqueado"          value={fmtCur(totalBlocked)}    tone="danger"  />
            <MetricCard label="Liberado (aguardando)" value={fmtCur(totalReleased)} tone="warn"    />
            <MetricCard label="Programado"         value={fmtCur(totalProgrammed)} tone="neutral" />
            <MetricCard label="Pago"               value={fmtCur(totalPaid)}       tone="ok"      />
          </div>

          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
            Exibindo {payments.length} de {total} registros — página {page} de {totalPages}
          </p>

          {/* Bulk actions bar */}
          {selected.size > 0 && (
            <div style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selecionado(s)</span>
              {selectedBlocked > 0 && (
                <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => setBulkReleaseOpen(true)}>
                  Liberar {selectedBlocked} bloqueado(s)
                </button>
              )}
              {selectedLiberated > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="date"
                    value={bulkDate}
                    onChange={(e) => setBulkDate(e.target.value)}
                    style={{ minHeight: "auto", padding: "6px 8px", fontSize: 13 }}
                  />
                  <button className="ghostButton" style={{ fontSize: 13 }} disabled={bulkLoading} onClick={doBulkProgram}>
                    Programar {selectedLiberated} liberado(s)
                  </button>
                </div>
              )}
              <button className="ghostButton" style={{ fontSize: 13, marginLeft: "auto" }} onClick={() => setSelected(new Set())}>
                Limpar seleção
              </button>
            </div>
          )}

          {/* Bulk release justification modal */}
          {bulkReleaseOpen && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ background: "var(--bg)", borderRadius: 12, padding: 24, maxWidth: 440, width: "90%" }}>
                <h3 style={{ marginTop: 0 }}>Liberar {selectedBlocked} pagamento(s)</h3>
                <label style={{ display: "grid", gap: 6, fontSize: 14, marginBottom: 16 }}>
                  Justificativa
                  <textarea
                    value={bulkJustification}
                    onChange={(e) => setBulkJustification(e.target.value)}
                    placeholder="Motivo da liberação em lote..."
                    style={{ minHeight: 80, fontSize: 14 }}
                  />
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <ActionButton
                    onClick={doBulkRelease}
                    disabled={!bulkJustification.trim() || bulkLoading}
                    loadingLabel="Liberando..."
                  >
                    Confirmar liberação
                  </ActionButton>
                  <button className="ghostButton" onClick={() => { setBulkReleaseOpen(false); setBulkJustification(""); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    style={{ cursor: "pointer" }}
                    onChange={toggleSelectAll}
                    checked={payments.filter((p) => ["BLOQUEADO","LIBERADO"].includes(p.status)).length > 0 &&
                      payments.filter((p) => ["BLOQUEADO","LIBERADO"].includes(p.status)).every((p) => selected.has(p.id))}
                  />
                </th>
                <th>Pedido</th>
                <th>Montador</th>
                <th>Valor comissão</th>
                <th>Status</th>
                <th>Programado para</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                    Nenhum pagamento registrado.
                  </td>
                </tr>
              )}
              {payments.map((payment) => (
                <>
                  <tr key={payment.id} style={{ background: selected.has(payment.id) ? "var(--brand-light, #e8f5e9)" : undefined }}>
                    <td>
                      {["BLOQUEADO","LIBERADO"].includes(payment.status) && (
                        <input
                          type="checkbox"
                          style={{ cursor: "pointer" }}
                          checked={selected.has(payment.id)}
                          onChange={() => toggleSelect(payment.id)}
                        />
                      )}
                    </td>
                    <td><strong>{payment.numped}</strong></td>
                    <td>{payment.provider_name}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong>{fmtCur(Number(payment.amount))}</strong>
                        <button
                          className="ghostButton"
                          style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => setExpandedDetail(expandedDetail === payment.id ? null : payment.id)}
                          title="Ver composição da comissão"
                        >
                          {expandedDetail === payment.id ? "▲ Fechar" : "▼ Detalhe"}
                        </button>
                      </div>
                    </td>
                    <td><StatusBadge value={payment.status} /></td>
                    <td>{payment.programmed_for ?? "—"}</td>
                    <td className="actionsRow">
                      {payment.status === "BLOQUEADO" && (
                        <ActionButton
                          className="ghostButton" loadingLabel="..."
                          onClick={() => setReleaseTarget(payment.id)}
                        >
                          Liberar
                        </ActionButton>
                      )}
                      {payment.status === "LIBERADO" && (
                        <>
                          <input
                            type="date"
                            value={programDate[payment.id] ?? new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setProgramDate((prev) => ({ ...prev, [payment.id]: e.target.value }))}
                            style={{ minHeight: "auto", padding: "6px 8px" }}
                          />
                          <ActionButton loadingLabel="Programando..." onClick={() => doProgram(payment.id)}>
                            Programar
                          </ActionButton>
                        </>
                      )}
                      {payment.status === "PROGRAMADO" && (
                        <ActionButton
                          className="dangerButton" loadingLabel="Processando..."
                          onClick={() => setConfirmPay(payment.id)}
                        >
                          Marcar como pago
                        </ActionButton>
                      )}
                      {payment.status === "PAGO" && (
                        <span style={{ color: "var(--ok)", fontWeight: 700, fontSize: 13 }}>✓ Pago</span>
                      )}
                      {payment.status === "AGUARDANDO_FINALIZACAO" && (
                        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Aguardando montagem</span>
                      )}
                      {payment.status === "AGUARDANDO_AVALIACAO_CLIENTE" && (
                        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Aguardando avaliação</span>
                      )}
                    </td>
                  </tr>

                  {/* Commission detail row */}
                  {expandedDetail === payment.id && (
                    <tr key={`detail-${payment.id}`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <CommissionDetail
                          paymentId={payment.id}
                          onRecalcDone={() => void load()}
                        />
                        {canRecalculate(payment.status) && (
                          <p style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 16px 8px", margin: 0 }}>
                            Status atual permite recálculo da comissão. Pagamentos já pagos não podem ser recalculados automaticamente.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, justifyContent: "center" }}>
              <button className="ghostButton" disabled={page <= 1} onClick={() => goPage(1)}>«</button>
              <button className="ghostButton" disabled={page <= 1} onClick={() => goPage(page - 1)}>‹ Anterior</button>
              <span style={{ fontSize: 13, padding: "0 8px" }}>
                Página <strong>{page}</strong> de <strong>{totalPages}</strong>
              </span>
              <button className="ghostButton" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>Próxima ›</button>
              <button className="ghostButton" disabled={page >= totalPages} onClick={() => goPage(totalPages)}>»</button>
            </div>
          )}
        </>
      )}

      {payToConfirm && (
        <ConfirmDialog
          title="Confirmar pagamento"
          message={`Confirma o pagamento de ${fmtCur(Number(payToConfirm.amount))} para ${payToConfirm.provider_name} (Pedido ${payToConfirm.numped})? Esta ação não pode ser desfeita.`}
          confirmLabel="Sim, confirmar pagamento"
          cancelLabel="Cancelar"
          onConfirm={() => doPay(payToConfirm.id)}
          onCancel={() => setConfirmPay(null)}
        />
      )}

      {releasePayment && (
        <JustifyDialog
          title="Liberar pagamento"
          message={`Informe a justificativa para liberar ${fmtCur(Number(releasePayment.amount))} para ${releasePayment.provider_name} (Pedido ${releasePayment.numped}).`}
          confirmLabel="Liberar pagamento"
          onConfirm={(justification) => doRelease(releasePayment.id, justification)}
          onCancel={() => setReleaseTarget(null)}
        />
      )}
    </Page>
  );
}
