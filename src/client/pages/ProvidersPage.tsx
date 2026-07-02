import { useEffect, useMemo, useState } from "react";
import { ActionButton, EmptyState, JustifyDialog, LoadingState, Page, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

export function ProvidersPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: "approve" | "reject" | "suspend" | "reactivate" } | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<any[]>("/providers");
      setProviders(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return providers;
    const q = search.toLowerCase();
    return providers.filter(
      (p) => p.name?.toLowerCase().includes(q) || p.document?.includes(q) || p.city?.toLowerCase().includes(q),
    );
  }, [providers, search]);

  async function doAction(id: string, action: string, justification: string) {
    try {
      await api(`/providers/${id}/${action}`, { method: "POST", body: JSON.stringify({ justification }) });
      const labels: Record<string, string> = {
        approve: "Montador aprovado.",
        reject: "Montador reprovado.",
        suspend: "Montador suspenso.",
        reactivate: "Montador reativado.",
      };
      toast(labels[action] ?? "Ação executada.");
      setConfirmAction(null);
      setSelected(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setConfirmAction(null);
    }
  }

  const actionLabels: Record<string, string> = {
    approve: "Aprovar montador",
    reject: "Reprovar montador",
    suspend: "Suspender montador",
    reactivate: "Reativar montador",
  };

  return (
    <Page
      title="Gestão de Montadores"
      subtitle="Prestadores, status, regiões e capacidade"
      action={
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nome, CPF/CNPJ, cidade..." />
          <a href="/montadores/prestadores/novo" style={{ whiteSpace: "nowrap" }}>+ Novo fornecedor</a>
        </div>
      }
    >
      {loading ? (
        <LoadingState message="Carregando montadores..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhum montador encontrado"
          description={search ? "Ajuste a busca." : "Cadastre o primeiro montador."}
          action={<a href="/montadores/prestadores/novo">+ Novo fornecedor</a>}
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Documento</th>
              <th>Cidade/UF</th>
              <th>Status</th>
              <th>Ativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((provider) => (
              <tr key={provider.id} style={{ background: selected?.id === provider.id ? "var(--brand-light)" : undefined }}>
                <td><strong>{provider.name}</strong></td>
                <td>{provider.document}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{provider.city}/{provider.uf}</td>
                <td><StatusBadge value={provider.status} /></td>
                <td>{provider.active ? "Sim" : "Não"}</td>
                <td>
                  <div className="actionsRow">
                    <button className="ghostButton" style={{ fontSize: 13 }} onClick={() => setSelected(selected?.id === provider.id ? null : provider)}>
                      {selected?.id === provider.id ? "Fechar" : "Ações"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="flowHeader" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: "0 0 4px" }}>{selected.name}</h2>
              <StatusBadge value={selected.status} />
            </div>
            <button className="ghostButton" onClick={() => setSelected(null)}>Fechar</button>
          </div>

          <dl className="descList" style={{ marginBottom: 16 }}>
            <dt>E-mail</dt><dd>{selected.email || "—"}</dd>
            <dt>Telefone</dt><dd>{selected.phone || "—"}</dd>
            <dt>Capacidade/dia</dt><dd>{selected.capacity_per_day}</dd>
            <dt>Docs validados</dt><dd>{selected.documents_validated ? "Sim" : "Não"}</dd>
          </dl>

          <div className="actionsRow">
            {selected.status === "PENDENTE" && (
              <>
                <ActionButton onClick={() => setConfirmAction({ id: selected.id, action: "approve" })} loadingLabel="...">
                  Aprovar
                </ActionButton>
                <ActionButton className="dangerButton" onClick={() => setConfirmAction({ id: selected.id, action: "reject" })} loadingLabel="...">
                  Reprovar
                </ActionButton>
              </>
            )}
            {selected.status === "APROVADO" && selected.active && (
              <ActionButton className="dangerButton" onClick={() => setConfirmAction({ id: selected.id, action: "suspend" })} loadingLabel="...">
                Suspender
              </ActionButton>
            )}
            {(!selected.active || selected.status === "SUSPENSO") && (
              <ActionButton onClick={() => setConfirmAction({ id: selected.id, action: "reactivate" })} loadingLabel="...">
                Reativar
              </ActionButton>
            )}
          </div>
        </div>
      )}

      {confirmAction && (
        <JustifyDialog
          title={actionLabels[confirmAction.action] ?? "Confirmar ação"}
          message={`Justifique a ação para o montador ${providers.find((p) => p.id === confirmAction.id)?.name}.`}
          confirmLabel={actionLabels[confirmAction.action]}
          destructive={["reject", "suspend"].includes(confirmAction.action)}
          onConfirm={(note) => doAction(confirmAction.id, confirmAction.action, note)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 12 }}>
        {filtered.length} montador{filtered.length !== 1 ? "es" : ""}
        {providers.length !== filtered.length ? ` de ${providers.length} total` : ""}
      </p>
    </Page>
  );
}
