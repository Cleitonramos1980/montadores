import { useEffect, useState } from "react";
import { LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const RECIPIENT_BADGE_STYLE: Record<string, React.CSSProperties> = {
  CLIENTE:    { background: "#e3f2fd", color: "#1565c0", border: "1px solid #90caf9" },
  FORNECEDOR: { background: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" },
  INTERNO:    { background: "var(--bg-secondary)", color: "var(--text-muted)", border: "1px solid var(--border)" },
};

const RECIPIENT_VARS: Record<string, string> = {
  CLIENTE:    "{{cliente}}, {{numped}}, {{link_jornada}}, {{data_montagem}}, {{montador}}, {{protocolo_sac}}, {{nome_empresa}}, {{dominio_oficial}}, {{telefone_sac}}",
  FORNECEDOR: "{{fornecedor}}, {{numped}}, {{valor}}, {{data_pagamento}}, {{link_app}}, {{data_montagem}}, {{telefone_sac}}",
  INTERNO:    "{{numped}}, {{evento}}",
};

const defaultBodyFor = (eventType: string, recipient: string) => {
  const label = eventType.toLowerCase().replaceAll("_", " ");
  if (recipient === "FORNECEDOR") {
    return `Olá, {{fornecedor}}. Informação sobre o pedido {{numped}}: ${label}.`;
  }
  return `Olá, {{cliente}}. Atualização do pedido {{numped}}: ${label}. Acompanhe pelo link {{link_jornada}}.`;
};

type TemplateRow = {
  phaseOrder: number;
  eventType: string;
  recipient: "CLIENTE" | "FORNECEDOR" | "INTERNO";
  sendToCustomer: boolean;
  sendToProvider: boolean;
  template: {
    channel: string;
    subject: string;
    body: string;
    active: number;
    cta_label?: string;
    cta_url_var?: string;
    antifraude_type?: string;
    resend_allowed?: number;
    resend_after_h?: number;
    max_resends?: number;
    send_hour_start?: number;
    send_hour_end?: number;
  } | null;
};

const FILTER_OPTIONS = [
  { key: "TODOS",      label: "Todos" },
  { key: "CLIENTE",    label: "Cliente" },
  { key: "FORNECEDOR", label: "Fornecedor" },
  { key: "INTERNO",    label: "Interno" },
];

type FormState = {
  channel: string;
  subject: string;
  body: string;
  active: boolean;
  recipient: string;
  ctaLabel: string;
  ctaUrlVar: string;
  antifraudeType: string;
  resendAllowed: boolean;
  resendAfterH: string;
  maxResends: string;
  sendHourStart: string;
  sendHourEnd: string;
};

const EMPTY_FORM: FormState = {
  channel: "WHATSAPP",
  subject: "",
  body: "",
  active: true,
  recipient: "CLIENTE",
  ctaLabel: "",
  ctaUrlVar: "",
  antifraudeType: "",
  resendAllowed: false,
  resendAfterH: "",
  maxResends: "0",
  sendHourStart: "8",
  sendHourEnd: "21",
};

export function MessageTemplatesPage() {
  const [rows, setRows]         = useState<TemplateRow[]>([]);
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  const [form, setForm]         = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [filter, setFilter]     = useState("TODOS");
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<TemplateRow[]>("/message-templates");
      setRows(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  function edit(row: TemplateRow) {
    setSelected(row);
    const t = row.template;
    setForm({
      channel:        t?.channel         ?? "WHATSAPP",
      subject:        t?.subject         ?? "",
      body:           t?.body            ?? defaultBodyFor(row.eventType, row.recipient),
      active:         t?.active !== 0,
      recipient:      row.recipient,
      ctaLabel:       t?.cta_label       ?? "",
      ctaUrlVar:      t?.cta_url_var     ?? "",
      antifraudeType: t?.antifraude_type ?? "",
      resendAllowed:  (t?.resend_allowed ?? 0) === 1,
      resendAfterH:   String(t?.resend_after_h ?? ""),
      maxResends:     String(t?.max_resends ?? "0"),
      sendHourStart:  String(t?.send_hour_start ?? 8),
      sendHourEnd:    String(t?.send_hour_end ?? 21),
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/message-templates/${selected.eventType}`, {
        method: "PUT",
        body: JSON.stringify({
          channel:        form.channel,
          subject:        form.subject || undefined,
          body:           form.body,
          active:         form.active,
          recipient:      form.recipient,
          ctaLabel:       form.ctaLabel       || undefined,
          ctaUrlVar:      form.ctaUrlVar       || undefined,
          antifraudeType: form.antifraudeType  || undefined,
          resendAllowed:  form.resendAllowed ? 1 : 0,
          resendAfterH:   form.resendAfterH  ? Number(form.resendAfterH)  : undefined,
          maxResends:     form.maxResends    ? Number(form.maxResends)    : 0,
          sendHourStart:  Number(form.sendHourStart),
          sendHourEnd:    Number(form.sendHourEnd),
        }),
      });
      toast(`Template salvo: ${selected.eventType.replaceAll("_", " ").toLowerCase()}.`);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const f = (key: keyof FormState, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const displayed = filter === "TODOS" ? rows : rows.filter((r) => r.recipient === filter);

  return (
    <Page title="Configuração de Mensagens" subtitle="Régua de envio — cliente, fornecedor e notificações internas">
      {loading ? (
        <LoadingState message="Carregando templates..." />
      ) : (
        <div className="splitGrid">
          {/* ── Left panel ── */}
          <section className="panel">
            <h2>Fases da régua</h2>

            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              {FILTER_OPTIONS.map((opt) => {
                const active = filter === opt.key;
                const count = opt.key === "TODOS" ? rows.length : rows.filter((r) => r.recipient === opt.key).length;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setFilter(opt.key)}
                    style={{
                      padding: "4px 12px", fontSize: 12, borderRadius: 20, cursor: "pointer",
                      border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      background: active ? "var(--brand)" : "var(--bg-secondary)",
                      color: active ? "#fff" : "var(--text-secondary)",
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {opt.label} <span style={{ opacity: 0.8 }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Recipient legend */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {(["CLIENTE", "FORNECEDOR", "INTERNO"] as const).map((r) => (
                <span key={r} style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, ...RECIPIENT_BADGE_STYLE[r] }}>
                  {r === "CLIENTE" ? "ENVIA CLIENTE" : r}
                </span>
              ))}
            </div>

            <div className="templateList">
              {displayed.map((row) => (
                <button
                  className="templateRow"
                  key={row.eventType}
                  onClick={() => edit(row)}
                  style={{ background: selected?.eventType === row.eventType ? "var(--brand-light)" : undefined }}
                >
                  <span style={{ minWidth: 22, textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>
                    {row.phaseOrder.toString().padStart(2, "0")}
                  </span>
                  <strong style={{ flex: 1, textAlign: "left", fontSize: 13 }}>
                    {row.eventType.replaceAll("_", " ")}
                  </strong>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap", flexShrink: 0, ...RECIPIENT_BADGE_STYLE[row.recipient] }}>
                    {row.recipient}
                  </span>
                  <StatusBadge
                    value={row.template?.active === 0 ? "INATIVO" : row.template ? "CONFIGURADO" : "PENDENTE"}
                  />
                </button>
              ))}
            </div>
          </section>

          {/* ── Right panel — editor ── */}
          <section className="panel">
            {selected ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <h2 style={{ margin: 0, flex: 1, fontSize: 16 }}>
                    {selected.eventType.replaceAll("_", " ")}
                  </h2>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, ...RECIPIENT_BADGE_STYLE[selected.recipient] }}>
                    {selected.recipient === "CLIENTE" ? "ENVIA AO CLIENTE" : selected.recipient === "FORNECEDOR" ? "ENVIA AO FORNECEDOR" : "INTERNO"}
                  </span>
                </div>

                <form className="formGrid singleColumn" onSubmit={save}>

                  {/* Destinatário + Canal */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      Destinatário
                      <select value={form.recipient} onChange={(e) => f("recipient", e.target.value)}>
                        <option value="CLIENTE">Cliente</option>
                        <option value="FORNECEDOR">Fornecedor / Montador</option>
                        <option value="INTERNO">Interno (sem envio)</option>
                      </select>
                    </label>
                    <label>
                      Canal de envio
                      <select value={form.channel} onChange={(e) => f("channel", e.target.value)}>
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="SMS">SMS</option>
                        <option value="EMAIL">E-mail</option>
                      </select>
                    </label>
                  </div>

                  <label>
                    Assunto <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(opcional — e-mail)</span>
                    <input
                      value={form.subject}
                      onChange={(e) => f("subject", e.target.value)}
                      placeholder="Ex: Atualização do pedido {{numped}}"
                    />
                  </label>

                  <label>
                    Mensagem
                    <textarea
                      value={form.body}
                      onChange={(e) => f("body", e.target.value)}
                      rows={8}
                    />
                  </label>

                  <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 6, fontSize: 12 }}>
                    <strong>Variáveis ({form.recipient}):</strong>{" "}
                    {RECIPIENT_VARS[form.recipient] ?? RECIPIENT_VARS.INTERNO}
                  </div>

                  {/* CTA */}
                  <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px" }}>
                    <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Botão / CTA</legend>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label>
                        Texto do botão
                        <input
                          value={form.ctaLabel}
                          onChange={(e) => f("ctaLabel", e.target.value)}
                          placeholder="Ex: Ver minha jornada"
                        />
                      </label>
                      <label>
                        Variável de URL
                        <input
                          value={form.ctaUrlVar}
                          onChange={(e) => f("ctaUrlVar", e.target.value)}
                          placeholder="Ex: {{link_jornada}}"
                        />
                      </label>
                    </div>
                  </fieldset>

                  {/* Antifraude */}
                  <label>
                    Tipo de aviso antifraude
                    <select value={form.antifraudeType} onChange={(e) => f("antifraudeType", e.target.value)}>
                      <option value="">Nenhum</option>
                      <option value="ENTREGADOR">Entregador</option>
                      <option value="MONTADOR">Montador</option>
                      <option value="LINK_PESSOAL">Link pessoal</option>
                      <option value="POS_ENTREGA">Pós-entrega</option>
                    </select>
                  </label>

                  {/* Reenvio */}
                  <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px" }}>
                    <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Reenvio automático</legend>

                    <label className="inlineCheck" style={{ marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={form.resendAllowed}
                        onChange={(e) => f("resendAllowed", e.target.checked)}
                      />
                      Permitir reenvio automático
                    </label>

                    {form.resendAllowed && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label>
                          Reenviar após (horas)
                          <input
                            type="number" min={1} max={720}
                            value={form.resendAfterH}
                            onChange={(e) => f("resendAfterH", e.target.value)}
                          />
                        </label>
                        <label>
                          Máximo de reenvios
                          <input
                            type="number" min={0} max={10}
                            value={form.maxResends}
                            onChange={(e) => f("maxResends", e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </fieldset>

                  {/* Janela de envio */}
                  <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px" }}>
                    <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Janela de envio (horas)</legend>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label>
                        Hora início
                        <input
                          type="number" min={0} max={23}
                          value={form.sendHourStart}
                          onChange={(e) => f("sendHourStart", e.target.value)}
                        />
                      </label>
                      <label>
                        Hora fim
                        <input
                          type="number" min={0} max={23}
                          value={form.sendHourEnd}
                          onChange={(e) => f("sendHourEnd", e.target.value)}
                        />
                      </label>
                    </div>
                  </fieldset>

                  <label className="inlineCheck">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => f("active", e.target.checked)}
                    />
                    Ativo para envio
                  </label>

                  <button type="submit" disabled={saving}>
                    {saving ? "Salvando..." : "Salvar template"}
                  </button>
                </form>
              </>
            ) : (
              <div className="empty">
                Escolha uma fase à esquerda para configurar canal, destinatário, texto e status.
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
