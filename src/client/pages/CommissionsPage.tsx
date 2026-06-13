import { useEffect, useRef, useState } from "react";
import { ActionButton, ConfirmDialog, LoadingState, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

type CalcType = "FIXED_AMOUNT" | "PERCENTAGE";

type Commission = {
  id: string; codprod: string; description: string;
  calculation_type: string; commission_percent: number;
  fixed_amount: number | null; active: number;
  notes: string | null; created_at: string; updated_at: string;
};

type ProductResult = {
  codprod: string; descricao: string; unidade: string; coddep: string | null; codepto?: string | null;
  commission_percent: number | null; calculation_type: string | null;
  fixed_amount: number | null; commission_active: number | null;
};

type Department = {
  codepto: string;
  descricao: string;
};

type CheckOption = {
  value: string;
  label: string;
};

function fmtCur(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function calcLabel(calcType: string, commissionPercent: number, fixedAmount: number | null) {
  if (calcType === "FIXED_AMOUNT") return `${fmtCur(Number(fixedAmount ?? 0))} / un.`;
  return `${Number(commissionPercent).toFixed(2)}%`;
}

function CheckComboBox({
  label,
  options,
  selected,
  onChange,
  placeholder = "Selecionar",
  emptyLabel = "Nenhuma opção",
  disabled = false,
  onOpen,
}: {
  label: string;
  options: CheckOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const selectedSet = new Set(selected);
  const filtered = options.filter((option) =>
    `${option.value} ${option.label}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find((option) => option.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selecionados`;

  function toggle(value: string) {
    if (selectedSet.has(value)) onChange(selected.filter((item) => item !== value));
    else onChange([...selected, value]);
  }

  return (
    <div style={{ position: "relative", minWidth: 260 }}>
      <button
        type="button"
        className="ghostButton"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onOpen?.();
          setOpen((current) => !current);
        }}
        style={{ width: "100%", minHeight: 38, justifyContent: "space-between", opacity: disabled ? 0.55 : 1 }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}: {summary}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 6px)",
            left: 0,
            width: "min(420px, 90vw)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(15, 23, 42, .14)",
            padding: 10,
          }}
        >
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Buscar ${label.toLowerCase()}...`}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 4 }}>
            {filtered.length === 0 && (
              <div style={{ padding: "10px 8px", color: "var(--text-muted)", fontSize: 13 }}>{emptyLabel}</div>
            )}
            {filtered.map((option) => (
              <label
                key={option.value}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                <input type="checkbox" checked={selectedSet.has(option.value)} onChange={() => toggle(option.value)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className="ghostButton"
              style={{ marginTop: 8, width: "100%", justifyContent: "center", fontSize: 12 }}
              onClick={() => onChange([])}
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Commission Form ───────────────────────────────────────────────────────────
function CommissionForm({
  codprod, description,
  initialCalcType, initialPct, initialFixed, initialNotes,
  onSaved, onCancel, isDept = false,
}: {
  codprod: string; description: string;
  initialCalcType?: CalcType; initialPct?: number;
  initialFixed?: number; initialNotes?: string;
  onSaved: () => void; onCancel: () => void;
  isDept?: boolean;
}) {
  const [calcType, setCalcType] = useState<CalcType>(initialCalcType ?? "PERCENTAGE");
  const [pct, setPct]           = useState(String(initialPct ?? ""));
  const [fixed, setFixed]       = useState(String(initialFixed ?? ""));
  const [notes, setNotes]       = useState(initialNotes ?? "");
  const toast = useToast();

  async function save() {
    if (calcType === "PERCENTAGE") {
      const num = parseFloat(pct);
      if (isNaN(num) || num <= 0 || num > 100) {
        toast("Percentual deve ser entre 0,01 e 100.", "error"); return;
      }
    } else {
      const num = parseFloat(fixed);
      if (isNaN(num) || num < 0) {
        toast("Valor fixo deve ser >= 0.", "error"); return;
      }
    }
    try {
      const route = isDept
        ? `/commissions/dept/${encodeURIComponent(codprod)}`
        : `/commissions/${encodeURIComponent(codprod)}`;
      await api(route, {
        method: "PUT",
        body: JSON.stringify({
          description,
          calculationType:   calcType,
          commissionPercent: calcType === "PERCENTAGE" ? parseFloat(pct) : undefined,
          fixedAmount:       calcType === "FIXED_AMOUNT" ? parseFloat(fixed) : undefined,
          active: true,
          notes: notes.trim() || undefined,
        }),
      });
      toast(`Comissão salva para ${codprod}.`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginTop: 8 }}>
      <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>{description}</p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-muted)" }}>Código: {codprod}</p>

      {/* Type selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["PERCENTAGE", "FIXED_AMOUNT"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setCalcType(t)}
            style={{
              padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
              border: calcType === t ? "2px solid var(--brand)" : "1px solid var(--border)",
              background: calcType === t ? "var(--brand)" : "transparent",
              color: calcType === t ? "#fff" : "var(--text-secondary)",
            }}
          >
            {t === "PERCENTAGE" ? "Percentual (%)" : "Valor fixo (R$/un.)"}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, marginBottom: 10 }}>
        {calcType === "PERCENTAGE" ? (
          <label style={{ fontSize: 13 }}>
            Comissão (%) *
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <input
                type="number" min={0.01} max={100} step={0.01}
                value={pct} onChange={(e) => setPct(e.target.value)}
                style={{ width: "100%", fontSize: 15 }} autoFocus
              />
              <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>%</span>
            </div>
          </label>
        ) : (
          <label style={{ fontSize: 13 }}>
            Valor fixo por unidade (R$) *
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>R$</span>
              <input
                type="number" min={0} step={0.01}
                value={fixed} onChange={(e) => setFixed(e.target.value)}
                style={{ width: "100%", fontSize: 15 }} autoFocus
              />
            </div>
          </label>
        )}
        <label style={{ fontSize: 13 }}>
          Observação (opcional)
          <input
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: Produto com montagem complexa"
            style={{ marginTop: 4 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton onClick={save} loadingLabel="Salvando..." className="">Salvar comissão</ActionButton>
        <button className="ghostButton" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Tab: Configuradas ─────────────────────────────────────────────────────────
function ConfiguredTab({ reload }: { reload: number }) {
  const [list, setList]         = useState<Commission[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ codprod: string; desc: string } | null>(null);
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

  function remove(codprod: string, desc: string) {
    setRemoveTarget({ codprod, desc });
  }

  async function confirmRemove(codprod: string) {
    try {
      await api(`/commissions/${encodeURIComponent(codprod)}`, { method: "DELETE" });
      toast("Comissão removida.");
      setRemoveTarget(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setRemoveTarget(null);
    }
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
              <th>Tipo</th>
              <th style={{ textAlign: "right" }}>Valor / %</th>
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
                  <td style={{ maxWidth: 280 }}><strong style={{ fontSize: 14 }}>{c.description}</strong></td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                      background: c.calculation_type === "FIXED_AMOUNT" ? "var(--info-bg,#e3f2fd)" : "var(--brand-bg,#e8f5e9)",
                      color: c.calculation_type === "FIXED_AMOUNT" ? "var(--info,#1565c0)" : "var(--brand)",
                    }}>
                      {c.calculation_type === "FIXED_AMOUNT" ? "Valor fixo" : "Percentual"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--brand)" }}>
                    {calcLabel(c.calculation_type, c.commission_percent, c.fixed_amount)}
                  </td>
                  <td style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 180 }}>{c.notes ?? "—"}</td>
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
                        className="ghostButton" style={{ fontSize: 12 }}
                        onClick={() => setEditing(editing === c.codprod ? null : c.codprod)}
                      >
                        {editing === c.codprod ? "Fechar" : "Editar"}
                      </button>
                      <button
                        className="ghostButton" style={{ fontSize: 12, color: "var(--danger)" }}
                        onClick={() => remove(c.codprod, c.description)}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === c.codprod && (
                  <tr key={`edit-${c.codprod}`}>
                    <td colSpan={7} style={{ padding: "0 0 8px" }}>
                      <CommissionForm
                        codprod={c.codprod}
                        description={c.description}
                        initialCalcType={(c.calculation_type as CalcType) ?? "PERCENTAGE"}
                        initialPct={c.commission_percent}
                        initialFixed={c.fixed_amount ?? undefined}
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

      {removeTarget && (
        <ConfirmDialog
          title={`Remover comissão`}
          message={`Remover comissão de "${removeTarget.desc}"? Esta ação não pode ser desfeita.`}
          confirmLabel="Remover"
          destructive
          onConfirm={() => confirmRemove(removeTarget.codprod)}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

// ── Tab: Buscar produto ───────────────────────────────────────────────────────
function SearchTab({
  onAdded,
  coddeps,
}: {
  onAdded: () => void;
  coddeps: string[];
}) {
  const [qInput, setQInput]       = useState("");
  const [q, setQ]                 = useState("");
  const [showAll, setShowAll]     = useState(false);
  const [results, setResults]     = useState<ProductResult[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [loading, setLoading]     = useState(false);
  const [configuring, setConf]    = useState<string | null>(null);
  const [searched, setSearched]   = useState(false);
  const toast = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string, all: boolean, deps: string[]) {
    const cleanTerm = term.trim();
    if (cleanTerm.length < 2 && deps.length === 0) {
      setResults([]); setSearched(false); return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", all: all ? "1" : "0" });
      if (cleanTerm.length >= 2) params.set("q", cleanTerm);
      deps.forEach((codepto) => params.append("coddep", codepto));
      const rows = await api<ProductResult[]>(`/commissions/search?${params}`);
      setResults(rows);
      setSelectedProducts((cur) => cur.filter((codprod) => rows.some((row) => row.codprod === codprod)));
      setSearched(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleInput(value: string) {
    setQInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setQ(value); }, 500);
  }

  function clearSearch() {
    setQInput(""); setQ("");
    if (coddeps.length > 0) void search("", showAll, coddeps);
    else { setResults([]); setSearched(false); }
  }

  useEffect(() => {
    void search(q, showAll, coddeps);
  }, [q, showAll, coddeps]);

  const productOptions = results.map((p) => ({
    value: p.codprod,
    label: `${p.codprod} - ${p.descricao}`,
  }));
  const visibleResults = selectedProducts.length > 0
    ? results.filter((p) => selectedProducts.includes(p.codprod))
    : results;

  return (
    <div>
      {/* Filtro por produto + opções */}
      <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <CheckComboBox
          label="Produtos"
          options={productOptions}
          selected={selectedProducts}
          onChange={setSelectedProducts}
          placeholder="Todos encontrados"
          emptyLabel="Busque ou selecione departamentos primeiro"
          disabled={results.length === 0}
        />
        {selectedProducts.length > 0 && (
          <button className="ghostButton" style={{ fontSize: 12 }} onClick={() => setSelectedProducts([])}>
            Limpar produtos
          </button>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Mostrar já configurados
        </label>
      </div>

      {/* Busca por texto */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <input
          value={qInput}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search(qInput, showAll, coddeps)}
          placeholder="Buscar por código ou descrição do produto (PCPRODUT)..."
          style={{ flex: 1 }}
        />
        <button className="ghostButton" onClick={() => void search(qInput, showAll, coddeps)}>Buscar</button>
        {qInput && <button className="ghostButton" onClick={clearSearch}>✕</button>}
      </div>

      {loading ? (
        <LoadingState message="Consultando PCPRODUT..." />
      ) : !searched || (q.length < 2 && coddeps.length === 0) ? (
        <div className="emptyState">
          <div className="emptyIcon">🔍</div>
          <strong>Selecione departamentos ou digite para buscar</strong>
          <p>Filtre por departamento (PCDEPTO) ou pesquise por código/descrição na PCPRODUT.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">🔍</div>
          <strong>Nenhum produto encontrado</strong>
          <p>Tente outro termo de busca. {showAll ? "" : "Marque 'Mostrar também os já configurados' para ver todos."}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
            {visibleResults.length} de {results.length} produto{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""} na PCPRODUT
          </p>
          {visibleResults.map((p) => {
            const isOpen     = configuring === p.codprod;
            const configured = p.commission_percent !== null || p.fixed_amount !== null;
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
                      {(p.coddep ?? p.codepto) && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· Dep. {p.coddep ?? p.codepto}</span>}
                    </div>
                    {configured && (
                      <div style={{ marginTop: 4, fontSize: 13, color: "var(--ok)", fontWeight: 700 }}>
                        ✓ {p.calculation_type === "FIXED_AMOUNT"
                          ? `${fmtCur(Number(p.fixed_amount))} / un.`
                          : `${Number(p.commission_percent).toFixed(2)}%`} configurado
                        {p.commission_active === 0 && <span style={{ color: "var(--warn)", marginLeft: 4 }}>(inativo)</span>}
                      </div>
                    )}
                  </div>
                  <button className="ghostButton" style={{ fontSize: 13 }}>
                    {isOpen ? "Fechar" : configured ? "Editar" : "Configurar"}
                  </button>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "0 14px 14px" }}>
                    <CommissionForm
                      codprod={p.codprod}
                      description={p.descricao}
                      initialCalcType={(p.calculation_type as CalcType) ?? "PERCENTAGE"}
                      initialPct={p.commission_percent ?? undefined}
                      initialFixed={p.fixed_amount ?? undefined}
                      onSaved={() => { setConf(null); void search(q, showAll, coddeps); onAdded(); }}
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

// ── Tab: Comissão por Departamento ────────────────────────────────────────────
type DeptCommission = {
  codepto: string; description: string;
  calculation_type: string; commission_percent: number;
  fixed_amount: number | null; active: number;
  notes: string | null; created_at: string; updated_at: string;
};

function DeptCommissionsTab({
  departments,
  reload,
  onSaved,
}: {
  departments: Department[];
  reload: number;
  onSaved: () => void;
}) {
  const [list, setList]         = useState<DeptCommission[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<string | null>(null);
  const [adding, setAdding]     = useState(false);
  const [addDept, setAddDept]   = useState<string>("");
  const [removeTarget, setRemoveTarget] = useState<{ codepto: string; desc: string } | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setList(await api<DeptCommission[]>("/commissions/dept")); }
    catch (err) { toast((err as Error).message, "error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [reload]);

  async function toggleActive(codepto: string) {
    try {
      await api(`/commissions/dept/${encodeURIComponent(codepto)}/toggle`, { method: "PATCH", body: "{}" });
      await load();
    } catch (err) { toast((err as Error).message, "error"); }
  }

  async function confirmRemove(codepto: string) {
    try {
      await api(`/commissions/dept/${encodeURIComponent(codepto)}`, { method: "DELETE" });
      toast("Comissão de departamento removida.");
      setRemoveTarget(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setRemoveTarget(null);
    }
  }

  // Departments not yet configured
  const configuredSet = new Set(list.map((c) => c.codepto));
  const availableDepts = departments.filter((d) => !configuredSet.has(d.codepto));

  if (loading) return <LoadingState message="Carregando comissões por departamento..." />;

  return (
    <div>
      {/* Add new department commission */}
      {!adding ? (
        <div style={{ marginBottom: 16 }}>
          <button
            className="ghostButton"
            style={{ fontSize: 13 }}
            onClick={() => { setAdding(true); setAddDept(availableDepts[0]?.codepto ?? ""); }}
            disabled={availableDepts.length === 0}
          >
            + Adicionar comissão por departamento
          </button>
          {availableDepts.length === 0 && list.length > 0 && (
            <span style={{ marginLeft: 10, fontSize: 12, color: "var(--text-muted)" }}>
              Todos os departamentos já configurados
            </span>
          )}
        </div>
      ) : (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: 14 }}>Novo — Comissão por Departamento</p>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>
              Departamento
              <select
                value={addDept}
                onChange={(e) => setAddDept(e.target.value)}
                style={{ marginTop: 4 }}
              >
                {availableDepts.map((d) => (
                  <option key={d.codepto} value={d.codepto}>
                    {d.codepto} — {d.descricao}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {addDept && (
            <CommissionForm
              codprod={addDept}
              description={availableDepts.find((d) => d.codepto === addDept)?.descricao ?? addDept}
              onSaved={async () => {
                setAdding(false);
                await load();
                onSaved();
              }}
              onCancel={() => setAdding(false)}
              isDept
            />
          )}
        </div>
      )}

      {list.length === 0 && !adding ? (
        <div className="emptyState">
          <div className="emptyIcon">🏷️</div>
          <strong>Nenhuma comissão por departamento configurada</strong>
          <p>Defina uma comissão padrão que se aplica a todos os produtos de um departamento.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Depto</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Valor / %</th>
                <th>Observação</th>
                <th style={{ textAlign: "center" }}>Ativo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <>
                  <tr key={c.codepto} style={{ opacity: c.active ? 1 : 0.5 }}>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{c.codepto}</td>
                    <td style={{ maxWidth: 280 }}><strong style={{ fontSize: 14 }}>{c.description}</strong></td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                        background: c.calculation_type === "FIXED_AMOUNT" ? "var(--info-bg,#e3f2fd)" : "var(--brand-bg,#e8f5e9)",
                        color: c.calculation_type === "FIXED_AMOUNT" ? "var(--info,#1565c0)" : "var(--brand)",
                      }}>
                        {c.calculation_type === "FIXED_AMOUNT" ? "Valor fixo" : "Percentual"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--brand)" }}>
                      {calcLabel(c.calculation_type, c.commission_percent, c.fixed_amount)}
                    </td>
                    <td style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 180 }}>{c.notes ?? "—"}</td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        onClick={() => toggleActive(c.codepto)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20 }}
                        title={c.active ? "Desativar" : "Ativar"}
                      >
                        {c.active ? "✅" : "⬜"}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="ghostButton" style={{ fontSize: 12 }}
                          onClick={() => setEditing(editing === c.codepto ? null : c.codepto)}
                        >
                          {editing === c.codepto ? "Fechar" : "Editar"}
                        </button>
                        <button
                          className="ghostButton" style={{ fontSize: 12, color: "var(--danger)" }}
                          onClick={() => setRemoveTarget({ codepto: c.codepto, desc: c.description })}
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editing === c.codepto && (
                    <tr key={`edit-${c.codepto}`}>
                      <td colSpan={7} style={{ padding: "0 0 8px" }}>
                        <CommissionForm
                          codprod={c.codepto}
                          description={c.description}
                          initialCalcType={(c.calculation_type as CalcType) ?? "PERCENTAGE"}
                          initialPct={c.commission_percent}
                          initialFixed={c.fixed_amount ?? undefined}
                          initialNotes={c.notes ?? ""}
                          onSaved={() => { setEditing(null); void load(); onSaved(); }}
                          onCancel={() => setEditing(null)}
                          isDept
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          title="Remover comissão de departamento"
          message={`Remover comissão do departamento "${removeTarget.desc}"? Esta ação não pode ser desfeita.`}
          confirmLabel="Remover"
          destructive
          onConfirm={() => confirmRemove(removeTarget.codepto)}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function CommissionsPage() {
  const [tab, setTab]       = useState<"configured" | "dept" | "search">("configured");
  const [reloadKey, setKey] = useState(0);
  const [departments, setDepartments]         = useState<Department[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    api<Department[]>("/commissions/departments")
      .then(setDepartments)
      .catch((err) => toast((err as Error).message, "error"));
  }, []);

  const departmentOptions = departments.map((d) => ({
    value: d.codepto,
    label: `${d.codepto} - ${d.descricao}`,
  }));

  return (
    <Page
      title="Comissões de Montagem"
      subtitle="Configure comissões por produto ou por departamento (PCPRODUT / PCDEPTO)"
    >
      <div className="tabBar">
        {([
          ["configured", "Por produto"],
          ["dept",       "Por departamento"],
          ["search",     "Buscar produto (PCPRODUT)"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`tabBtn${tab === key ? " tabBtn--active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 12, alignSelf: "center" }}>
          <CheckComboBox
            label="Departamentos"
            options={departmentOptions}
            selected={selectedDepartments}
            onChange={(values) => {
              setTab("search");
              setSelectedDepartments(values);
            }}
            placeholder={departments.length === 0 ? "Carregando..." : "Todos"}
            emptyLabel="Nenhum departamento encontrado"
            disabled={departments.length === 0}
            onOpen={() => setTab("search")}
          />
        </div>
        {selectedDepartments.length > 0 && (
          <button
            className="ghostButton"
            style={{ alignSelf: "center", fontSize: 12 }}
            onClick={() => setSelectedDepartments([])}
          >
            Limpar departamentos
          </button>
        )}
      </div>

      {tab === "configured" && <ConfiguredTab reload={reloadKey} />}
      {tab === "dept" && (
        <DeptCommissionsTab
          departments={departments}
          reload={reloadKey}
          onSaved={() => setKey((k) => k + 1)}
        />
      )}
      {tab === "search" && (
        <SearchTab
          coddeps={selectedDepartments}
          onAdded={() => setKey((k) => k + 1)}
        />
      )}
    </Page>
  );
}
