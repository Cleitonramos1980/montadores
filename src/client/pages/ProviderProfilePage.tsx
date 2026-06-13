import { useEffect, useState } from "react";
import { ActionButton, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

type Profile = {
  id: string; name: string; email: string; phone: string | null;
  document: string | null; city: string | null; state: string | null;
  status: string;
  stats: {
    avgScore: number | null; totalJobs: number;
    finishedJobs: number; totalPaid: number; totalPending: number;
  };
};

type Unavailability = { id: string; unavail_date: string; reason: string | null };

type Cert = {
  id: string; cert_type: string; file_url: string | null;
  issued_at: string | null; valid_until: string | null;
  status: string; notes: string | null;
};

type Rework = { id: string; reason: string; status: string; created_at: string; numped: string | null };

function fmtCur(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Stars({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Sem avaliações</span>;
  const filled = Math.round(score / 2);
  return (
    <span title={`${Number(score).toFixed(1)} / 10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ fontSize: 20, color: i < filled ? "#f9a825" : "#ccc" }}>★</span>
      ))}
      <span style={{ fontSize: 13, marginLeft: 6, color: "var(--text-secondary)" }}>
        {Number(score).toFixed(1)}
      </span>
    </span>
  );
}

const CERT_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente", VALIDO: "Válido", EXPIRADO: "Expirado", REPROVADO: "Reprovado",
};
const CERT_STATUS_COLORS: Record<string, string> = {
  PENDENTE: "var(--warn)", VALIDO: "var(--ok)", EXPIRADO: "var(--danger)", REPROVADO: "var(--danger)",
};

// Unavailability calendar — shows next 45 days as chips
function UnavailabilityTab({ providerId }: { providerId: string }) {
  const [blocked, setBlocked]   = useState<Unavailability[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState<string | null>(null);
  const [reason, setReason]     = useState("");
  const toast = useToast();

  useEffect(() => {
    api<Unavailability[]>(`/providers/${providerId}/unavailability`)
      .then(setBlocked)
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [providerId]);

  const blockedSet = new Set(blocked.map((u) => u.unavail_date));

  async function toggleDay(date: string) {
    setSaving(date);
    try {
      if (blockedSet.has(date)) {
        await api(`/providers/${providerId}/unavailability/${date}`, { method: "DELETE" });
        setBlocked((prev) => prev.filter((u) => u.unavail_date !== date));
        toast("Data desbloqueada.");
      } else {
        const r = await api<{ id: string; date: string }>(`/providers/${providerId}/unavailability`, {
          method: "POST",
          body: JSON.stringify({ date, reason: reason.trim() || undefined }),
        });
        setBlocked((prev) => [...prev, { id: r.id, unavail_date: date, reason: reason.trim() || null }]);
        toast("Data bloqueada.");
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(null);
    }
  }

  const days = Array.from({ length: 45 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 86400_000);
    return d.toISOString().slice(0, 10);
  });

  if (loading) return <LoadingState message="Carregando disponibilidade..." />;

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Clique em um dia para bloqueá-lo (vermelho = indisponível). Datas bloqueadas não aparecem para agendamento de clientes.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "grid", gap: 4, maxWidth: 320 }}>
          Motivo do bloqueio (opcional)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: Férias, feriado local..."
            style={{ fontSize: 13 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {days.map((date) => {
          const isBlocked = blockedSet.has(date);
          const isSaving  = saving === date;
          const d = new Date(date + "T12:00:00");
          const label = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
          return (
            <button
              key={date}
              disabled={isSaving}
              onClick={() => toggleDay(date)}
              style={{
                padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${isBlocked ? "var(--danger,#c62828)" : "var(--border)"}`,
                background: isBlocked ? "var(--danger,#c62828)" : "var(--bg)",
                color: isBlocked ? "#fff" : "var(--text)",
                opacity: isSaving ? 0.5 : 1, transition: "all .15s",
              }}
            >
              {isSaving ? "..." : label}
            </button>
          );
        })}
      </div>

      {blocked.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Datas bloqueadas</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {blocked.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>
                  {new Date(u.unavail_date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                </span>
                {u.reason && <span style={{ color: "var(--text-muted)" }}>— {u.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Certifications tab
function CertificationsTab({ providerId }: { providerId: string }) {
  const [certs, setCerts]       = useState<Cert[]>([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ certType: "", fileUrl: "", issuedAt: "", validUntil: "", status: "PENDENTE", notes: "" });
  const toast = useToast();

  useEffect(() => {
    api<Cert[]>(`/providers/${providerId}/certifications`)
      .then(setCerts)
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [providerId]);

  async function addCert() {
    if (!form.certType.trim()) { toast("Informe o tipo da certificação.", "error" as any); return; }
    setSaving(true);
    try {
      await api(`/providers/${providerId}/certifications`, {
        method: "POST",
        body: JSON.stringify({
          certType:   form.certType,
          fileUrl:    form.fileUrl  || undefined,
          issuedAt:   form.issuedAt   || undefined,
          validUntil: form.validUntil || undefined,
          status:     form.status,
          notes:      form.notes || undefined,
        }),
      });
      toast("Certificação adicionada.");
      setAdding(false);
      setForm({ certType: "", fileUrl: "", issuedAt: "", validUntil: "", status: "PENDENTE", notes: "" });
      const updated = await api<Cert[]>(`/providers/${providerId}/certifications`);
      setCerts(updated);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(certId: string, status: string) {
    try {
      await api(`/providers/${providerId}/certifications/${certId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setCerts((prev) => prev.map((c) => c.id === certId ? { ...c, status } : c));
      toast("Status atualizado.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  if (loading) return <LoadingState message="Carregando certificações..." />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          Documentos e certificações obrigatórios do montador.
        </p>
        <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => setAdding(true)}>
          + Adicionar
        </button>
      </div>

      {adding && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Nova certificação</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ fontSize: 13, display: "grid", gap: 4, gridColumn: "1 / -1" }}>
              Tipo *
              <input value={form.certType} onChange={(e) => setForm((f) => ({ ...f, certType: e.target.value }))} placeholder="Ex: RG, Seguro Responsabilidade, Treinamento..." style={{ fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              Emitido em
              <input type="date" value={form.issuedAt} onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))} style={{ fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              Válido até
              <input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} style={{ fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              Status
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={{ fontSize: 13 }}>
                <option value="PENDENTE">Pendente</option>
                <option value="VALIDO">Válido</option>
                <option value="EXPIRADO">Expirado</option>
                <option value="REPROVADO">Reprovado</option>
              </select>
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4 }}>
              URL do arquivo
              <input value={form.fileUrl} onChange={(e) => setForm((f) => ({ ...f, fileUrl: e.target.value }))} placeholder="https://..." style={{ fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13, display: "grid", gap: 4, gridColumn: "1 / -1" }}>
              Observações
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Opcional..." style={{ fontSize: 13 }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <ActionButton onClick={addCert} loadingLabel="Salvando..." disabled={saving}>Salvar</ActionButton>
            <button className="ghostButton" onClick={() => setAdding(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {certs.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Nenhuma certificação cadastrada.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Emitido em</th>
              <th>Válido até</th>
              <th>Status</th>
              <th>Arquivo</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {certs.map((cert) => (
              <tr key={cert.id}>
                <td><strong style={{ fontSize: 13 }}>{cert.cert_type}</strong></td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{cert.issued_at ?? "—"}</td>
                <td style={{ fontSize: 13, color: cert.valid_until && new Date(cert.valid_until) < new Date() ? "var(--danger)" : "var(--text-muted)" }}>
                  {cert.valid_until ?? "—"}
                </td>
                <td>
                  <span style={{ fontWeight: 700, fontSize: 12, color: CERT_STATUS_COLORS[cert.status] ?? "var(--text)" }}>
                    {CERT_STATUS_LABELS[cert.status] ?? cert.status}
                  </span>
                </td>
                <td>
                  {cert.file_url
                    ? <a href={cert.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>Ver arquivo</a>
                    : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>}
                </td>
                <td>
                  <select
                    value={cert.status}
                    onChange={(e) => updateStatus(cert.id, e.target.value)}
                    style={{ fontSize: 12, padding: "4px 8px", minHeight: "auto" }}
                  >
                    <option value="PENDENTE">Pendente</option>
                    <option value="VALIDO">Válido</option>
                    <option value="EXPIRADO">Expirado</option>
                    <option value="REPROVADO">Reprovado</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Reworks tab
function ReworksTab({ providerId }: { providerId: string }) {
  const [reworks, setReworks] = useState<Rework[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api<Rework[]>(`/providers/${providerId}/reworks`)
      .then(setReworks)
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [providerId]);

  if (loading) return <LoadingState message="Carregando retrabalhos..." />;

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        Retrabalhos registrados automaticamente quando um SAC de qualidade de montagem é aberto.
      </p>
      {reworks.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Nenhum retrabalho registrado.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Pedido</th><th>Motivo</th><th>Status</th><th>Data</th></tr>
          </thead>
          <tbody>
            {reworks.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 13 }}>{r.numped ?? "—"}</td>
                <td style={{ fontSize: 13 }}>{r.reason}</td>
                <td>
                  <span style={{ fontWeight: 700, fontSize: 12, color: r.status === "PENDENTE" ? "var(--warn)" : "var(--ok)" }}>
                    {r.status}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {new Date(r.created_at).toLocaleDateString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Monthly Commissions Tab ────────────────────────────────────────────────────

type MonthlyRow = {
  month_key: string; month_label: string; job_count: number;
  total_amount: number; paid_amount: number; pending_amount: number;
};

function MonthlyCommissionsTab({ providerId }: { providerId: string }) {
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api<MonthlyRow[]>(`/providers/${providerId}/commissions/monthly`)
      .then(setRows)
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => setLoading(false));
  }, [providerId]);

  if (loading) return <LoadingState message="Carregando histórico..." />;
  if (rows.length === 0) return <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Nenhum histórico de comissões disponível.</p>;

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Mês</th>
            <th style={{ textAlign: "center" }}>Serviços</th>
            <th style={{ textAlign: "right" }}>Total gerado</th>
            <th style={{ textAlign: "right" }}>Pago</th>
            <th style={{ textAlign: "right" }}>Pendente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month_key}>
              <td style={{ fontWeight: 600 }}>{r.month_label}</td>
              <td style={{ textAlign: "center" }}>{r.job_count}</td>
              <td style={{ textAlign: "right" }}>{fmtCur(Number(r.total_amount))}</td>
              <td style={{ textAlign: "right", color: "var(--ok)", fontWeight: 600 }}>{fmtCur(Number(r.paid_amount))}</td>
              <td style={{ textAlign: "right", color: Number(r.pending_amount) > 0 ? "var(--warn)" : "var(--text-muted)" }}>
                {fmtCur(Number(r.pending_amount))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Main profile page
export function ProviderProfilePage({ id }: { id: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"perfil" | "disponibilidade" | "certificacoes" | "retrabalhos" | "comissoes">("perfil");
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    api<Profile>(`/providers/${id}/profile`)
      .then(setProfile)
      .catch((err) => toast((err as Error).message, "error"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Page title="Perfil do Montador"><LoadingState message="Carregando perfil..." /></Page>;
  if (!profile) return <Page title="Perfil do Montador"><p>Montador não encontrado.</p></Page>;

  const stats = profile.stats ?? {};

  return (
    <Page
      title={profile.name}
      subtitle={`${(profile as any).city ?? ""}${(profile as any).state ? `, ${(profile as any).state}` : ""}`}
    >
      <button className="ghostButton" style={{ marginBottom: 16, fontSize: 13 }} onClick={() => history.back()}>
        ← Voltar
      </button>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <StatusBadge value={profile.status} />
        <Stars score={stats.avgScore ?? null} />
      </div>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Montagens realizadas", value: String(stats.totalJobs ?? 0), tone: "neutral" },
          { label: "Total recebido", value: fmtCur(stats.totalPaid ?? 0), tone: "ok" },
          { label: "A receber", value: fmtCur(stats.totalPending ?? 0), tone: "warn" },
        ].map(({ label, value, tone }) => (
          <div key={label} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--text)" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="tabBar">
        {([
          ["perfil",          "Perfil"],
          ["disponibilidade", "Disponibilidade"],
          ["certificacoes",   "Certificações"],
          ["retrabalhos",     "Retrabalhos"],
          ["comissoes",       "Comissões"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`tabBtn${tab === key ? " tabBtn--active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "perfil" && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Informações de contato</div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 20px", fontSize: 13, margin: 0 }}>
            {([
              ["E-mail", profile.email],
              ["Telefone", (profile as any).phone ?? "—"],
              ["CPF/CNPJ", (profile as any).document ?? "—"],
              ["Cidade", (profile as any).city ?? "—"],
              ["Estado", (profile as any).state ?? "—"],
            ] as [string, string][]).map(([label, value]) => (
              <>
                <dt key={`dt-${label}`} style={{ color: "var(--text-muted)", fontWeight: 600 }}>{label}</dt>
                <dd key={`dd-${label}`} style={{ margin: 0 }}>{value}</dd>
              </>
            ))}
          </dl>
        </div>
      )}

      {tab === "disponibilidade"  && <UnavailabilityTab      providerId={id} />}
      {tab === "certificacoes"    && <CertificationsTab      providerId={id} />}
      {tab === "retrabalhos"      && <ReworksTab             providerId={id} />}
      {tab === "comissoes"        && <MonthlyCommissionsTab  providerId={id} />}
    </Page>
  );
}
