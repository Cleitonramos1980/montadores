import { useEffect, useState } from "react";
import { ActionButton, JustifyDialog, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const STATUS_ACTIONS: Record<string, string[]> = {
  AGUARDANDO_ANALISE: ["approve", "reject"],
  PRE_CADASTRO: ["approve", "reject"],
  APROVADO: ["suspend"],
  REPROVADO: ["reactivate"],
  SUSPENSO: ["reactivate", "reject"],
};

const ACTION_LABEL: Record<string, string> = {
  approve: "Aprovar",
  reject: "Reprovar",
  suspend: "Suspender",
  reactivate: "Reativar",
};

const ACTION_CLASS: Record<string, string> = {
  approve: "",
  reject: "dangerButton",
  suspend: "dangerButton",
  reactivate: "",
};

const NEEDS_JUSTIFY = ["reject", "suspend", "reactivate"];

export function ApprovalPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [justifyTarget, setJustifyTarget] = useState<{ id: string; action: string } | null>(null);
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

  async function decide(id: string, action: string, justification?: string) {
    const justif = justification ?? (action === "approve" ? "Documentação validada" : "");
    try {
      await api(`/providers/${id}/${action}`, { method: "POST", body: JSON.stringify({ justification: justif }) });
      toast(`${ACTION_LABEL[action]} realizado com sucesso.`);
      setJustifyTarget(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <Page title="Aprovação de Montadores" subtitle="Nenhum montador aparece na agenda antes de aprovado e ativo">
      {loading ? (
        <LoadingState message="Carregando montadores..." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Documento</th>
              <th>Cidade/UF</th>
              <th>Contato</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>Nenhum montador cadastrado.</td>
              </tr>
            )}
            {providers.map((provider) => {
              const actions = STATUS_ACTIONS[provider.status] ?? [];
              return (
                <tr key={provider.id}>
                  <td><strong>{provider.name}</strong></td>
                  <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>{provider.document}</td>
                  <td style={{ fontSize: 13 }}>{provider.city}/{provider.uf}</td>
                  <td style={{ fontSize: 13 }}>{provider.phone}</td>
                  <td><StatusBadge value={provider.status} /></td>
                  <td className="actionsRow">
                    {actions.map((action) => (
                      <ActionButton
                        key={action}
                        className={ACTION_CLASS[action]}
                        loadingLabel={`${ACTION_LABEL[action]}...`}
                        onClick={() => NEEDS_JUSTIFY.includes(action)
                          ? setJustifyTarget({ id: provider.id, action })
                          : decide(provider.id, action)
                        }
                      >
                        {ACTION_LABEL[action]}
                      </ActionButton>
                    ))}
                    {actions.length === 0 && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {justifyTarget && (
        <JustifyDialog
          title={ACTION_LABEL[justifyTarget.action]}
          placeholder="Justificativa obrigatória..."
          confirmLabel={ACTION_LABEL[justifyTarget.action]}
          destructive={["reject", "suspend"].includes(justifyTarget.action)}
          onConfirm={(justification) => decide(justifyTarget.id, justifyTarget.action, justification)}
          onCancel={() => setJustifyTarget(null)}
        />
      )}
    </Page>
  );
}
