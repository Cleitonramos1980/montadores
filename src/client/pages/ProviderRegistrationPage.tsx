import { useState } from "react";
import { api } from "../lib/api";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const SERVICE_TYPES = [
  { value: "MONTAGEM",    label: "Montagem de móveis" },
  { value: "INSTALACAO",  label: "Instalação" },
  { value: "REPARO",      label: "Reparo / Manutenção" },
];

const PRODUCT_TYPES = [
  { value: "MOVEIS",          label: "Móveis" },
  { value: "ELETRODOMESTICOS",label: "Eletrodomésticos" },
  { value: "ELETRONICOS",     label: "Eletrônicos" },
  { value: "ESCRITORIO",      label: "Escritório" },
];

const PIX_KEY_TYPES = [
  { value: "CPF_CNPJ", label: "CPF / CNPJ" },
  { value: "EMAIL",    label: "E-mail" },
  { value: "TELEFONE", label: "Telefone" },
  { value: "EVP",      label: "Chave aleatória (EVP)" },
];

type F = {
  name: string; tradeName: string; document: string;
  phone: string; whatsapp: string; email: string;
  city: string; uf: string; cep: string;
  regions: string;
  serviceTypes: string[]; productTypes: string[];
  capacityPerDay: number;
  pixKeyType: string; pixKey: string;
  accepted: boolean;
};

const EMPTY: F = {
  name: "", tradeName: "", document: "",
  phone: "", whatsapp: "", email: "",
  city: "", uf: "", cep: "",
  regions: "",
  serviceTypes: ["MONTAGEM"], productTypes: ["MOVEIS"],
  capacityPerDay: 1,
  pixKeyType: "", pixKey: "",
  accepted: false,
};

