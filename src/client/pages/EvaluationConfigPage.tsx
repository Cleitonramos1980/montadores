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
  SCALE:         "Escala (0-10)",
  STARS:         "Estrelas (1-5)",
  TEXT:          "Texto livre",
  SINGLE_CHOICE: "Escolha única",
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
  const [numped, setNumped]   = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ token: string; url: string } | null>(null);
  const toast = useToast();

  async function generate() {
    if (!numped.trim()) { toast("Informe o número do pedido.", "error"); return; }
    setLoading(true);
    try {
      const data = await api<{ linkId: string; token: string; url: string }>("/eval-links", {
        method: "POST",
        body: JSON.stringify({ phase, numped: numped.trim() }),
      });
      setResult(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  const fullUrl = result ? `${location.origin}${result.url}` : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div className="panel" style={{ maxWidth: 480, width: "90%", padding: 24 }}>
        <h3 style={{ margin: "0 0 16px" }}>Gerar link de avaliação — {PHASE_LABELS[phase]?.label}</h3>
        {!result ? (
          <>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
                Número do pedido (NUMPED)
              </span>
              <input
                value={numped}
                onChange={(e) => setNumped(e.target.value)}
                placeholder="Ex: 1234567"
                style={{ fontSize: 15 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton onClick={generate} loadingLabel="Gerando..." className="">Gerar link</ActionButton>
              <button className="ghostButton" onClick={onClose}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>Link gerado:</div>
              <div style={{ wordBreak: "break-all", fontSize: 13, fontFamily: "monospace" }}>{fullUrl}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="ghostButton"
                onClick={() => { navigator.clipboard.writeText(fullUrl!); toast("Link copiado!", "success"); }}
              >
                Copiar link
              </button>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="ghostButton"
                style={{ textDecoration: "none" }}
              >
                Abrir link
              </a>
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
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState({ label: "", type: "SCALE", required: true, minLabel: "", maxLabel: "" });
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function addQuestion() {
    if (!form.label.trim()) { toast("Informe o texto da pergunta.", "error"); return; }
    setLoading(true);
    try {
      await api(`/eval-configs/${configId}/questions`, {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          type: form.type,
          required: form.required,
          minLabel: form.minLabel || undefined,
          maxLabel: form.maxLabel || undefined,
        }),
      });
      toast("Pergunta adicionada!");
      setAdding(false);
      setForm({ label: "", type: "SCALE", required: true, minLabel: "", maxLabel: "" });
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
          <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => setAdding(true)}>
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
        <div key={q.id} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "8px 10px", background: "var(--bg-secondary)",
          border: "1px solid var(--border)", borderRadius: 6, marginBottom: 6,
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
          </div>
          <button
            className="ghostButton"
            style={{ fontSize: 12, color: "var(--danger)", padding: "2px 8px" }}
            onClick={() => deleteQuestion(q.id)}
          >
            Remover
          </button>
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
