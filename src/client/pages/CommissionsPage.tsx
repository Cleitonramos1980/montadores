import { useEffect, useRef, useState } from "react";
import { ActionButton, LoadingState, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

type Commission = {
  id: string; codprod: string; description: string;
  vlmaodeobra: number; commission_percent: number;
  active: number; notes: string | null;
  created_at: string; updated_at: string;
};

type ProductResult = {
  codprod: string; descricao: string; vlmaodeobra: number;
  unidade: string; codepto: string | null;
  commission_percent: number | null; commission_active: number | null;
};

function fmtCur(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Inline edit form ──────────────────────────────────────────────────────────
function CommissionForm({
  codprod,
  description,
  vlmaodeobra,
  initialPct,
  initialNotes,
  onSaved,
  onCancel,
}: {
  codprod: string; description: string; vlmaodeobra: number;
  initialPct?: number; initialNotes?: string;
  onSaved: () => void; onCancel: () => void;
}) {
  const [pct, setPct]     = useState(String(initialPct ?? ""));
  const [notes, setNotes] = useState(initialNotes ?? "");
  const toast = useToast();

  async function save() {
    const num = parseFloat(pct);
    if (isNaN(num) || num <= 0 || num > 100) {
      toast("Percentual deve ser entre 0,01 e 100.", "error"); return;
    }
    try {
      await api(`/commissions/${encodeURIComponent(codprod)}`, {
        method: "PUT",
        body: JSON.stringify({
          description,
          vlmaodeobra,
          commissionPercent: num,
          active: true,
          notes: notes.trim() || undefined,
        }),
      });
      toast(`Comissão de ${num}% salva para ${codprod}.`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginTop: 8 }}>
      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>{description}</p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-muted)" }}>
        Cód: {codprod} · Mão de obra: {fmtCur(vlmaodeobra)}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>
          Comissão (%) *
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <input
              type="number" min={0.01} max={100} step={0.01}
              value={pct} onChange={(e) => setPct(e.target.value)}
              style={{ width: "100%", fontSize: 15 }}
              autoFocus
            />
            <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>%</span>
          </div>
        </label>
        <label style={{ fontSize: 13 }}>
          Observação (opcional)
          <input
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: Produto com montagem complexa"
            style={{ marginTop: 4 }}
          />
        </label>
      </div>
      {pct && !isNaN(parseFloat(pct)) && Number(vlmaodeobra) > 0 && (
        <p style={{ fontSize: 12, color: "var(--brand)", margin: "0 0 10px" }}>
          Valor estimado por unidade: {fmtCur(Number(vlmaodeobra) * parseFloat(pct) / 100)}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton onClick={save} loadingLabel="Salvando..." className="">Salvar comissão</ActionButton>
        <button className="ghostButton" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Tab: Configuradas ─────────────────────────────────────────────────────────
function ConfiguredTab({ reload }: { reload: number }) {
  const [list, setList]       = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setList(await api<Commission[]>("/commissions")); }
    catch (err) { toast((err as Error).message, "error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [reload]);

  async function toggleActive(codprod: string) {
    try {
      await api(`/commissions/${encodeURIComponent(codprod)}/toggle`, { method: "PATCH", body: "{}" });
      await load();
    } catch (err) { toast((err as Error).message, "error"); }
  }

  async function remove(codprod: string, desc: string) {
    if (!confirm(`Remover comissão de "${desc}"?`)) return;
    try {
      await api(`/commissions/${encodeURIComponent(codprod)}`, { method: "DELETE" });
      toast("Comissão removida.");
      await load();
    } catch (err) { toast((err as Error).message, "error"); }
  }

  if (loading) return <LoadingState message="Carregando comissões..." />;

  if (list.length === 0) {
    return (
      <div className="emptyState">
        <div className="emptyIcon">💰</div>
        <strong>Nenhuma comissão configurada</strong>
        <p>Use a aba "Buscar produto" para adicionar produtos da PCPRODUT.</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
        {list.length} produto{list.length !== 1 ? "s" : ""} com comissão configurada
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th style={{ textAlign: "right" }}>Mão de obra</th>
              <th style={{ textAlign: "right" }}>Comissão %</th>
              <th style={{ textAlign: "right" }}>Valor estimado</th>
              <th>Observação</th>
              <th style={{ textAlign: "center" }}>Ativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <>
                <tr key={c.codprod} style={{ opacity: c.active ? 1 : 0.5 }}>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{c.codprod}</td>
                  <td style={{ maxWidth: 280 }}>
                    <strong style={{ fontSize: 14 }}>{c.description}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtCur(c.vlmaodeobra)}</td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: "var(--brand)" }}>
                      {Number(c.commission_percent).toFixed(2)}%
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--ok)", fontWeight: 600 }}>
                    {fmtCur(Number(c.vlmaodeobra) * Number(c.commission_percent) / 100)}
                  </td>
                  <td style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 180 }}>
                    {c.notes ?? "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      onClick={() => toggleActive(c.codprod)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20 }}
                      title={c.active ? "Desativar" : "Ativar"}
                    >
                      {c.active ? "✅" : "⬜"}
                    </button>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="ghostButton"
                        style={{ fontSize: 12 }}
                        onClick={() => setEditing(editing === c.codprod ? null : c.codprod)}
                      >
                        {editing === c.codprod ? "Fechar" : "Editar"}
                      </button>
                      <button
                        className="ghostButton"
                        style={{ fontSize: 12, color: "var(--danger)" }}
                        onClick={() => remove(c.codprod, c.description)}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === c.codprod && (
                  <tr key={`edit-${c.codprod}`}>
                    <td colSpan={8} style={{ padding: "0 0 8px" }}>
                      <CommissionForm
                        codprod={c.codprod}
                        description={c.description}
                        vlmaodeobra={c.vlmaodeobra}
                        initialPct={c.commission_percent}
                        initialNotes={c.notes ?? ""}
                        onSaved={() => { setEditing(null); void load(); }}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Buscar produto ───────────────────────────────────────────────────────
function SearchTab({ onAdded }: { onAdded: () => void }) {
  const [q, setQ]                 = useState("");
  const [qInput, setQInput]       = useState("");
  const [showAll, setShowAll]     = useState(false);
  const [results, setResults]     = useState<ProductResult[]>([]);
  const [loading, setLoading]     = useState(false);
  const [configuring, setConf]    = useState<string | null>(null);
  const toast = useToast();
  const didMount = useRef(false);

  async function search(term: string, all: boolean) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "60", all: all ? "1" : "0" });
      if (term) params.set("q", term);
      setResults(await api<ProductResult[]>(`/commissions/search?${params}`));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  // Load on mount to show assembly products not yet configured
  useEffect(() => {
    if (!didMount.current) { void search("", false); didMount.current = true; }
  }, []);

  useEffect(() => { void search(q, showAll); }, [q, showAll]);

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 260 }}>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQ(qInput)}
            placeholder="Buscar código ou descrição do produto (PCPRODUT)..."
            style={{ flex: 1 }}
          />
          <button className="ghostButton" onClick={() => setQ(qInput)}>Buscar</button>
          {q && <button className="ghostButton" onClick={() => { setQ(""); setQInput(""); }}>✕</button>}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Mostrar também os já configurados
        </label>
      </div>

      {loading ? (
        <LoadingState message="Consultando PCPRODUT..." />
      ) : results.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">🔍</div>
          <strong>Nenhum produto com montagem encontrado</strong>
          <p>Produtos com VLMAODEOBRA &gt; 0 aparecem aqui. {!q && "Tente buscar por código ou descrição."}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
            {results.length} produto{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""} na PCPRODUT com mão de obra &gt; 0
          </p>
          {results.map((p) => {
            const isOpen = configuring === p.codprod;
            const configured = p.commission_percent !== null;
            return (
              <div
                key={p.codprod}
                style={{
                  border: `1px solid ${configured ? "var(--ok-border,#a5d6a7)" : "var(--border)"}`,
                  borderRadius: 8, overflow: "hidden",
                  background: configured ? "var(--ok-bg)" : "var(--bg)",
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", cursor: "pointer" }}
                  onClick={() => setConf(isOpen ? null : p.codprod)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 15 }}>{p.descricao}</strong>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.codprod}</span>
                      {p.unidade && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {p.unidade}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 13, color: "var(--text-secondary)" }}>
                      <span>Mão de obra: <strong>{fmtCur(p.vlmaodeobra)}</strong></span>
                      {configured && (
                        <span style={{ color: "var(--ok)", fontWeight: 700 }}>
                          ✓ {Number(p.commission_percent).toFixed(2)}% configurado
                          {p.commission_active === 0 && <span style={{ color: "var(--warn)", marginLeft: 4 }}>(inativo)</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {configured && (
                      <span style={{ fontSize: 12, color: "var(--ok)" }}>
                        ≈ {fmtCur(Number(p.vlmaodeobra) * Number(p.commission_percent) / 100)} / un.
                      </span>
                    )}
                    <button className="ghostButton" style={{ fontSize: 13 }}>
                      {isOpen ? "Fechar" : configured ? "Editar" : "Configurar"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "0 14px 14px" }}>
                    <CommissionForm
                      codprod={p.codprod}
                      description={p.descricao}
                      vlmaodeobra={p.vlmaodeobra}
                      initialPct={p.commission_percent ?? undefined}
                      onSaved={() => {
                        setConf(null);
                        void search(q, showAll);
                        onAdded();
                      }}
                      onCancel={() => setConf(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function CommissionsPage() {
  const [tab, setTab]       = useState<"configured" | "search">("configured");
  const [reloadKey, setKey] = useState(0);

  return (
    <Page
      title="Comissões de Montagem"
      subtitle="Configure o percentual de comissão por produto da PCPRODUT"
    >
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid var(--border)", marginBottom: 20 }}>
        {([
          ["configured", "Configuradas"],
          ["search",     "Buscar produto (PCPRODUT)"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "10px 24px", border: "none", background: "transparent",
              borderBottom: tab === key ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -2,
              fontWeight: tab === key ? 700 : 400,
              color: tab === key ? "var(--brand)" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 15,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "configured" && <ConfiguredTab reload={reloadKey} />}
      {tab === "search"     && <SearchTab onAdded={() => setKey((k) => k + 1)} />}
    </Page>
  );
}
