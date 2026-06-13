import { useState } from "react";
import { api, setToken } from "../lib/api";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api<{ token: string; user: { name: string; email: string; roles: string[] } }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setToken(result.token);
      localStorage.setItem("montadores_user", JSON.stringify(result.user));
      location.href = "/montadores/dashboard";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, background: "var(--brand)", borderRadius: 12, marginBottom: 12 }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>AM</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>App Montadores</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>Jornada pós-venda</p>
        </div>

        {error && (
          <div className="error" style={{ marginBottom: 16 }}>{error}</div>
        )}

        <form className="formGrid singleColumn" onSubmit={handleSubmit}>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operador@empresa.com"
              autoFocus
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          <button type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "var(--text-muted)" }}>
          <a href="/montadores/cadastro" style={{ color: "var(--brand)" }}>Cadastro de montador</a>
        </p>
      </div>
    </main>
  );
}
