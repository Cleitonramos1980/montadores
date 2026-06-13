import { useEffect, useState } from "react";
import { ActionButton, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api, getToken } from "../lib/api";
import { forceSync, getQueueStatus, isOnline, onSyncCompleted, type QueueStatus } from "../lib/offlineQueue";

const STEPS = ["Agendada", "Iniciar", "Fotografar", "Finalizar"];

function jobStep(status: string, photoCount: number): number {
  if (status === "AGENDADA") return 0;
  if (status === "EM_EXECUCAO" && photoCount === 0) return 1;
  if (status === "EM_EXECUCAO" && photoCount > 0) return 2;
  if (status === "FINALIZADA") return 3;
  return 0;
}

function parseAddress(raw: any): string {
  if (!raw) return "—";
  try {
    const addr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return [addr.street, addr.city, addr.uf].filter(Boolean).join(", ") || "—";
  } catch {
    return "—";
  }
}

function fmtDate(val: any): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(val);
  }
}

function fmtDatetime(val: any): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(val);
  }
}

function fmtCurrency(val: any): string {
  const n = Number(val ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const PAYMENT_LABELS: Record<string, string> = {
  AGUARDANDO_FINALIZACAO: "Aguardando finalização",
  AGUARDANDO_AVALIACAO_CLIENTE: "Aguardando avaliação",
  LIBERADO: "Liberado para pagamento",
  PAGO: "Pago",
  BLOQUEADO: "Bloqueado",
};

// ─── Aba: Jobs ativos ──────────────────────────────────────────────────────────

function ActiveJobDetail({
  job,
  onBack,
  onRefresh,
}: {
  job: any;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [photoFile, setPhotoFile]   = useState<File | null>(null);
  const [preview, setPreview]       = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const toast = useToast();
  const photoCount = Number(job.photo_count);
  const step = jobStep(job.status, photoCount);
  const canFinish = job.status === "EM_EXECUCAO" && photoCount >= 2;

  async function doAction(action: "start" | "finish") {
    try {
      await api(`/assembly/${job.id}/${action}`, { method: "POST", body: "{}" });
      toast(action === "start" ? "Montagem iniciada!" : "Montagem finalizada com sucesso!");
      onRefresh();
      if (action === "finish") onBack();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function addPhoto() {
    if (!photoFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", photoFile);
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      if (!resp.ok) throw new Error("Falha no upload da imagem.");
      const { url } = await resp.json() as { url: string };
      await api(`/assembly/${job.id}/photos`, {
        method: "POST",
        body: JSON.stringify({ fileUrl: url, photoType: "EVIDENCIA" }),
      });
      setPhotoFile(null);
      setPreview(null);
      toast("Foto registrada.");
      onRefresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) setPreview(URL.createObjectURL(file));
    else setPreview(null);
  }

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button className="ghostButton" onClick={onBack}>← Voltar</button>
        <StatusBadge value={job.status} />
      </div>

      <div className="stepProgress" style={{ marginBottom: 20 }}>
        {STEPS.map((s, i) => (
          <div key={s} className={`step${i < step ? " done" : i === step ? " current" : ""}`}>
            <div className="stepDot">{i < step ? "✓" : i + 1}</div>
            <span className="stepLabel">{s}</span>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 12px" }}>Pedido {job.numped}</h2>
        <dl className="descList">
          <dt>Cliente</dt><dd><strong>{job.customer_name}</strong></dd>
          <dt>Telefone</dt><dd>{job.customer_phone ?? "—"}</dd>
          <dt>Endereço</dt><dd>{parseAddress(job.address_json)}</dd>
          {job.scheduled_date && (
            <>
              <dt>Data agendada</dt>
              <dd>
                {new Date(job.scheduled_date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                {" — "}
                {job.scheduled_period === "MANHA" ? "Manhã" : "Tarde"}
              </dd>
            </>
          )}
          <dt>Fotos</dt><dd>{job.photo_count} foto(s) registrada(s)</dd>
        </dl>
      </div>

      {job.status === "AGENDADA" && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Confirme chegada ao local e inicie a montagem.
          </p>
          <ActionButton onClick={() => doAction("start")} loadingLabel="Iniciando..." className="">
            ▶ Iniciar montagem
          </ActionButton>
        </div>
      )}

      {job.status === "EM_EXECUCAO" && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
            📷 Fotos de evidência
            <span style={{ fontWeight: 400, fontSize: 13, color: "var(--text-muted)", marginLeft: 8 }}>
              {photoCount}/2 mínimas
            </span>
          </h3>
          {photoCount < 2 && (
            <div style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 6, padding: 12, marginBottom: 12, color: "var(--warn)", fontSize: 14 }}>
              Adicione ao menos 2 fotos antes de finalizar. ({2 - photoCount} restante{2 - photoCount !== 1 ? "s" : ""})
            </div>
          )}

          <label style={{ display: "block", marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 6 }}>Tirar foto ou selecionar da galeria</div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              style={{ fontSize: 14, width: "100%" }}
            />
          </label>

          {preview && (
            <div style={{ marginBottom: 12 }}>
              <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: "cover" }} />
            </div>
          )}

          <ActionButton
            onClick={addPhoto}
            disabled={!photoFile || uploading}
            className="ghostButton"
            loadingLabel="Enviando foto..."
          >
            {uploading ? "Enviando..." : "📤 Enviar foto"}
          </ActionButton>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <ActionButton onClick={() => doAction("finish")} disabled={!canFinish} loadingLabel="Finalizando..." className="dangerButton">
              ✓ Finalizar montagem
            </ActionButton>
            {!canFinish && (
              <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
                Adicione ao menos 2 fotos antes de finalizar.
              </p>
            )}
          </div>
        </div>
      )}

      {job.status === "FINALIZADA" && (
        <div className="panel" style={{ background: "var(--ok-bg)", borderColor: "var(--ok-border)", textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
          <h3 style={{ color: "var(--ok)", margin: "0 0 8px" }}>Montagem finalizada!</h3>
          <p style={{ color: "var(--ok)", fontSize: 14 }}>O cliente será notificado para avaliar o serviço.</p>
        </div>
      )}
    </main>
  );
}

// ─── Aba: Histórico ────────────────────────────────────────────────────────────

function HistoryJobDetail({ job, onBack, onInvoiceSaved }: { job: any; onBack: () => void; onInvoiceSaved: () => void }) {
  const [invoiceUrl, setInvoiceUrl] = useState(job.invoice_url ?? "");
  const [editing, setEditing] = useState(!job.invoice_url);
  const toast = useToast();

  async function saveInvoice() {
    if (!invoiceUrl.trim()) return;
    try {
      await api(`/assembly/${job.id}/invoice`, {
        method: "POST",
        body: JSON.stringify({ invoiceUrl: invoiceUrl.trim() }),
      });
      toast("Nota fiscal registrada com sucesso!");
      setEditing(false);
      onInvoiceSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const payStatus = job.payment_status ?? "—";

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <button className="ghostButton" onClick={onBack} style={{ marginBottom: 16 }}>← Voltar ao histórico</button>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Pedido {job.numped}</h2>
          <StatusBadge value={job.status} />
        </div>
        <dl className="descList">
          <dt>Cliente</dt><dd><strong>{job.customer_name}</strong></dd>
          <dt>Telefone</dt><dd>{job.customer_phone ?? "—"}</dd>
          <dt>Endereço</dt><dd>{parseAddress(job.address_json)}</dd>
          {job.scheduled_date && (
            <>
              <dt>Data agendada</dt>
              <dd>
                {new Date(job.scheduled_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                {" — "}{job.scheduled_period === "MANHA" ? "Manhã" : "Tarde"}
              </dd>
            </>
          )}
          <dt>Início</dt><dd>{fmtDatetime(job.started_at)}</dd>
          <dt>Finalização</dt><dd>{fmtDatetime(job.finished_at)}</dd>
          <dt>Fotos</dt><dd>{job.photo_count} foto(s)</dd>
        </dl>
      </div>

      {/* Produtos montados */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📦 Produtos montados</h3>
        {!job.items || job.items.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>Sem itens registrados.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ paddingBottom: 6, fontWeight: 600 }}>Produto</th>
                <th style={{ paddingBottom: 6, fontWeight: 600, textAlign: "center" }}>Qtd</th>
                <th style={{ paddingBottom: 6, fontWeight: 600, textAlign: "right" }}>Valor unit.</th>
              </tr>
            </thead>
            <tbody>
              {job.items.map((item: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 0" }}>
                    <div style={{ fontWeight: 500 }}>{item.description}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.product_id}</div>
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "center" }}>{item.quantity}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{fmtCurrency(item.assembly_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ paddingTop: 8, fontWeight: 600, textAlign: "right" }}>Total serviço:</td>
                <td style={{ paddingTop: 8, fontWeight: 700, textAlign: "right", color: "var(--brand)" }}>
                  {fmtCurrency(
                    job.items.reduce((acc: number, i: any) => acc + Number(i.quantity) * Number(i.assembly_cost), 0),
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Pagamento */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>💰 Pagamento</h3>
        <dl className="descList">
          <dt>Status</dt>
          <dd>
            <span style={{
              display: "inline-block",
              padding: "2px 10px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              background: payStatus === "PAGO" ? "var(--ok-bg)" : payStatus === "LIBERADO" ? "#e8f5e9" : "var(--warn-bg)",
              color: payStatus === "PAGO" ? "var(--ok)" : payStatus === "LIBERADO" ? "#2e7d32" : "var(--warn)",
            }}>
              {PAYMENT_LABELS[payStatus] ?? payStatus}
            </span>
          </dd>
          {job.payment_amount && Number(job.payment_amount) > 0 && (
            <>
              <dt>Valor</dt><dd><strong>{fmtCurrency(job.payment_amount)}</strong></dd>
            </>
          )}
          {job.invoice_submitted_at && (
            <>
              <dt>Nota enviada em</dt><dd>{fmtDatetime(job.invoice_submitted_at)}</dd>
            </>
          )}
        </dl>

        {/* Invoice upload */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>📎 Nota fiscal para pagamento</h4>
          {job.invoice_url && !editing ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <a href={job.invoice_url} target="_blank" rel="noreferrer"
                style={{ color: "var(--brand)", fontSize: 14, wordBreak: "break-all" }}>
                🔗 Ver nota fiscal
              </a>
              <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => setEditing(true)}>Substituir</button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Cole aqui o link da sua nota fiscal (Google Drive, Dropbox, NFS-e, etc.)
              </label>
              <input
                value={invoiceUrl}
                onChange={(e) => setInvoiceUrl(e.target.value)}
                placeholder="https://..."
                style={{ fontSize: 15 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <ActionButton onClick={saveInvoice} disabled={!invoiceUrl.trim()} loadingLabel="Salvando..." className="">
                  Enviar nota fiscal
                </ActionButton>
                {job.invoice_url && (
                  <button className="ghostButton" onClick={() => { setInvoiceUrl(job.invoice_url); setEditing(false); }}>
                    Cancelar
                  </button>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                Seu pagamento só será processado após o envio da nota.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ─── Dashboard summary card ───────────────────────────────────────────────────

function DashboardCard({ weekJobs, pendingBalance, expiringDocs }: { weekJobs: number; pendingBalance: number; expiringDocs: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20, maxWidth: 700 }}>
      <div className="panel" style={{ textAlign: "center", padding: "14px 10px" }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--brand)" }}>{weekJobs}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>montagens esta semana</div>
      </div>
      <div className="panel" style={{ textAlign: "center", padding: "14px 10px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--brand)" }}>
          {pendingBalance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>saldo a receber</div>
      </div>
      <div className="panel" style={{ textAlign: "center", padding: "14px 10px", background: expiringDocs > 0 ? "var(--warn-bg)" : undefined }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: expiringDocs > 0 ? "var(--warn)" : "var(--ok)" }}>{expiringDocs}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>docs vencendo (30d)</div>
      </div>
    </div>
  );
}

// ─── Notificações ─────────────────────────────────────────────────────────────

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  numped: string | null;
  assembly_job_id: string | null;
  read_at: string | null;
  created_at: string;
};

function NotificationsPanel({
  notifications,
  loading,
  onMarkRead,
}: {
  notifications: NotificationItem[];
  loading: boolean;
  onMarkRead: (id: string) => void;
}) {
  if (loading) return <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 14 }}>Carregando...</div>;
  if (notifications.length === 0) {
    return (
      <div className="emptyState">
        <div className="emptyIcon">🔔</div>
        <strong>Sem notificações</strong>
        <p>Notificações de novas montagens aparecerão aqui.</p>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 700 }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          style={{
            background: n.read_at ? "var(--bg-secondary)" : "var(--bg-card)",
            border: `1px solid ${n.read_at ? "var(--border)" : "var(--brand)"}`,
            borderRadius: 8, padding: "12px 16px",
            opacity: n.read_at ? 0.7 : 1,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: n.read_at ? "var(--text-secondary)" : "var(--text-primary)" }}>
                {n.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, whiteSpace: "pre-line" }}>
                {n.body}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                {fmtDatetime(n.created_at)}
              </div>
            </div>
            {!n.read_at && (
              <button
                className="ghostButton"
                style={{ fontSize: 12, flexShrink: 0 }}
                onClick={() => onMarkRead(n.id)}
              >
                Marcar lida
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ProviderAppPage() {
  const [tab, setTab] = useState<"ativas" | "notificacoes" | "historico">("ativas");
  const [jobs, setJobs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotif, setLoadingNotif] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [historySelected, setHistorySelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [dashboard, setDashboard] = useState<{ weekJobs: number; pendingBalance: number; expiringDocs: number } | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ pendingActions: 0, pendingPhotos: 0 });
  const toast = useToast();

  const loadActive = async () => {
    try {
      const data = await api<any[]>("/assembly/jobs");
      setJobs(data);
      if (selected) {
        const fresh = data.find((j: any) => j.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const data = await api<any[]>("/assembly/provider/history");
      setHistory(data);
      if (historySelected) {
        const fresh = data.find((j: any) => j.id === historySelected.id);
        if (fresh) setHistorySelected(fresh);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadNotifications = async () => {
    setLoadingNotif(true);
    try {
      const data = await api<{ rows: NotificationItem[]; unread: number }>("/provider-notifications");
      setNotifications(data.rows);
      setUnreadCount(data.unread);
    } catch {
      // silently fail — notifications are non-critical
    } finally {
      setLoadingNotif(false);
    }
  };

  const markNotifRead = async (id: string) => {
    try {
      await api(`/provider-notifications/${id}/read`, { method: "PATCH", body: "{}" });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* silently */ }
  };

  useEffect(() => {
    void loadActive();
    void loadNotifications();
    api<{ weekJobs: number; pendingBalance: number; expiringDocs: number }>("/assembly/provider/dashboard")
      .then(setDashboard)
      .catch(() => {});

    // Monitora status online/offline e fila pendente
    const handleOnline  = () => { setOnline(true);  void getQueueStatus().then(setQueueStatus); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    void getQueueStatus().then(setQueueStatus);
    const unsubSync = onSyncCompleted(() => void getQueueStatus().then(setQueueStatus));
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubSync();
    };
  }, []);

  useEffect(() => {
    if (tab === "historico" && history.length === 0) void loadHistory();
  }, [tab]);

  const active = jobs.filter((j) => j.status !== "CANCELADA" && j.status !== "FINALIZADA");

  // Detail views
  if (selected) {
    return (
      <ActiveJobDetail
        job={selected}
        onBack={() => setSelected(null)}
        onRefresh={loadActive}
      />
    );
  }

  if (historySelected) {
    return (
      <HistoryJobDetail
        job={historySelected}
        onBack={() => setHistorySelected(null)}
        onInvoiceSaved={() => {
          void loadHistory();
          setHistorySelected((prev: any) => prev ? { ...prev, invoice_url: "reloading" } : prev);
        }}
      />
    );
  }

  const pendingTotal = queueStatus.pendingActions + queueStatus.pendingPhotos;

  return (
    <Page title="Portal do Montador" subtitle="Suas montagens e histórico completo">
      {/* Banner de status offline */}
      {!online && (
        <div style={{ background: "#ff6f00", color: "#fff", padding: "8px 14px", borderRadius: 6, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Sem internet — ações serão sincronizadas quando voltar a conectar.</span>
          {pendingTotal > 0 && <span style={{ fontWeight: 700 }}>{pendingTotal} pendente(s)</span>}
        </div>
      )}
      {online && pendingTotal > 0 && (
        <div style={{ background: "#e8f5e9", border: "1px solid var(--brand)", color: "var(--brand)", padding: "8px 14px", borderRadius: 6, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{pendingTotal} ação(ões) offline aguardando sincronização.</span>
          <button className="ghostButton" onClick={() => { forceSync(); void getQueueStatus().then(setQueueStatus); }}>
            Sincronizar agora
          </button>
        </div>
      )}
      {dashboard && (
        <DashboardCard
          weekJobs={dashboard.weekJobs}
          pendingBalance={dashboard.pendingBalance}
          expiringDocs={dashboard.expiringDocs}
        />
      )}
      {/* Tabs + link para histórico analítico */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: "2px solid var(--border)", marginBottom: 20 }}>
        {([
          { key: "ativas",       label: `Ativas (${active.length})` },
          { key: "notificacoes", label: unreadCount > 0 ? `Notificações (${unreadCount})` : "Notificações" },
          { key: "historico",    label: `Histórico (${history.length})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "10px 20px",
              border: "none",
              background: "transparent",
              borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -2,
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? "var(--brand)" : t.key === "notificacoes" && unreadCount > 0 ? "var(--warn)" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
              position: "relative",
            }}
          >
            {t.label}
          </button>
        ))}
        <a
          href="/montadores/app/minhas-montagens"
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--brand)",
            border: "1px solid var(--brand)",
            borderRadius: 20,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          📊 Minhas Montagens
        </a>
      </div>

      {/* Aba: Ativas */}
      {tab === "ativas" && (
        loading ? <LoadingState /> :
        active.length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">🔨</div>
            <strong>Nenhuma montagem ativa</strong>
            <p>Quando você for designado para uma montagem, ela aparecerá aqui.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, maxWidth: 700 }}>
            {active.map((job) => {
              const step = jobStep(job.status, Number(job.photo_count));
              return (
                <button
                  key={job.id}
                  className="jobCard"
                  onClick={() => setSelected(job)}
                  style={{ textAlign: "left", width: "100%", display: "block" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <strong style={{ fontSize: 16 }}>Pedido {job.numped}</strong>
                      <p style={{ margin: "2px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>{job.customer_name}</p>
                      {job.scheduled_date && (
                        <p style={{ margin: "2px 0 0", color: "var(--brand)", fontSize: 13, fontWeight: 600 }}>
                          📅 {new Date(job.scheduled_date + "T12:00:00").toLocaleDateString("pt-BR")} — {job.scheduled_period === "MANHA" ? "Manhã" : "Tarde"}
                        </p>
                      )}
                      {job.address_json && (
                        <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                          📍 {parseAddress(job.address_json)}
                        </p>
                      )}
                    </div>
                    <StatusBadge value={job.status} />
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Etapa {step + 1}/4: {STEPS[step]}</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>📷 {job.photo_count} foto(s)</span>
                  </div>
                  <div style={{ marginTop: 10, background: "var(--border)", borderRadius: 4, height: 4 }}>
                    <div style={{ background: "var(--brand)", borderRadius: 4, height: 4, width: `${(step / 3) * 100}%`, transition: "width .3s" }} />
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* Aba: Notificações */}
      {tab === "notificacoes" && (
        <NotificationsPanel
          notifications={notifications}
          loading={loadingNotif}
          onMarkRead={markNotifRead}
        />
      )}

      {/* Aba: Histórico */}
      {tab === "historico" && (
        loadingHistory ? <LoadingState /> :
        history.length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">📋</div>
            <strong>Nenhuma montagem finalizada</strong>
            <p>Seu histórico de serviços aparecerá aqui após finalizar montagens.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, maxWidth: 700 }}>
            {history.map((job) => {
              const hasInvoice = !!job.invoice_url;
              const payStatus = job.payment_status ?? "";
              const needsInvoice = !hasInvoice && payStatus !== "PAGO";
              return (
                <button
                  key={job.id}
                  className="jobCard"
                  onClick={() => setHistorySelected(job)}
                  style={{ textAlign: "left", width: "100%", display: "block" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <strong style={{ fontSize: 15 }}>Pedido {job.numped}</strong>
                      <p style={{ margin: "2px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>{job.customer_name}</p>
                      <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 12 }}>📍 {parseAddress(job.address_json)}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <StatusBadge value={payStatus || "FINALIZADA"} />
                      {job.payment_amount && Number(job.payment_amount) > 0 && (
                        <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700, color: "var(--brand)" }}>
                          {fmtCurrency(job.payment_amount)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                    <span>📅 {fmtDate(job.finished_at ?? job.scheduled_date)}</span>
                    <span>📷 {job.photo_count} foto(s)</span>
                    <span>📦 {Array.isArray(job.items) ? job.items.length : 0} produto(s)</span>
                    {hasInvoice ? (
                      <span style={{ color: "var(--ok)", fontWeight: 600 }}>✓ Nota fiscal enviada</span>
                    ) : needsInvoice ? (
                      <span style={{ color: "var(--warn)", fontWeight: 600 }}>⚠ Nota fiscal pendente</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}
    </Page>
  );
}
