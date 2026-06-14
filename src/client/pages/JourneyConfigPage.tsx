import { useEffect, useState } from "react";
import { ActionButton, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

type Branding = {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportPhone: string | null;
};

const MOCK_TIMELINE = [
  { id: "1", title: "Pedido recebido", description: "Seu pedido foi registrado com sucesso.", created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
  { id: "2", title: "Pedido faturado", description: "Nota fiscal emitida.", created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: "3", title: "Saiu para entrega", description: "Seu pedido está a caminho.", created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: "4", title: "Entrega realizada", description: "Produto entregue com sucesso.", created_at: new Date().toISOString() },
];

const MOCK_ITEMS = [
  { id: "1", description: "Guarda-roupa 6 portas", quantity: 1, requires_assembly: true },
  { id: "2", description: "Cômoda com espelho", quantity: 1, requires_assembly: true },
  { id: "3", description: "Cabeceira casal", quantity: 1, requires_assembly: false },
];

const JOURNEY_STEPS = [
  { key: "PEDIDO_CRIADO",        label: "Pedido\nrecebido" },
  { key: "FATURADO",             label: "Faturado" },
  { key: "SAIU_PARA_ENTREGA",    label: "Saiu para\nentrega" },
  { key: "ENTREGA_REALIZADA",    label: "Entregue" },
  { key: "MONTAGEM_AGENDADA",    label: "Montagem\nagendada" },
  { key: "MONTAGEM_FINALIZADA",  label: "Montagem\nconcluída" },
];

const PV = {
  primary:   "#1F2855",
  action:    "#3563AD",
  white:     "#FFFFFF",
  bg:        "#F7F9FC",
  border:    "#E2E8F0",
  textMuted: "#64748B",
  textSec:   "#475569",
};

function JourneyPreview({ branding }: { branding: Branding }) {
  const currentStep  = 3;
  const stepFraction = currentStep / (JOURNEY_STEPS.length - 1);
  const color        = branding.primaryColor || PV.primary;

  return (
    <div style={{
      background: "#e8edf2",
      borderRadius: 24,
      padding: "12px 12px 16px",
      maxWidth: 340,
      margin: "0 auto",
      fontFamily: "Arial, system-ui, sans-serif",
      boxShadow: "0 4px 24px rgba(31,40,85,.14)",
    }}>
      {/* Phone notch */}
      <div style={{ background: "#c8d0dc", borderRadius: "6px 6px 0 0", height: 6, marginBottom: 10, opacity: .6 }} />

      {/* Simulate phone screen */}
      <div style={{ background: PV.bg, borderRadius: 14, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: color, padding: "14px 14px 22px", textAlign: "center" }}>
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.companyName} style={{ height: 28, objectFit: "contain", display: "block", margin: "0 auto 4px" }} />
          ) : (
            <div style={{ fontSize: 14, fontWeight: 800, color: PV.white, marginBottom: 3 }}>{branding.companyName}</div>
          )}
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 8, margin: 0, letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Jornada Pós-venda
          </p>
        </div>

        <div style={{ padding: "0 12px 14px" }}>
          {/* Order card */}
          <div style={{
            background: PV.white, borderRadius: 12, padding: "12px 14px",
            marginTop: -12, marginBottom: 10,
            boxShadow: "0 3px 14px rgba(31,40,85,.12)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: color, marginBottom: 2 }}>Pedido #123456</div>
            <div style={{ fontSize: 11, color: PV.textSec }}>Cliente Exemplo</div>
          </div>

          {/* CTA */}
          <div style={{
            background: `linear-gradient(135deg, ${color} 0%, ${PV.action} 100%)`,
            color: PV.white, borderRadius: 10, padding: "10px 12px", marginBottom: 10,
            fontSize: 11, fontWeight: 500, lineHeight: 1.4,
          }}>
            🎉 Seu produto foi entregue! Agende agora a montagem.
          </div>

          {/* Steps */}
          <div style={{
            background: PV.white, borderRadius: 10, padding: "10px 6px 8px",
            marginBottom: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
              <div style={{
                position: "absolute", top: 10, left: "8%", right: "8%", height: 2,
                background: `linear-gradient(to right, ${color} ${stepFraction * 100}%, #E2E8F0 ${stepFraction * 100}%)`,
              }} />
              {JOURNEY_STEPS.map((step, i) => {
                const isDone    = i < currentStep;
                const isCurrent = i === currentStep;
                return (
                  <div key={step.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, position: "relative", zIndex: 1 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: isDone ? color : isCurrent ? PV.action : "#E2E8F0",
                      color: isDone || isCurrent ? PV.white : PV.textMuted,
                      fontSize: 8, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isDone ? "✓" : i + 1}
                    </div>
                    <div style={{
                      fontSize: 7, textAlign: "center", marginTop: 3,
                      color: isDone || isCurrent ? color : PV.textMuted,
                      fontWeight: isDone || isCurrent ? 600 : 400,
                      lineHeight: 1.2, whiteSpace: "pre-line",
                    }}>
                      {step.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <div style={{ background: PV.action, color: PV.white, borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
              📅 Agendar minha montagem
            </div>
            <div style={{ background: PV.white, color: color, border: `1.5px solid #E2E8F0`, borderRadius: 10, padding: "9px", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
              ✋ Preciso de ajuda
            </div>
          </div>

          {/* Timeline */}
          <div style={{ background: PV.white, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: PV.textMuted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
              Histórico do pedido
            </div>
            {MOCK_TIMELINE.map((item, idx) => (
              <div key={item.id} style={{ display: "flex", gap: 8, marginBottom: 8, position: "relative" }}>
                {idx < MOCK_TIMELINE.length - 1 && (
                  <div style={{ position: "absolute", left: 5, top: 14, bottom: -2, width: 1, background: "#E2E8F0" }} />
                )}
                <div style={{
                  width: 12, height: 12, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                  background: idx === MOCK_TIMELINE.length - 1 ? PV.action : color,
                  position: "relative", zIndex: 1,
                }} />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: color }}>{item.title}</div>
                  <div style={{ fontSize: 9, color: PV.textMuted }}>
                    {new Date(item.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Products */}
          <div style={{ background: PV.white, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: PV.textMuted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
              Seus produtos
            </div>
            {MOCK_ITEMS.map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #F1F5F9" }}>
                <span style={{ fontSize: 10, color: color }}><strong style={{ color: PV.action }}>{item.quantity}x</strong> {item.description}</span>
                {item.requires_assembly && (
                  <span style={{ background: "#EFF6FF", color: PV.action, fontSize: 7, fontWeight: 700, padding: "2px 6px", borderRadius: 20, whiteSpace: "nowrap", marginLeft: 6 }}>
                    Montagem
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          {branding.supportPhone && (
            <div style={{ textAlign: "center", paddingTop: 10, marginTop: 10, borderTop: "1px solid #E2E8F0", fontSize: 9, color: PV.textMuted }}>
              Precisa de ajuda?{" "}
              <span style={{ color: PV.action, fontWeight: 700 }}>{branding.supportPhone}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function JourneyConfigPage() {
  const [form, setForm] = useState<Branding>({ companyName: "Rodrigues Colchões", logoUrl: "/logo-rodrigues.svg", primaryColor: "#1F2855", supportPhone: null });
  const [preview, setPreview] = useState<Branding>(form);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<Branding>("/settings/branding")
      .then((data) => { setForm(data); setPreview(data); })
      .catch((err) => toast((err as Error).message, "error"))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(field: keyof Branding, value: string) {
    const updated = { ...form, [field]: value || null };
    setForm(updated);
    setPreview(updated);
  }

  async function save() {
    setSaving(true);
    try {
      await api("/settings/branding", { method: "PUT", body: JSON.stringify(form) });
      toast("Configurações salvas com sucesso.");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Page title="Jornada do Cliente" subtitle="Configuração da experiência pública do cliente"><div style={{ padding: 32, color: "var(--text-muted)" }}>Carregando...</div></Page>;

  return (
    <Page
      title="Jornada do Cliente"
      subtitle="Configure como o cliente verá o acompanhamento do pedido e visualize o resultado ao vivo"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>

        {/* Config form */}
        <div className="panel spacedPanel">
          <h2 style={{ fontSize: 16, marginBottom: 20 }}>Configurações de identidade visual</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)" }}>
              Nome da empresa
              <input
                value={form.companyName}
                onChange={(e) => handleChange("companyName", e.target.value)}
                placeholder="Ex: Rodrigues Colchões"
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Exibido quando não há logo configurado.</span>
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)" }}>
              URL do logotipo
              <input
                value={form.logoUrl ?? ""}
                onChange={(e) => handleChange("logoUrl", e.target.value)}
                placeholder="https://exemplo.com/logo.png"
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Use uma URL pública (PNG ou SVG). Deixe em branco para usar o nome da empresa.</span>
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)" }}>
              Cor principal
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => handleChange("primaryColor", e.target.value)}
                  style={{ width: 48, height: 36, padding: 2, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
                />
                <input
                  value={form.primaryColor}
                  onChange={(e) => handleChange("primaryColor", e.target.value)}
                  placeholder="#2e7d32"
                  style={{ flex: 1 }}
                />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Usada em botões, links e destaques na jornada do cliente.</span>
            </label>

            <label style={{ display: "grid", gap: 6, fontSize: 14, color: "var(--text-secondary)" }}>
              Telefone de suporte
              <input
                value={form.supportPhone ?? ""}
                onChange={(e) => handleChange("supportPhone", e.target.value)}
                placeholder="(11) 9 9999-9999"
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Exibido no rodapé da jornada como canal de contato.</span>
            </label>
          </div>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
            <ActionButton onClick={save} loadingLabel="Salvando..." disabled={saving}>
              Salvar configurações
            </ActionButton>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>
              O link enviado ao cliente via <code style={{ background: "var(--bg)", padding: "1px 5px", borderRadius: 4 }}>{"{{link_jornada}}"}</code> aponta para:
            </p>
            <code style={{ fontSize: 12, background: "var(--bg)", padding: "6px 10px", borderRadius: 6, display: "block", color: "var(--text-secondary)" }}>
              {location.origin}/montadores/jornada-publica/<span style={{ color: "var(--text-muted)" }}>[token-do-pedido]</span>
            </code>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 16, color: "var(--text-secondary)" }}>
            Preview — como o cliente verá
          </h2>
          <JourneyPreview branding={preview} />
          <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 12 }}>
            Preview com dados fictícios. O conteúdo real virá do pedido do cliente.
          </p>
        </div>
      </div>
    </Page>
  );
}
