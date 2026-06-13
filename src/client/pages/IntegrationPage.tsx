import { useEffect, useState } from "react";
import { ActionButton, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

function FailureRow({ failure, onResolved }: { failure: any; onResolved: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const toast = useToast();

  const fmtDate = (v: string) => { try { return new Date(v).toLocaleString("pt-BR"); } catch { return v; } };

  async function retry() {
    setRetrying(true);
    try {
      await api(`/integration/failures/${failure.id}/retry`, { method: "POST", body: "{}" });
      toast(`Falha marcada como resolvida (tentativa ${(failure.retry_count ?? 0) + 1}).`);
      onResolved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <tr>
      <td><code style={{ fontSize: 12 }}>{failure.operation}</code></td>
      <td>{failure.reference ?? "—"}</td>
      <td style={{ color: "var(--danger)", fontSize: 13, maxWidth: 260, wordBreak: "break-word" }}>{failure.error_message}</td>
      <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{fmtDate(failure.created_at)}</td>
      <td>
        <ActionButton
          className="ghostButton"
          onClick={retry}
          loadingLabel="..."
          disabled={retrying}
        >
          ↻ Resolver
        </ActionButton>
      </td>
    </tr>
  );
}

export function IntegrationPage() {
  const [data, setData] = useState<{ failures: any[]; logs: any[] }>({ failures: [], logs: [] });
  const [numped, setNumped] = useState("");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    try {
      const result = await api<{ failures: any[]; logs: any[] }>("/integration/winthor");
      setData(result);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  async function sync() {
    if (!numped.trim()) {
      toast("Informe o número do pedido.", "error");
      return;
    }
    try {
      await api(`/integration/winthor/orders/${numped.trim()}/sync`, { method: "POST", body: "{}" });
      toast(`Pedido ${numped} sincronizado.`);
      setNumped("");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const fmtDate = (v: string) => {
    try { return new Date(v).toLocaleString("pt-BR"); } catch { return v; }
  };

  return (
    <Page title="Integração WinThor" subtitle="Adapter Oracle isolado, com logs e falhas rastreáveis">
      <div className="toolbar" style={{ marginBottom: 20 }}>
        <input
          placeholder="Número do pedido (NUMPED)"
          value={numped}
          onChange={(e) => setNumped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sync()}
          style={{ minWidth: 220 }}
        />
        <ActionButton onClick={sync} loadingLabel="Sincronizando...">
          ↻ Sincronizar pedido
        </ActionButton>
        <ActionButton className="ghostButton" onClick={load} loadingLabel="Atualizando...">
          Atualizar
        </ActionButton>
      </div>

      {loading ? (
        <LoadingState message="Carregando dados de integração..." />
      ) : (
        <>
          <section className="panel" style={{ marginBottom: 16 }}>
            <h2>Falhas abertas</h2>
            {data.failures.length === 0 ? (
              <p style={{ color: "var(--ok)", fontSize: 14 }}>✓ Nenhuma falha aberta.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Operação</th><th>Referência</th><th>Erro</th><th>Data</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {data.failures.map((f: any) => (
                    <FailureRow key={f.id} failure={f} onResolved={load} />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Últimas sincronizações</h2>
            {data.logs.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Nenhuma sincronização registrada.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Tipo</th><th>Query</th><th>Status</th><th>Tempo (ms)</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {data.logs.map((log: any) => (
                    <tr key={log.id}>
                      <td>{log.sync_type}</td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>{log.query_name}</td>
                      <td><StatusBadge value={log.status} /></td>
                      <td style={{ textAlign: "right" }}>{log.elapsed_ms}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{fmtDate(log.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
