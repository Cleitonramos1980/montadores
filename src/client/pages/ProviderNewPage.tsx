import { useState } from "react";
import { ActionButton, useToast } from "../components/Ui";
import { api } from "../lib/api";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const SERVICE_TYPES = [
  { value: "MONTAGEM", label: "Montagem de móveis" },
  { value: "INSTALACAO", label: "Instalação" },
  { value: "REPARO", label: "Reparo / Manutenção" },
];

const PRODUCT_TYPES = [
  { value: "MOVEIS", label: "Móveis" },
  { value: "ELETRODOMESTICOS", label: "Eletrodomésticos" },
  { value: "ELETRONICOS", label: "Eletrônicos" },
  { value: "ESCRITORIO", label: "Escritório" },
];

const PIX_KEY_TYPES = [
  { value: "CPF_CNPJ", label: "CPF / CNPJ" },
  { value: "EMAIL",    label: "E-mail" },
  { value: "TELEFONE", label: "Telefone" },
  { value: "EVP",      label: "Chave aleatória (EVP)" },
];

type WinthorSupplier = {
  codfornec: number;
  fornecedor: string;
  fantasia: string | null;
  cgc: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  telrep: string | null;
  bloqueio: string | null;
};

type FormState = {
  codfornec: string;
  name: string;
  document: string;
  phone: string;
  whatsapp: string;
  email: string;
  city: string;
  uf: string;
  regions: string;
  serviceTypes: string[];
  productTypes: string[];
  capacityPerDay: number;
  pixKeyType: string;
  pixKey: string;
  notes: string;
};

const EMPTY: FormState = {
  codfornec: "",
  name: "",
  document: "",
  phone: "",
  whatsapp: "",
  email: "",
  city: "",
  uf: "",
  regions: "",
  serviceTypes: ["MONTAGEM"],
  productTypes: ["MOVEIS"],
  capacityPerDay: 1,
  pixKeyType: "",
  pixKey: "",
  notes: "",
};