export function ProviderRegistrationPage() {
  const [form, setForm]       = useState<F>(EMPTY);
  const [submitting, setSub]  = useState(false);
  const [done, setDone]       = useState<{ id: string; codfornec: string | null } | null>(null);
  const [error, setError]     = useState("");

  function set(field: keyof F, value: unknown) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  function toggleMulti(field: "serviceTypes" | "productTypes", value: string) {
    setForm((p) => {
      const arr = p[field];
      return { ...p, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim())     { setError("Razão social obrigatória."); return; }
    if (!form.document.trim()) { setError("CPF/CNPJ obrigatório."); return; }
    if (!form.phone.trim())    { setError("Telefone obrigatório."); return; }
    if (!form.city.trim())     { setError("Cidade obrigatória."); return; }
    if (!form.uf)              { setError("UF obrigatória."); return; }
    if (!form.accepted)        { setError("Aceite os termos para continuar."); return; }
    if (form.serviceTypes.length === 0) { setError("Selecione ao menos um tipo de serviço."); return; }

    setSub(true);
    try {
      const result = await api<{ id: string; codfornec: string | null }>("/public/providers/register", {
        method: "POST",
        body: JSON.stringify({
          name:          form.name.trim(),
          tradeName:     form.tradeName.trim() || undefined,
          document:      form.document.replace(/\D/g, ""),
          phone:         form.phone.replace(/\D/g, ""),
          whatsapp:      form.whatsapp.replace(/\D/g, "") || undefined,
          email:         form.email.trim() || undefined,
          city:          form.city.trim(),
          uf:            form.uf,
          cep:           form.cep.replace(/\D/g, "") || undefined,
          regions:       form.regions.split(",").map((v) => v.trim()).filter(Boolean),
          serviceTypes:  form.serviceTypes,
          productTypes:  form.productTypes,
          capacityPerDay: form.capacityPerDay,
          pixKeyType:    form.pixKeyType || undefined,
          pixKey:        form.pixKey.trim() || undefined,
        }),
      });
      setDone(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSub(false);
    }
  }

  if (done) {
    return (
      <main className="publicPage">
        <section className="publicHeader">
          <strong>App Montadores</strong>
          <h1>Cadastro enviado!</h1>
        </section>
        <div style={{ background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 10, padding: 24, margin: "0 auto 24px", maxWidth: 520, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
          <h2 style={{ color: "#2e7d32", margin: "0 0 8px" }}>Cadastro recebido com sucesso!</h2>
          <p style={{ color: "#1b5e20", margin: "0 0 12px" }}>
            Seu cadastro passará por análise. Em breve nossa equipe entrará em contato.
          </p>
          {done.codfornec && (
            <p style={{ fontSize: 13, color: "#388e3c", background: "#f1f8e9", padding: "8px 16px", borderRadius: 6 }}>
              Código WinThor (CODFORNEC): <strong>{done.codfornec}</strong>
            </p>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <button onClick={() => { setForm(EMPTY); setDone(null); }} className="ghostButton">
            Novo cadastro
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="publicPage">
      <section className="publicHeader">
        <strong>App Montadores</strong>
        <h1>Cadastro de montador / fornecedor</h1>
        <p>Preencha todos os campos obrigatórios (*). Seu cadastro será integrado ao sistema WinThor.</p>
      </section>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <form onSubmit={submit}>

        {/* Dados da empresa */}
        <fieldset className="formSection panel" style={{ marginBottom: 16 }}>
          <legend style={{ fontWeight: 700, fontSize: 15, padding: "0 8px" }}>Dados da empresa / prestador</legend>

          <div className="formGrid" style={{ marginTop: 8 }}>
            <label style={{ gridColumn: "1/-1" }}>
              Razão Social *
              <input value={form.name} onChange={(e) => set("name", e.target.value)}
                placeholder="Nome completo ou razão social" required />
            </label>

            <label style={{ gridColumn: "1/-1" }}>
              Nome Fantasia
              <input value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)}
                placeholder="Como é conhecido no mercado (opcional)" />
            </label>

            <label>
              CPF / CNPJ *
              <input value={form.document} onChange={(e) => set("document", e.target.value)}
                placeholder="000.000.000-00 ou 00.000.000/0001-00" required />
            </label>

            <label>
              E-mail
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
                placeholder="contato@empresa.com.br" />
            </label>
          </div>
        </fieldset>

        {/* Contato */}
        <fieldset className="formSection panel" style={{ marginBottom: 16 }}>
          <legend style={{ fontWeight: 700, fontSize: 15, padding: "0 8px" }}>Contato</legend>
          <div className="formGrid" style={{ marginTop: 8 }}>
            <label>
              Telefone / Celular *
              <input value={form.phone} onChange={(e) => set("phone", e.target.value)}
                placeholder="(11) 99999-9999" required />
            </label>
            <label>
              WhatsApp
              <input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)}
                placeholder="(11) 99999-9999" />
            </label>
          </div>
        </fieldset>

        {/* Localização — campos obrigatórios PCFORNEC */}
        <fieldset className="formSection panel" style={{ marginBottom: 16 }}>
          <legend style={{ fontWeight: 700, fontSize: 15, padding: "0 8px" }}>Localização</legend>
          <div className="formGrid" style={{ marginTop: 8 }}>
            <label>
              Cidade *
              <input value={form.city} onChange={(e) => set("city", e.target.value)}
                placeholder="São Paulo" required />
            </label>
            <label>
              UF *
              <select value={form.uf} onChange={(e) => set("uf", e.target.value)} required>
                <option value="">Selecione...</option>
                {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
            <label>
              CEP
              <input value={form.cep} onChange={(e) => set("cep", e.target.value)}
                placeholder="00000-000" maxLength={9} />
            </label>
            <label>
              Regiões / bairros atendidos
              <input value={form.regions} onChange={(e) => set("regions", e.target.value)}
                placeholder="Centro, Zona Sul, Zona Norte..." />
            </label>
          </div>
        </fieldset>

        {/* Serviços */}
        <fieldset className="formSection panel" style={{ marginBottom: 16 }}>
          <legend style={{ fontWeight: 700, fontSize: 15, padding: "0 8px" }}>Serviços e produtos</legend>
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              Tipo de serviço *
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {SERVICE_TYPES.map((s) => {
                const on = form.serviceTypes.includes(s.value);
                return (
                  <label key={s.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, background: on ? "var(--brand-light,#e8f0fe)" : "var(--bg-secondary)", padding: "6px 14px", borderRadius: 20, border: `1px solid ${on ? "var(--brand)" : "var(--border)"}` }}>
                    <input type="checkbox" checked={on} onChange={() => toggleMulti("serviceTypes", s.value)} style={{ display: "none" }} />
                    {on ? "✓ " : ""}{s.label}
                  </label>
                );
              })}
            </div>

            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              Tipo de produto
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRODUCT_TYPES.map((p) => {
                const on = form.productTypes.includes(p.value);
                return (
                  <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, background: on ? "var(--brand-light,#e8f0fe)" : "var(--bg-secondary)", padding: "6px 14px", borderRadius: 20, border: `1px solid ${on ? "var(--brand)" : "var(--border)"}` }}>
                    <input type="checkbox" checked={on} onChange={() => toggleMulti("productTypes", p.value)} style={{ display: "none" }} />
                    {on ? "✓ " : ""}{p.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ maxWidth: 200 }}>
              Montagens por dia
              <input type="number" min={1} max={20} value={form.capacityPerDay}
                onChange={(e) => set("capacityPerDay", Number(e.target.value))} />
            </label>
          </div>
        </fieldset>

        {/* Dados bancários / PIX */}
        <fieldset className="formSection panel" style={{ marginBottom: 16 }}>
          <legend style={{ fontWeight: 700, fontSize: 15, padding: "0 8px" }}>Dados bancários / PIX</legend>
          <p style={{ margin: "8px 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
            Informe sua chave PIX para receber pagamentos pelas montagens realizadas.
          </p>
          <div className="formGrid">
            <label>
              Tipo de chave PIX
              <select value={form.pixKeyType} onChange={(e) => set("pixKeyType", e.target.value)}>
                <option value="">Sem chave PIX</option>
                {PIX_KEY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              Chave PIX
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
        </fieldset>

        {/* Aceite */}
        <label className="inlineCheck" style={{ marginBottom: 20 }}>
          <input type="checkbox" checked={form.accepted} onChange={(e) => set("accepted", e.target.checked)} />
          <span>
            Aceito as regras de qualidade, evidências fotográficas obrigatórias, pagamento por aprovação
            e estou ciente que meus dados serão registrados no sistema WinThor.
          </span>
        </label>

        <button type="submit" disabled={submitting} style={{ width: "100%", padding: 14, fontSize: 16 }}>
          {submitting ? "Enviando cadastro..." : "Enviar cadastro"}
        </button>
      </form>
    </main>
  );
}
