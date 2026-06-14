import React, { useEffect, useMemo, useState } from "react";
import { ActionButton, EmptyState, JustifyDialog, LoadingState, Page, PriorityBadge, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const PHASE_LABELS: Record<string, string> = {
  ATENDIMENTO: "Atendimento",
  ENTREGA: "Entrega",
  MONTAGEM: "Montagem",
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  MONTAGEM: "Montagem",
  ENTREGA: "Entrega",
  ATENDIMENTO: "Atendimento",
  PRODUTO: "Produto",
  PRAZO: "Prazo",
};

function EvalAnswerRow({ answer }: { answer: any }) {
  const label = answer.label ?? "—";
  const type: string = answer.type ?? "TEXT";
  const num: number | null = answer.value_number != null ? Number(answer.value_number) : null;
  const txt: string | null = answer.value_text ?? null;

  let displayValue: React.ReactNode;
  if (type === "SCALE" && num != null) {
    const color = num < 7 ? "var(--danger)" : num < 9 ? "var(--warn)" : "var(--ok)";
    displayValue = <span style={{ fontWeight: 700, color }}>{num}/10</span>;
  } else if (type === "STARS" && num != null) {
    const stars = Math.round(((num / 10) * 4) + 1);
    displayValue = <span style={{ color: "#f59e0b", letterSpacing: 2 }}>{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>;
  } else if (type === "YES_NO") {
    const isYes = txt?.toLowerCase() === "sim" || num === 1;
    displayValue = <span style={{ fontWeight: 700, color: isYes ? "var(--ok)" : "var(--danger)" }}>{isYes ? "Sim" : "Não"}</span>;
  } else {
    displayValue = <span style={{ color: "var(--text-secondary)" }}>{txt ?? "—"}</span>;
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 8 }}>
      <span style={{ color: "var(--text-secondary)", flex: 1 }}>{label}</span>
      <span style={{ flexShrink: 0 }}>{displayValue}</span>
    </div>
  );
}

function casePriority(item: any): "alta" | "media" | "baixa" {
  const daysOpen = (Date.now() - new Date(item.created_at).getTime()) / 86400000;
  if (daysOpen > 3 || item.status === "ABERTO") return "alta";
  if (daysOpen > 1) return "media";
  return "baixa";
}

function SlaIndicator({ createdAt, slaDeadline }: { createdAt: string; slaDeadline: string | null }) {
  if (!slaDeadline) return null;
  const now = Date.now();
  const deadline = new Date(slaDeadline).getTime();
  const start = new Date(createdAt).getTime();
  const total = deadline - start;
  const elapsed = now - start;
  const remaining = deadline - now;
  const hoursLeft = Math.round(remaining / 3600000);
  const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 100;

  const color = pct < 50 ? "var(--ok, #2e7d32)" : pct < 80 ? "var(--warn, #f57f17)" : "var(--danger, #c62828)";
  const label = remaining > 0
    ? `Vence em ${Math.abs(hoursLeft)}h`
    : `Vencido há ${Math.abs(hoursLeft)}h`;

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>SLA — {label}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
        <div style={{ background: color, height: 5, width: `${pct}%`, borderRadius: 4, transition: "width .3s" }} />
      </div>
    </div>
  );
}