export function ProviderNewPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<WinthorSupplier[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedWinthor, setSelectedWinthor] = useState<WinthorSupplier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const toast = useToast();

  async function doSearch() {
    if (searchTerm.trim().length < 2) return;
    setSearching(true);
    try {
      const results = await api<WinthorSupplier[]>(`/providers/winthor/search?q=${encodeURIComponent(searchTerm)}`);
      setSearchResults(results);
      if (results.length === 0) toast("Nenhum fornecedor encontrado na PCFORNEC.", "error");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  function selectWinthor(s: WinthorSupplier) {
    setSelectedWinthor(s);
    setSearchResults([]);
    setSearchTerm("");
    setForm((prev) => ({
      ...prev,
      codfornec: String(s.codfornec),
      name: s.fantasia?.trim() || s.fornecedor?.trim() || prev.name,
      document: s.cgc?.replace(/\D/g, "") || prev.document,
      email: s.email?.trim() || prev.email,
      city: s.cidade?.trim() || prev.city,
      uf: s.estado?.trim().toUpperCase().slice(0, 2) || prev.uf,
      phone: s.telrep?.replace(/\D/g, "") || prev.phone,
    }));
  }

  function toggleMulti(field: "serviceTypes" | "productTypes", value: string) {
    setForm((prev) => {
      const arr = prev[field];
      return { ...prev, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  }

  function set(field: keyof FormState, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast("Nome obrigatório.", "error"); return; }
    if (!form.document.trim()) { toast("CPF/CNPJ obrigatório.", "error"); return; }
    if (!form.phone.trim()) { toast("Telefone obrigatório.", "error"); return; }
    if (form.serviceTypes.length === 0) { toast("Selecione ao menos um tipo de serviço.", "error"); return; }

    setSubmitting(true);
    try {
      await api("/providers", {
        method: "POST",
        body: JSON.stringify({
          codfornec: form.codfornec || undefined,
          name: form.name.trim(),
          document: form.document.replace(/\D/g, ""),
          phone: form.phone.replace(/\D/g, ""),
          whatsapp: form.whatsapp.replace(/\D/g, "") || undefined,
          email: form.email.trim() || undefined,
          city: form.city.trim() || undefined,
          uf: form.uf.trim().toUpperCase() || undefined,
          regions: form.regions.split(",").map((v) => v.trim()).filter(Boolean),
          serviceTypes: form.serviceTypes,
          productTypes: form.productTypes,
          capacityPerDay: form.capacityPerDay,
          pixKeyType: form.pixKeyType || undefined,
          pixKey: form.pixKey.trim() || undefined,
        }),
      });
      setDone(true);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
        <h2 style={{ color: "var(--ok)", marginBottom: 8 }}>Fornecedor cadastrado!</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          O prestador foi registrado com status <strong>Aguardando análise</strong>.
          Acesse Fornecedores para aprovar.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="ghostButton" onClick={() => { setForm(EMPTY); setSelectedWinthor(null); setDone(false); }}>
            Cadastrar outro
          </button>
          <button onClick={() => { location.href = "/montadores/providers"; }}>
            Ver fornecedores
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="ghostButton" onClick={() => { location.href = "/montadores/providers"; }}>
          ← Fornecedores
        </button>
        <h1 style={{ margin: 0, fontSize: 22 }}>Novo fornecedor</h1>
      </div>

      {/* WinThor search */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>🔍 Buscar na PCFORNEC (WinThor)</h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
          Digite o código WinThor, CNPJ ou nome do fornecedor para pré-preencher o formulário.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), doSearch())}
            placeholder="Ex: 1042 ou 12.345.678/0001-99 ou Fornecedor ABC"
            style={{ flex: 1, fontSize: 15 }}
          />
          <ActionButton onClick={doSearch} disabled={searchTerm.trim().length < 2} loadingLabel="Buscando..." className="ghostButton">
            Buscar
          </ActionButton>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {searchResults.map((s) => (
              <button
                key={s.codfornec}
                onClick={() => selectWinthor(s)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 14px", border: "none", borderBottom: "1px solid var(--border)",
                  background: "var(--bg)", cursor: "pointer",
                  transition: "background .15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>
                      [{s.codfornec}] {s.fantasia?.trim() || s.fornecedor?.trim()}
                    </strong>
                    {s.fantasia && s.fornecedor && (
                      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 6 }}>({s.fornecedor})</span>
                    )}
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {[s.cgc, s.cidade, s.estado].filter(Boolean).join(" · ")}
                      {s.email && ` · ${s.email}`}
                    </div>
                  </div>
                  {s.bloqueio === "S" && (
                    <span style={{ fontSize: 11, background: "var(--danger)", color: "#fff", borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
                      Bloqueado
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected badge */}
        {selectedWinthor && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--ok-bg)", border: "1px solid var(--ok-border)", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--ok)" }}>
              ✓ Vinculado: [{selectedWinthor.codfornec}] {selectedWinthor.fantasia?.trim() || selectedWinthor.fornecedor?.trim()}
            </span>
            <button
              className="ghostButton"
              style={{ fontSize: 12 }}
              onClick={() => { setSelectedWinthor(null); setForm((p) => ({ ...p, codfornec: "" })); }}
            >
              Remover vínculo
            </button>
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={submit}>
        {/* Dados básicos */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Dados do prestador</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label style={{ gridColumn: "1/-1" }}>
              <span className="fieldLabel">Razão social / Nome completo *</span>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Nome completo ou razão social"
                required
              />
            </label>

            <label>
              <span className="fieldLabel">CPF / CNPJ *</span>
              <input
                value={form.document}
                onChange={(e) => set("document", e.target.value)}
                placeholder="000.000.000-00"
                required
              />
            </label>

            <label>
              <span className="fieldLabel">Código WinThor (CODFORNEC)</span>
              <input
                value={form.codfornec}
                onChange={(e) => set("codfornec", e.target.value)}
                placeholder="Ex: 1042"
              />
            </label>

            <label>
              <span className="fieldLabel">Telefone *</span>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="(11) 99999-9999"
                required
              />
            </label>

            <label>
              <span className="fieldLabel">WhatsApp</span>
              <input
                value={form.whatsapp}
                onChange={(e) => set("whatsapp", e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </label>

            <label style={{ gridColumn: "1/-1" }}>
              <span className="fieldLabel">E-mail</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="fornecedor@email.com"
              />
            </label>
          </div>
        </div>

        {/* Localização */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Localização</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 14 }}>
            <label>
              <span className="fieldLabel">Cidade</span>
              <input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="São Paulo" />
            </label>
            <label>
              <span className="fieldLabel">UF</span>
              <select value={form.uf} onChange={(e) => set("uf", e.target.value)}>
                <option value="">—</option>
                {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: "1/-1" }}>
              <span className="fieldLabel">Regiões / bairros atendidos</span>
              <input
                value={form.regions}
                onChange={(e) => set("regions", e.target.value)}
                placeholder="Centro, Zona Sul, Zona Norte (separar por vírgula)"
              />
            </label>
          </div>
        </div>

        {/* Serviços */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Serviços prestados</h3>

          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
            Tipos de serviço *
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            {SERVICE_TYPES.map((s) => (
              <label key={s.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, background: form.serviceTypes.includes(s.value) ? "var(--brand-light,#e8f0fe)" : "var(--bg-secondary)", padding: "6px 12px", borderRadius: 20, border: `1px solid ${form.serviceTypes.includes(s.value) ? "var(--brand)" : "var(--border)"}` }}>
                <input
                  type="checkbox"
                  checked={form.serviceTypes.includes(s.value)}
                  onChange={() => toggleMulti("serviceTypes", s.value)}
                  style={{ display: "none" }}
                />
                {form.serviceTypes.includes(s.value) ? "✓ " : ""}{s.label}
              </label>
            ))}
          </div>

          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
            Tipos de produto
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {PRODUCT_TYPES.map((p) => (
              <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, background: form.productTypes.includes(p.value) ? "var(--brand-light,#e8f0fe)" : "var(--bg-secondary)", padding: "6px 12px", borderRadius: 20, border: `1px solid ${form.productTypes.includes(p.value) ? "var(--brand)" : "var(--border)"}` }}>
                <input
                  type="checkbox"
                  checked={form.productTypes.includes(p.value)}
                  onChange={() => toggleMulti("productTypes", p.value)}
                  style={{ display: "none" }}
                />
                {form.productTypes.includes(p.value) ? "✓ " : ""}{p.label}
              </label>
            ))}
          </div>
        </div>

        {/* PIX */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Dados bancários / PIX</h3>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
            Chave PIX para recebimento de pagamentos.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label>
              <span className="fieldLabel">Tipo de chave PIX</span>
              <select value={form.pixKeyType} onChange={(e) => set("pixKeyType", e.target.value)}>
                <option value="">Sem chave PIX</option>
                {PIX_KEY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="fieldLabel">Chave PIX</span>
              <input
                value={form.pixKey}
                onChange={(e) => set("pixKey", e.target.value)}
                disabled={!form.pixKeyType}
                placeholder={
                  form.pixKeyType === "CPF_CNPJ"  ? "000.000.000-00 ou 00.000.000/0001-00" :
                  form.pixKeyType === "EMAIL"      ? "seu@email.com" :
                  form.pixKeyType === "TELEFONE"   ? "+55 11 99999-9999" :
                  form.pixKeyType === "EVP"        ? "Chave aleatória de 32 caracteres" :
                  "Selecione o tipo primeiro"
                }
              />
            </label>
          </div>
        </div>

        {/* Capacidade */}
        <div className="panel" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Capacidade</h3>
          <label style={{ maxWidth: 200, display: "grid", gap: 4 }}>
            <span className="fieldLabel">Montagens por dia *</span>
            <input
              type="number"
              min={1}
              max={20}
              value={form.capacityPerDay}
              onChange={(e) => set("capacityPerDay", Number(e.target.value))}
            />
          </label>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="ghostButton"
            onClick={() => { location.href = "/montadores/providers"; }}
          >
            Cancelar
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? "Cadastrando..." : "Cadastrar fornecedor"}
          </button>
        </div>
      </form>
    </main>
  );
}
