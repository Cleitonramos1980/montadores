import { useEffect, useState } from "react";
import { LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

function apiJson<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  return api<T>(path, {
    method: opts.method,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

type User = {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  roles: string[];
};

const ROLE_OPTIONS = [
  "ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "FINANCEIRO", "SAC", "MONTADOR",
] as const;

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    ADMIN: "#ef4444", GESTOR: "#f97316", OPERACAO: "#3b82f6",
    LOGISTICA: "#8b5cf6", FINANCEIRO: "#10b981", SAC: "#06b6d4", MONTADOR: "#f59e0b",
  };
  return (
    <span style={{
      display: "inline-block", padding: "1px 8px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600, color: "#fff",
      background: colors[role] ?? "#6b7280", marginRight: 4,
    }}>
      {role}
    </span>
  );
}

function UserModal({
  user,
  onClose,
  onSave,
}: {
  user: Partial<User> | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const toast = useToast();
  const isNew = !user?.id;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"ATIVO" | "INATIVO">((user?.status as "ATIVO" | "INATIVO") ?? "ATIVO");
  const [roles, setRoles] = useState<string[]>(user?.roles ?? []);
  const [saving, setSaving] = useState(false);

  function toggleRole(role: string) {
    setRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function handleSave() {
    if (!name.trim() || !email.trim()) { toast("Nome e e-mail são obrigatórios.", "error"); return; }
    if (roles.length === 0) { toast("Selecione ao menos uma role.", "error"); return; }
    if (isNew && !password) { toast("Senha obrigatória para novo usuário.", "error"); return; }

    setSaving(true);
    try {
      if (isNew) {
        await apiJson("/users", { method: "POST", body: { name, email, password, roles, status } });
        toast("Usuário criado com sucesso.", "success");
      } else {
        const body: Record<string, unknown> = { name, status, roles };
        if (password) body.password = password;
        await apiJson(`/users/${user!.id}`, { method: "PATCH", body });
        toast("Usuário atualizado.", "success");
      }
      onSave();
    } catch (err: unknown) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#1f2937", borderRadius: 12, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 20px", color: "#f9fafb", fontSize: 18 }}>
          {isNew ? "Novo Usuário" : "Editar Usuário"}
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ color: "#9ca3af", fontSize: 13 }}>
            Nome
            <input
              className="inputField"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box" }}
            />
          </label>

          <label style={{ color: "#9ca3af", fontSize: 13 }}>
            E-mail
            <input
              className="inputField"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com"
              disabled={!isNew}
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box", opacity: isNew ? 1 : 0.6 }}
            />
          </label>

          <label style={{ color: "#9ca3af", fontSize: 13 }}>
            {isNew ? "Senha" : "Nova senha (deixe em branco para não alterar)"}
            <input
              className="inputField"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isNew ? "Mínimo 8 caracteres" : "••••••••"}
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box" }}
            />
          </label>

          <div style={{ color: "#9ca3af", fontSize: 13 }}>
            Status
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {(["ATIVO", "INATIVO"] as const).map((s) => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#d1d5db" }}>
                  <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <div style={{ color: "#9ca3af", fontSize: 13 }}>
            Roles
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {ROLE_OPTIONS.map((r) => (
                <label key={r} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#d1d5db", fontSize: 13 }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
                  {r}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button className="ghostButton" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primaryButton" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : isNew ? "Criar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Partial<User> | null | false>(false);
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    api<User[]>("/users")
      .then(setUsers)
      .catch((err: unknown) => toast((err as Error).message, "error"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function deactivate(u: User) {
    if (!confirm(`Desativar usuário "${u.name}"? As sessões ativas serão invalidadas.`)) return;
    try {
      await apiJson(`/users/${u.id}`, { method: "DELETE" });
      toast("Usuário desativado.", "success");
      load();
    } catch (err: unknown) {
      toast((err as Error).message, "error");
    }
  }

  async function activate(u: User) {
    try {
      await apiJson(`/users/${u.id}`, { method: "PATCH", body: { status: "ATIVO", roles: u.roles } });
      toast("Usuário reativado.", "success");
      load();
    } catch (err: unknown) {
      toast((err as Error).message, "error");
    }
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
      u.roles.some((r) => r.toLowerCase().includes(q));
  });

  return (
    <Page
      title="Usuários do Sistema"
      subtitle="Gerencie contas, roles e acesso"
      action={
        <button className="primaryButton" onClick={() => setModal({})}>
          + Novo Usuário
        </button>
      }
    >
      {modal !== false && (
        <UserModal
          user={modal}
          onClose={() => setModal(false)}
          onSave={() => { setModal(false); load(); }}
        />
      )}

      <div style={{ marginBottom: 16 }}>
        <input
          className="inputField"
          placeholder="Buscar por nome, e-mail ou role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "#6b7280", padding: 32 }}>Nenhum usuário encontrado.</td></tr>
              )}
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500, color: "#f9fafb" }}>{u.name}</td>
                  <td style={{ color: "#9ca3af", fontSize: 13 }}>{u.email}</td>
                  <td>{u.roles.map((r) => <RoleBadge key={r} role={r} />)}</td>
                  <td><StatusBadge value={u.status} /></td>
                  <td style={{ color: "#6b7280", fontSize: 12 }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="ghostButton"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => setModal(u)}
                      >
                        Editar
                      </button>
                      {u.status === "ATIVO" ? (
                        <button
                          className="dangerButton"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => deactivate(u)}
                        >
                          Desativar
                        </button>
                      ) : (
                        <button
                          className="ghostButton"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => activate(u)}
                        >
                          Reativar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