export function SacPage() {
  const [cases, setCases] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [note, setNote] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showEvalModal, setShowEvalModal] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<{ rows: any[]; total: number }>("/sac");
      setCases(data.rows ?? []);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return cases;
    const q = search.toLowerCase();
    return cases.filter(
      (c) =>
        c.numped?.toLowerCase().includes(q) ||
        c.customer_name?.toLowerCase().includes(q) ||
        c.reason?.toLowerCase().includes(q),
    );
  }, [cases, search]);

  async function openCase(id: string) {
    try {
      const data = await api<any>(`/sac/${id}`);
      setSelected(data);
      setNote("");
      setResolveNote("");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function doAction(action: string, body: Record<string, string> = {}) {
    if (!selected) return;
    try {
      await api(`/sac/${selected.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      const actionLabel: Record<string, string> = {
        assign: "Caso assumido.",
        note: "Tratativa registrada.",
        resolve: "Caso resolvido com sucesso.",
        close: "Caso encerrado.",
      };
      toast(actionLabel[action] ?? "Ação executada.");
      setNote("");
      setResolveNote("");
      const updated = await api<any>(`/sac/${selected.id}`);
      setSelected(updated);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const isOpen = selected && !["RESOLVIDO", "ENCERRADO", "CANCELADO"].includes(selected.status);

  return (
    <Page
      title="SAC"
      subtitle="Casos abertos por avaliação negativa, reclamação ou inconsistência operacional"
      action={
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar pedido, cliente, motivo..." />
      }
    >
      {loading ? (
        <LoadingState message="Carregando casos SAC..." />
      ) : (
        <div className="splitGrid">
          {/* List */}
          <div>
            {filtered.length === 0 ? (
              <EmptyState
                title="Nenhum caso SAC"
                description={search ? "Ajuste a busca para ver outros casos." : "Ótimo! Não há casos SAC abertos."}
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Prioridade</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Motivo</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      style={{ background: selected?.id === item.id ? "var(--brand-light)" : undefined }}
                    >
                      <td><PriorityBadge level={casePriority(item)} /></td>
                      <td><strong>{item.numped}</strong></td>
                      <td>{item.customer_name}</td>
                      <td
                        style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={item.reason}
                      >
                        {item.reason}
                      </td>
                      <td><StatusBadge value={item.status} /></td>
                      <td>
                        <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => openCase(item.id)}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>
              {filtered.length} caso{filtered.length !== 1 ? "s" : ""}
              {cases.length !== filtered.length ? ` de ${cases.length} total` : ""}
            </p>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="panel" style={{ alignSelf: "start" }}>
              <div className="flowHeader">
                <div>
                  <h2 style={{ margin: "0 0 4px" }}>Caso — Pedido {selected.numped}</h2>
                  <StatusBadge value={selected.status} />
                </div>
                <button className="ghostButton" onClick={() => setSelected(null)}>Fechar</button>
              </div>

              <dl className="descList" style={{ marginBottom: 16 }}>
                <dt>Cliente</dt><dd><strong>{selected.customer_name}</strong></dd>
                <dt>Telefone</dt>
                <dd>{selected.customer_phone ?? selected.winthorClient?.telent ?? "—"}</dd>
                <dt>Data da venda</dt>
                <dd>{selected.winthorOrder?.data ? new Date(selected.winthorOrder.data).toLocaleDateString("pt-BR") : "—"}</dd>
                <dt>RCA</dt>
                <dd>{selected.winthorOrder?.nome_vendedor ?? (selected.winthorOrder?.codusur ? `Cód. ${selected.winthorOrder.codusur}` : "—")}</dd>
                <dt>Filial</dt>
                <dd>{selected.winthorOrder?.codfilial ?? "—"}</dd>
                <dt>Motivo</dt><dd>{selected.reason}</dd>
                <dt>Abertura</dt><dd>{new Date(selected.created_at).toLocaleString("pt-BR")}</dd>
                <dt>Próxima ação</dt><dd>{selected.next_action_date ? new Date(selected.next_action_date).toLocaleDateString("pt-BR") : "—"}</dd>
                <dt>Prazo SLA</dt>
                <dd>
                  {selected.sla_deadline ? (
                    <>
                      {new Date(selected.sla_deadline).toLocaleDateString("pt-BR")}
                      <SlaIndicator createdAt={selected.created_at} slaDeadline={selected.sla_deadline} />
                    </>
                  ) : "—"}
                </dd>
                <dt>Responsável</dt><dd>{selected.responsible_user_id ?? <span style={{ color: "var(--text-muted)" }}>Não atribuído</span>}</dd>
              </dl>

              {selected.description && (
                <blockquote style={{ borderLeft: "3px solid var(--border)", margin: "0 0 16px", padding: "8px 12px", color: "var(--text-secondary)", fontSize: 14 }}>
                  {selected.description}
                </blockquote>
              )}

              {/* Evaluation evidence */}
              {selected.review_score != null && (
                <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, marginBottom: 16, border: "1px solid var(--border)" }}>
                  <p className="sectionTitle" style={{ margin: "0 0 10px" }}>
                    Avaliação do cliente
                    {selected.eval_phase && (
                      <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-muted)", fontSize: 11, textTransform: "none" }}>
                        fase {selected.eval_phase}
                      </span>
                    )}
                  </p>

                  {/* Score + classification */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selected.review_complaint || selected.evalAnswers?.length ? 12 : 0 }}>
                    <span style={{
                      fontSize: 28, fontWeight: 800, lineHeight: 1,
                      color: selected.review_score < 7 ? "var(--danger)" : selected.review_score < 9 ? "var(--warn)" : "var(--ok)",
                    }}>
                      {Number(selected.review_score).toFixed(1)}
                      <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>/10</span>
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase",
                      background: selected.review_classification === "NEGATIVA" ? "var(--danger-light, #fee2e2)"
                               : selected.review_classification === "NEUTRA"   ? "var(--warn-light,  #fef9c3)"
                               : "var(--ok-light, #dcfce7)",
                      color: selected.review_classification === "NEGATIVA" ? "var(--danger)"
                           : selected.review_classification === "NEUTRA"   ? "#92400e"
                           : "var(--ok)",
                    }}>
                      {selected.review_classification ?? "—"}
                    </span>
                  </div>

                  {/* Overall comment */}
                  {selected.review_complaint && (
                    <blockquote style={{ borderLeft: "3px solid var(--danger)", margin: "0 0 12px", padding: "6px 10px", color: "var(--text-secondary)", fontSize: 13 }}>
                      {selected.review_complaint}
                    </blockquote>
                  )}

                  {/* Per-question answers (new eval system) */}
                  {selected.evalAnswers?.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {selected.evalAnswers.map((a: any, i: number) => (
                        <EvalAnswerRow key={i} answer={a} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Order items / products — prefer WinThor (PCPEDI) over MONT_ORDER_ITEMS */}
              {(() => {
                const useWinthor = (selected.winthorItems?.length ?? 0) > 0;
                const items = useWinthor ? selected.winthorItems : (selected.orderItems ?? []);
                if (items.length === 0) return null;
                const vltotal = selected.winthorOrder?.vltotal ?? selected.total_amount;
                return (
                  <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14, marginBottom: 16, border: "1px solid var(--border)" }}>
                    <p className="sectionTitle" style={{ margin: "0 0 10px" }}>
                      Produtos do pedido
                      <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-muted)", fontSize: 11, textTransform: "none" }}>
                        {selected.numped}
                        {vltotal != null && Number(vltotal) > 0 && ` · R$ ${Number(vltotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                      </span>
                    </p>
                    <table style={{ width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          <th style={{ textAlign: "left", fontWeight: 600, paddingBottom: 6 }}>Produto</th>
                          <th style={{ textAlign: "center", fontWeight: 600, paddingBottom: 6, width: 40 }}>Qtde</th>
                          <th style={{ textAlign: "center", fontWeight: 600, paddingBottom: 6, width: 70 }}>Montagem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, i: number) => {
                          const desc = item.descricao ?? item.description ?? "—";
                          const qty = item.qt ?? item.quantity ?? 0;
                          const needsAssembly = (item.requer_montagem === 1) || (item.requires_assembly === 1);
                          return (
                            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "6px 0", color: needsAssembly ? "var(--text)" : "var(--text-secondary)" }}>
                                {needsAssembly && (
                                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--brand)", marginRight: 6, verticalAlign: "middle" }} />
                                )}
                                {desc}
                              </td>
                              <td style={{ textAlign: "center", padding: "6px 0", color: "var(--text-secondary)" }}>{qty}</td>
                              <td style={{ textAlign: "center", padding: "6px 0" }}>
                                {needsAssembly
                                  ? <span style={{ color: "var(--brand)", fontWeight: 700, fontSize: 11 }}>Sim</span>
                                  : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              <div className="actionsRow" style={{ marginBottom: 12 }}>
                {isOpen && !selected.responsible_user_id && (
                  <ActionButton onClick={() => doAction("assign")} loadingLabel="Assumindo...">
                    Assumir caso
                  </ActionButton>
                )}
                {isOpen && (
                  <ActionButton
                    className="ghostButton"
                    onClick={() => setShowCloseDialog(true)}
                    loadingLabel="Encerrando..."
                  >
                    Encerrar
                  </ActionButton>
                )}
                {(selected.review_score != null || (selected.evalAnswers?.length ?? 0) > 0 || (selected.legacyReviews?.length ?? 0) > 0) && (
                  <button
                    className="ghostButton"
                    style={{ fontSize: 13 }}
                    onClick={() => setShowEvalModal(true)}
                  >
                    Ver avaliação
                  </button>
                )}
              </div>

              {isOpen && (
                <div style={{ marginTop: 4, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 8 }}>
                    Adicionar tratativa
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Registre o que foi feito, contato realizado, providência tomada..."
                      rows={3}
                    />
                  </label>
                  <ActionButton
                    onClick={() => { if (note.trim()) doAction("note", { note }); }}
                    disabled={!note.trim()}
                    className="ghostButton"
                    loadingLabel="Registrando..."
                  >
                    Registrar tratativa
                  </ActionButton>
                </div>
              )}

              {isOpen && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)", marginBottom: 8 }}>
                    Resolução
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="Descreva como o caso foi resolvido..."
                      rows={3}
                    />
                  </label>
                  <ActionButton
                    className="dangerButton"
                    onClick={() => { if (resolveNote.trim()) doAction("resolve", { note: resolveNote }); }}
                    disabled={!resolveNote.trim()}
                    loadingLabel="Resolvendo..."
                  >
                    Marcar como resolvido
                  </ActionButton>
                </div>
              )}

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Histórico de tratativas</h3>
                {selected.logs?.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Nenhuma tratativa registrada.</p>
                ) : (
                  <div className="timeline">
                    {selected.logs?.map((log: any) => (
                      <div className="timelineItem" key={log.id}>
                        <span />
                        <div>
                          <strong style={{ textTransform: "capitalize" }}>{log.action.replace(/_/g, " ").toLowerCase()}</strong>
                          {log.note && <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "2px 0 0" }}>{log.note}</p>}
                          <small>{new Date(log.created_at).toLocaleString("pt-BR")}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showEvalModal && selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setShowEvalModal(false)}
        >
          <div
            style={{ background: "var(--bg-white)", borderRadius: 12, padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Formulário respondido</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                  {selected.eval_phase ? `Fase: ${PHASE_LABELS[selected.eval_phase] ?? selected.eval_phase} · ` : ""}
                  Pedido {selected.numped} · {selected.customer_name}
                </p>
              </div>
              <button className="ghostButton" onClick={() => setShowEvalModal(false)}>Fechar</button>
            </div>

            {/* Score summary */}
            {selected.review_score != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "var(--bg)", borderRadius: 8, marginBottom: 20, border: "1px solid var(--border)" }}>
                <span style={{
                  fontSize: 34, fontWeight: 800, lineHeight: 1,
                  color: selected.review_score < 7 ? "var(--danger)" : selected.review_score < 9 ? "var(--warn)" : "var(--ok)",
                }}>
                  {Number(selected.review_score).toFixed(1)}
                  <span style={{ fontSize: 15, fontWeight: 400, color: "var(--text-muted)" }}>/10</span>
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20, textTransform: "uppercase",
                  background: selected.review_classification === "NEGATIVA" ? "#fee2e2" : selected.review_classification === "NEUTRA" ? "#fef9c3" : "#dcfce7",
                  color: selected.review_classification === "NEGATIVA" ? "var(--danger)" : selected.review_classification === "NEUTRA" ? "#92400e" : "var(--ok)",
                }}>
                  {selected.review_classification}
                </span>
              </div>
            )}

            {/* Per-question answers — new evaluation system */}
            {selected.evalAnswers?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {selected.evalAnswers.map((a: any, i: number) => (
                  <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
                      {i + 1}. {a.label}
                    </p>
                    <div style={{ paddingLeft: 12 }}>
                      <EvalAnswerRow answer={a} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Overall comment (new system) */}
            {selected.review_complaint && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>
                  Comentário do cliente
                </p>
                <blockquote style={{ borderLeft: "3px solid var(--danger)", margin: 0, padding: "8px 12px", color: "var(--text-secondary)", fontSize: 14 }}>
                  {selected.review_complaint}
                </blockquote>
              </div>
            )}

            {/* Legacy reviews — old evaluation system (MONT_CUSTOMER_REVIEWS) */}
            {(selected.evalAnswers?.length ?? 0) === 0 && selected.legacyReviews?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {selected.legacyReviews.map((r: any, i: number) => {
                  const scoreNum = Number(r.score);
                  const scoreColor = scoreNum < 7 ? "var(--danger)" : scoreNum < 9 ? "var(--warn)" : "var(--ok)";
                  const classifBg = r.classification === "NEGATIVA" ? "#fee2e2" : r.classification === "NEUTRA" ? "#fef9c3" : "#dcfce7";
                  const classifColor = r.classification === "NEGATIVA" ? "var(--danger)" : r.classification === "NEUTRA" ? "#92400e" : "var(--ok)";
                  return (
                    <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                          {SERVICE_TYPE_LABELS[r.service_type] ?? r.service_type}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {new Date(r.created_at).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: (r.review_comment || r.complaint_reason) ? 10 : 0 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: scoreColor }}>
                          {scoreNum.toFixed(1)}
                          <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>/10</span>
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", background: classifBg, color: classifColor }}>
                          {r.classification}
                        </span>
                      </div>
                      {r.complaint_reason && (
                        <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--text-secondary)" }}>
                          <strong>Motivo:</strong> {r.complaint_reason}
                        </p>
                      )}
                      {r.review_comment && (
                        <blockquote style={{ borderLeft: "3px solid var(--border)", margin: 0, padding: "6px 10px", color: "var(--text-secondary)", fontSize: 13 }}>
                          {r.review_comment}
                        </blockquote>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fallback: no reviews at all in either system */}
            {(selected.evalAnswers?.length ?? 0) === 0 && (selected.legacyReviews?.length ?? 0) === 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
                Respostas detalhadas não disponíveis para esta avaliação.
              </p>
            )}
          </div>
        </div>
      )}

      {showCloseDialog && selected && (
        <JustifyDialog
          title="Encerrar caso SAC"
          message="Informe a justificativa para encerrar este caso administrativamente. Esta ação será registrada na auditoria."
          confirmLabel="Encerrar caso"
          destructive
          onConfirm={(note) => {
            setShowCloseDialog(false);
            doAction("close", { note });
          }}
          onCancel={() => setShowCloseDialog(false)}
        />
      )}
    </Page>
  );
}
