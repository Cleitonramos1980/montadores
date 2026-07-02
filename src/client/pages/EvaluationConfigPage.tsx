import { useEffect, useState } from "react";
import { ActionButton, LoadingState, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

type EvalQuestion = {
  id: string;
  configId: string;
  position: number;
  type: string;
  label: string;
  required: boolean;
  minLabel: string | null;
  maxLabel: string | null;
  options: string[] | null;
};

type EvalConfig = {
  id: string;
  phase: string;
  title: string;
  description: string | null;
  active: boolean;
  linkTtlDays: number;
  questions?: EvalQuestion[];
};

const PHASE_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ATENDIMENTO: { label: "Atendimento", color: "#1565c0", bg: "#e3f2fd", border: "#90caf9" },
  ENTREGA:     { label: "Entrega",     color: "#6a1b9a", bg: "#f3e5f5", border: "#ce93d8" },
  MONTAGEM:    { label: "Montagem",    color: "#1b5e20", bg: "#e8f5e9", border: "#a5d6a7" },
};

const TYPE_LABELS: Record<string, string> = {
  SCALE:           "Escala (0-10)",
  STARS:           "Estrelas (1-5)",
  TEXT:            "Texto livre",
  SINGLE_CHOICE:   "Escolha única",
  MULTIPLE_CHOICE: "Múltipla escolha",
  YES_NO:          "Sim / Não",
};

const PHASES = ["ATENDIMENTO", "ENTREGA", "MONTAGEM"] as const;

// ── Gerador de link de avaliação ───────────────────────────────────────────────

