import { useEffect, useMemo, useState } from "react";
import { ActionButton, EmptyState, JustifyDialog, LoadingState, Page, PriorityBadge, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

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
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<any[]>("/sac");
      setCases(data);
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
                <dt>Telefone</dt><dd>{selected.customer_phone ?? "—"}</dd>
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

              {/* Evidence: review score */}
              {selected.review_score != null && (
                <div style={{ background: "var(--bg)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
                  <p className="sectionTitle" style={{ margin: "0 0 8px" }}>Avaliação do cliente</p>
                  <span style={{ fontSize: 24, fontWeight: 700, color: selected.review_score <= 6 ? "var(--danger)" : selected.review_score <= 8 ? "var(--warn)" : "var(--ok)" }}>
                    {selected.review_score}/10
                  </span>
                  {selected.review_complaint && (
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>{selected.review_complaint}</p>
                  )}
                </div>
              )}

              {isOpen && (
                <div className="actionsRow" style={{ marginBottom: 12 }}>
                  {!selected.responsible_user_id && (
                    <ActionButton onClick={() => doAction("assign")} loadingLabel="Assumindo...">
                      Assumir caso
                    </ActionButton>
                  )}
                  <ActionButton
                    className="ghostButton"
                    onClick={() => setShowCloseDialog(true)}
                    loadingLabel="Encerrando..."
                  >
                    Encerrar
                  </ActionButton>
                </div>
              )}

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
