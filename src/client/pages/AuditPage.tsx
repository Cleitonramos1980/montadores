import { useEffect, useMemo, useState } from "react";
import { LoadingState, Page, SearchInput, useToast } from "../components/Ui";
import { api } from "../lib/api";

export function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const toast = useToast();

  useEffect(() => {
    api<any[]>("/audit-logs")
      .then(setLogs)
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        l.action?.toLowerCase().includes(q) ||
        l.entity_type?.toLowerCase().includes(q) ||
        l.entity_id?.toLowerCase().includes(q) ||
        l.actor_user_id?.toLowerCase().includes(q),
    );
  }, [logs, search]);

  return (
    <Page
      title="Auditoria"
      subtitle="Registro de todas as ações sensíveis realizadas no sistema"
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Filtrar por ação, entidade, usuário..." />
          <span style={{ color: "var(--text-muted)", fontSize: 13, whiteSpace: "nowrap" }}>
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      }
    >
      {loading ? (
        <LoadingState message="Carregando logs de auditoria..." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>ID</th>
              <th>Usuário</th>
              <th>Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  {search ? "Nenhum log encontrado para esse filtro." : "Nenhum registro de auditoria."}
                </td>
              </tr>
            )}
            {filtered.map((log) => (
              <tr key={log.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </td>
                <td><code style={{ fontSize: 12 }}>{log.action}</code></td>
                <td style={{ fontSize: 13 }}>{log.entity_type}</td>
                <td style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {log.entity_id?.slice(0, 8)}…
                </td>
                <td style={{ fontSize: 13 }}>
                  {log.actor_user_id ?? <span style={{ color: "var(--text-muted)" }}>sistema</span>}
                </td>
                <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{log.justification ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