function GenLinkModal({
  phase,
  onClose,
}: {
  phase: string;
  onClose: () => void;
}) {
  const [mode, setMode]       = useState<"direto" | "pedido">("direto");
  const [numped, setNumped]   = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ token: string; url: string } | null>(null);
  const toast = useToast();
  const phaseLabel = PHASE_LABELS[phase]?.label ?? phase;

  async function generate() {
    if (mode === "pedido" && !numped.trim()) {
      toast("Informe o número do pedido.", "error");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, string> = { phase };
      if (mode === "pedido" && numped.trim()) body.numped = numped.trim();
      const data = await api<{ linkId: string; token: string; url: string }>("/eval-links", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  const fullUrl = result ? result.url : null;

  const whatsappMsg = fullUrl
    ? encodeURIComponent(
        `Olá! Gostaríamos de saber sua opinião sobre o ${phaseLabel.toLowerCase()} da Rodrigues Colchões.\nClique no link abaixo para avaliar (leva menos de 1 minuto):\n${fullUrl}`,
      )
    : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div className="panel" style={{ maxWidth: 500, width: "92%", padding: 24 }}>
        <h3 style={{ margin: "0 0 16px" }}>Gerar link de avaliação — {phaseLabel}</h3>

        {!result ? (
          <>
            {/* Modo */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {(["direto", "pedido"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, cursor: "pointer",
                    border: `2px solid ${mode === m ? "var(--brand-action)" : "var(--border)"}`,
                    background: mode === m ? "var(--brand-action)" : "#f9fafb",
                    color: mode === m ? "#fff" : "var(--text-primary)",
                    fontWeight: mode === m ? 700 : 400,
                  }}
                >
                  {m === "direto" ? "🔗 Link direto" : "📦 Vincular a pedido"}
                </button>
              ))}
            </div>

            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
              {mode === "direto"
                ? "Gera um link genérico sem vínculo com pedido. Ideal para enviar no WhatsApp ou redes sociais."
                : "Vincula a avaliação a um pedido específico para rastreamento e SAC automático."}
            </p>

            {mode === "pedido" && (
              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                  Número do pedido (NUMPED) <span style={{ color: "var(--danger)" }}>*</span>
                </span>
                <input
                  value={numped}
                  onChange={(e) => setNumped(e.target.value)}
                  placeholder="Ex: 1234567"
                  style={{ fontSize: 15 }}
                  autoFocus
                />
              </label>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton onClick={generate} loadingLabel="Gerando..." className="" disabled={loading}>
                Gerar link
              </ActionButton>
              <button className="ghostButton" onClick={onClose}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                {mode === "direto" ? "Link direto gerado:" : `Link do pedido ${numped} gerado:`}
              </div>
              <div style={{ wordBreak: "break-all", fontSize: 13, fontFamily: "monospace" }}>{fullUrl}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="ghostButton"
                onClick={() => { navigator.clipboard.writeText(fullUrl!); toast("Link copiado!", "success"); }}
              >
                📋 Copiar link
              </button>
              <a
                href={`https://wa.me/?text=${whatsappMsg}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 8, fontSize: 13,
                  background: "#25d366", color: "#fff",
                  textDecoration: "none", fontWeight: 600,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Enviar no WhatsApp
              </a>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="ghostButton"
                style={{ textDecoration: "none" }}
              >
                Abrir link
              </a>
              <button className="ghostButton" onClick={() => { setResult(null); setNumped(""); }}>
                Gerar outro
              </button>
              <button className="ghostButton" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Configuração de perguntas ──────────────────────────────────────────────────

function QuestionEditor({
  configId,
  questions,
  onReload,
}: {
  configId: string;
  questions: EvalQuestion[];
  onReload: () => void;
}) {
  const [adding, setAdding]         = useState(false);
  const [form, setForm]             = useState({ label: "", type: "SCALE", required: true, minLabel: "", maxLabel: "", options: [] as string[], optionInput: "" });
  const [loading, setLoading]       = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editForm, setEditForm]     = useState({ label: "", required: true, minLabel: "", maxLabel: "", options: [] as string[], optionInput: "" });
  const [saving, setSaving]         = useState(false);
  const toast = useToast();

  const isChoiceType = (t: string) => t === "SINGLE_CHOICE" || t === "MULTIPLE_CHOICE";

  function addFormOption() {
    const val = form.optionInput.trim();
    if (!val) return;
    if (form.options.includes(val)) { toast("Opção já existe.", "error"); return; }
    setForm((f) => ({ ...f, options: [...f.options, val], optionInput: "" }));
  }
  function removeFormOption(opt: string) {
    setForm((f) => ({ ...f, options: f.options.filter((o) => o !== opt) }));
  }

  function addEditOption() {
    const val = editForm.optionInput.trim();
    if (!val) return;
    if (editForm.options.includes(val)) { toast("Opção já existe.", "error"); return; }
    setEditForm((f) => ({ ...f, options: [...f.options, val], optionInput: "" }));
  }
  function removeEditOption(opt: string) {
    setEditForm((f) => ({ ...f, options: f.options.filter((o) => o !== opt) }));
  }

  function startEdit(q: EvalQuestion) {
    setEditingId(q.id);
    setEditForm({ label: q.label, required: q.required, minLabel: q.minLabel ?? "", maxLabel: q.maxLabel ?? "", options: q.options ?? [], optionInput: "" });
    setAdding(false);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(q: EvalQuestion) {
    if (!editForm.label.trim()) { toast("O texto da pergunta não pode ficar vazio.", "error"); return; }
    if (isChoiceType(q.type) && editForm.options.length < 2) { toast("Adicione pelo menos 2 opções.", "error"); return; }
    setSaving(true);
    try {
      await api(`/eval-configs/questions/${q.id}`, {
        method: "PUT",
        body: JSON.stringify({
          label:    editForm.label.trim(),
          required: editForm.required,
          minLabel: editForm.minLabel || undefined,
          maxLabel: editForm.maxLabel || undefined,
          options:  isChoiceType(q.type) ? editForm.options : undefined,
        }),
      });
      toast("Pergunta atualizada!");
      setEditingId(null);
      onReload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function addQuestion() {
    if (!form.label.trim()) { toast("Informe o texto da pergunta.", "error"); return; }
    if (isChoiceType(form.type) && form.options.length < 2) { toast("Adicione pelo menos 2 opções.", "error"); return; }
    setLoading(true);
    try {
      await api(`/eval-configs/${configId}/questions`, {
        method: "POST",
        body: JSON.stringify({
          label:    form.label.trim(),
          type:     form.type,
          required: form.required,
          minLabel: form.minLabel || undefined,
          maxLabel: form.maxLabel || undefined,
          options:  isChoiceType(form.type) ? form.options : undefined,
        }),
      });
      toast("Pergunta adicionada!");
      setAdding(false);
      setForm({ label: "", type: "SCALE", required: true, minLabel: "", maxLabel: "", options: [], optionInput: "" });
      onReload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function deleteQuestion(id: string) {
    try {
      await api(`/eval-configs/questions/${id}`, { method: "DELETE" });
      toast("Pergunta removida.");
      onReload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>Perguntas ({questions.length})</h4>
        {!adding && (
          <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => { setAdding(true); setEditingId(null); }}>
            + Adicionar pergunta
          </button>
        )}
      </div>

      {questions.length === 0 && !adding && (
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 8px" }}>
          Nenhuma pergunta configurada. Adicione ao menos uma para ativar esta fase.
        </p>
      )}

      {questions.map((q, i) => (
        <div key={q.id} style={{ marginBottom: 6 }}>
          {editingId === q.id ? (
            /* ── Formulário de edição inline ── */
            <div style={{
              background: "#f0f4ff", border: "1.5px solid var(--brand-action)",
              borderRadius: 8, padding: 14,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-action)", marginBottom: 10 }}>
                Editando pergunta {i + 1}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Texto da pergunta <span style={{ color: "var(--danger)" }}>*</span>
                  <input
                    value={editForm.label}
                    onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                    style={{ fontSize: 13 }}
                    autoFocus
                  />
                </label>
                {(q.type === "SCALE" || q.type === "STARS") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12 }}>
                      Rótulo mínimo
                      <input
                        value={editForm.minLabel}
                        onChange={(e) => setEditForm((f) => ({ ...f, minLabel: e.target.value }))}
                        placeholder="Ex: Péssimo"
                        style={{ fontSize: 13 }}
                      />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Rótulo máximo
                      <input
                        value={editForm.maxLabel}
                        onChange={(e) => setEditForm((f) => ({ ...f, maxLabel: e.target.value }))}
                        placeholder="Ex: Excelente"
                        style={{ fontSize: 13 }}
                      />
                    </label>
                  </div>
                )}
                {isChoiceType(q.type) && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                      Opções ({editForm.options.length})
                    </div>
                    {editForm.options.map((opt, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, background: "#e8edf8", padding: "3px 10px", borderRadius: 20, flex: 1 }}>
                          {String.fromCharCode(65 + idx)}. {opt}
                        </span>
                        <button type="button" className="ghostButton" style={{ fontSize: 11, color: "var(--danger)", padding: "2px 6px" }} onClick={() => removeEditOption(opt)}>✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <input
                        value={editForm.optionInput}
                        onChange={(e) => setEditForm((f) => ({ ...f, optionInput: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEditOption())}
                        placeholder="Nova opção…"
                        style={{ fontSize: 12, flex: 1 }}
                      />
                      <button type="button" className="ghostButton" style={{ fontSize: 12, padding: "4px 10px" }} onClick={addEditOption}>+ Adicionar</button>
                    </div>
                  </div>
                )}
                <label className="inlineCheck" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={editForm.required}
                    onChange={(e) => setEditForm((f) => ({ ...f, required: e.target.checked }))}
                  />
                  Obrigatória
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <ActionButton onClick={() => saveEdit(q)} loadingLabel="Salvando..." className="" disabled={saving}>
                    Salvar alteração
                  </ActionButton>
                  <button className="ghostButton" onClick={cancelEdit}>Cancelar</button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Linha normal da pergunta ── */
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "8px 10px", background: "var(--bg-secondary)",
              border: "1px solid var(--border)", borderRadius: 6,
            }}>
              <span style={{ color: "var(--text-muted)", fontSize: 12, minWidth: 18, fontWeight: 700, marginTop: 2 }}>
                {i + 1}.
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{q.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {TYPE_LABELS[q.type] ?? q.type}
                  {q.required && " · Obrigatório"}
                  {q.minLabel && ` · Min: "${q.minLabel}"`}
                  {q.maxLabel && ` · Max: "${q.maxLabel}"`}
                </div>
                {isChoiceType(q.type) && q.options && q.options.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {q.options.map((opt, idx) => (
                      <span key={idx} style={{ fontSize: 10, background: "#e8edf8", color: "#374151", padding: "2px 8px", borderRadius: 20 }}>
                        {String.fromCharCode(65 + idx)}. {opt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  className="ghostButton"
                  style={{ fontSize: 12, padding: "2px 10px" }}
                  onClick={() => startEdit(q)}
                >
                  Editar
                </button>
                <button
                  className="ghostButton"
                  style={{ fontSize: 12, color: "var(--danger)", padding: "2px 8px" }}
                  onClick={() => deleteQuestion(q.id)}
                >
                  Remover
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginTop: 8 }}>
          <h5 style={{ margin: "0 0 10px", fontSize: 13 }}>Nova pergunta</h5>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Texto da pergunta <span style={{ color: "var(--danger)" }}>*</span>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Ex: Como você avalia o atendimento?"
                style={{ fontSize: 13 }}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Tipo de resposta
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="inlineCheck" style={{ fontSize: 12, alignSelf: "end", paddingBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
                />
                Obrigatória
              </label>
            </div>
            {(form.type === "SCALE" || form.type === "STARS") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Rótulo mínimo
                  <input
                    value={form.minLabel}
                    onChange={(e) => setForm((f) => ({ ...f, minLabel: e.target.value }))}
                    placeholder="Ex: Péssimo"
                    style={{ fontSize: 13 }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  Rótulo máximo
                  <input
                    value={form.maxLabel}
                    onChange={(e) => setForm((f) => ({ ...f, maxLabel: e.target.value }))}
                    placeholder="Ex: Excelente"
                    style={{ fontSize: 13 }}
                  />
                </label>
              </div>
            )}
            {isChoiceType(form.type) && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Opções ({form.options.length}) <span style={{ color: "var(--danger)" }}>*</span>
                </div>
                {form.options.map((opt, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, background: "#e8edf8", padding: "3px 10px", borderRadius: 20, flex: 1 }}>
                      {String.fromCharCode(65 + idx)}. {opt}
                    </span>
                    <button type="button" className="ghostButton" style={{ fontSize: 11, color: "var(--danger)", padding: "2px 6px" }} onClick={() => removeFormOption(opt)}>✕</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <input
                    value={form.optionInput}
                    onChange={(e) => setForm((f) => ({ ...f, optionInput: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFormOption())}
                    placeholder="Nova opção… (Enter para adicionar)"
                    style={{ fontSize: 12, flex: 1 }}
                  />
                  <button type="button" className="ghostButton" style={{ fontSize: 12, padding: "4px 10px" }} onClick={addFormOption}>+ Adicionar</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton onClick={addQuestion} loadingLabel="Salvando..." className="" disabled={loading}>
                Salvar pergunta
              </ActionButton>
              <button className="ghostButton" onClick={() => setAdding(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card de fase ───────────────────────────────────────────────────────────────

function PhaseConfigCard({
  phase,
  config,
  onReload,
}: {
  phase: string;
  config: EvalConfig | null;
  onReload: () => void;
}) {
  const c = PHASE_LABELS[phase] ?? PHASE_LABELS.MONTAGEM;
  const [creating, setCreating]   = useState(false);
  const [createForm, setCreateForm] = useState({ title: `Avaliação de ${c.label}`, description: "" });
  const [genLink, setGenLink]     = useState(false);
  const [toggling, setToggling]   = useState(false);
  const toast = useToast();

  async function createConfig() {
    if (!createForm.title.trim()) { toast("Informe um título.", "error"); return; }
    try {
      await api("/eval-configs", {
        method: "POST",
        body: JSON.stringify({ phase, title: createForm.title.trim(), description: createForm.description || undefined }),
      });
      toast(`Configuração de ${c.label} criada!`);
      setCreating(false);
      onReload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function toggleActive() {
    if (!config) return;
    setToggling(true);
    try {
      await api(`/eval-configs/${config.id}/toggle-active`, {
        method: "PATCH",
        body: JSON.stringify({ active: !config.active }),
      });
      toast(config.active ? "Avaliação desativada." : "Avaliação ativada!");
      onReload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div style={{
      border: `1px solid ${c.border}`,
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{
        background: c.bg,
        borderBottom: `1px solid ${c.border}`,
        padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: c.color, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 13, flexShrink: 0,
        }}>
          {phase[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: c.color }}>{c.label}</div>
          {config && (
            <div style={{ fontSize: 12, color: c.color, opacity: 0.75 }}>{config.title}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {config && (
            <>
              <button
                className="ghostButton"
                style={{ fontSize: 12 }}
                onClick={() => setGenLink(true)}
              >
                Gerar link
              </button>
              <button
                className="ghostButton"
                style={{
                  fontSize: 12,
                  color: config.active ? "var(--ok)" : "var(--text-muted)",
                }}
                onClick={toggleActive}
                disabled={toggling}
              >
                {config.active ? "✓ Ativo" : "○ Inativo"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px" }}>
        {!config && !creating ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
              Nenhuma configuração de avaliação para esta fase.
            </p>
            <button className="ghostButton" onClick={() => setCreating(true)}>
              + Configurar avaliação de {c.label}
            </button>
          </div>
        ) : creating ? (
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Título da avaliação <span style={{ color: "var(--danger)" }}>*</span>
              <input
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                style={{ fontSize: 13 }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Descrição (opcional)
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Explique ao cliente o que será avaliado..."
                rows={2}
                style={{ fontSize: 13 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton onClick={createConfig} className="">Criar configuração</ActionButton>
              <button className="ghostButton" onClick={() => setCreating(false)}>Cancelar</button>
            </div>
          </div>
        ) : config ? (
          <QuestionEditor
            configId={config.id}
            questions={config.questions ?? []}
            onReload={onReload}
          />
        ) : null}
      </div>

      {genLink && <GenLinkModal phase={phase} onClose={() => setGenLink(false)} />}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────

export function EvaluationConfigPage() {
  const [configs, setConfigs] = useState<EvalConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const list = await api<EvalConfig[]>("/eval-configs");
      // Expand each config with questions
      const withQuestions = await Promise.all(
        list.map(async (c) => {
          try {
            const full = await api<EvalConfig>(`/eval-configs/${c.id}`);
            return full;
          } catch {
            return c;
          }
        }),
      );
      setConfigs(withQuestions);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const configByPhase = (phase: string) => configs.find((c) => c.phase === phase) ?? null;

  return (
    <Page
      title="Configuração de Avaliações"
      subtitle="Configure as perguntas e links de avaliação por fase da jornada do cliente"
    >
      {loading ? (
        <LoadingState message="Carregando configurações..." />
      ) : (
        <div style={{ maxWidth: 740 }}>
          <div style={{
            background: "#fff8e1", border: "1px solid #ffe082",
            borderRadius: 8, padding: "10px 16px", marginBottom: 20,
            fontSize: 13, color: "#e65100",
          }}>
            Os links de avaliação gerados aqui são independentes do sistema de avaliação por token da jornada do cliente. Configure as perguntas e gere links manualmente ou integre com o fluxo de mensagens automático.
          </div>

          {PHASES.map((phase) => (
            <PhaseConfigCard
              key={phase}
              phase={phase}
              config={configByPhase(phase)}
              onReload={load}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
