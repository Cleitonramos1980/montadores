import { useEffect, useState } from "react";
import { ActionButton, LoadingState, Page, useToast } from "../components/Ui";
import { api } from "../lib/api";

type HealthData = {
  db: { status: "ok" | "disabled" | "error"; latencyMs: number | null };
  openFailures: number;
  lastSync: { iniciado_em: string; run_status: string; pedidos_encontrados: number; eventos_gerados: number } | null;
  recentFailures: Array<{ operation: string; error_message: string; created_at: string }>;
};

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "var(--ok)" : status === "disabled" ? "var(--text-muted)" : "var(--danger)";
  const label = status === "ok" ? "Online" : status === "disabled" ? "Desabilitado" : "Erro";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span style={{ fontWeight: 700, color, fontSize: 14 }}>{label}</span>
    </span>
  );
}

function fmtDate(v: string) {
  try { return new Date(v).toLocaleString("pt-BR"); } catch { return v; }
}

export function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<HealthData>("/system/health");
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Page
      title="Saúde do Sistema"
      subtitle="Status do banco de dados, integrações e sincronizações WinThor"
      action={
        <ActionButton className="ghostButton" onClick={load} loadingLabel="Atualizando...">
          ↻ Atualizar
        </ActionButton>
      }
    >
      {lastRefresh && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          Última atualização: {lastRefresh.toLocaleTimeString("pt-BR")} · Atualização automática a cada 30s
        </p>
      )}

      {loading && !data ? (
        <LoadingState message="Verificando status do sistema..." />
      ) : data && (
        <div style={{ display: "grid", gap: 16, maxWidth: 800 }}>
          {/* DB Status */}
          <div className="panel">
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Banco de Dados Oracle</h2>
            <dl className="descList">
              <dt>Status</dt>
              <dd><StatusDot status={data.db.status} /></dd>
              <dt>Latência</dt>
              <dd>
                {data.db.latencyMs !== null ? (
                  <span style={{ fontWeight: 700, color: data.db.latencyMs < 100 ? "var(--ok)" : data.db.latencyMs < 500 ? "var(--warn)" : "var(--danger)" }}>
                    {data.db.latencyMs} ms
                  </span>
                ) : "—"}
              </dd>
            </dl>
          </div>

          {/* Last Sync */}
          <div className="panel">
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Última Sincronização WinThor</h2>
            {data.lastSync ? (
              <dl className="descList">
                <dt>Status</dt>
                <dd>
                  <span style={{
                    fontWeight: 700,
                    color: data.lastSync.run_status === "COMPLETED" ? "var(--ok)"
                      : data.lastSync.run_status === "RUNNING" ? "var(--warn)"
                      : "var(--danger)",
                  }}>
                    {data.lastSync.run_status}
                  </span>
                </dd>
                <dt>Iniciado em</dt>
                <dd>{fmtDate(data.lastSync.iniciado_em)}</dd>
                <dt>Pedidos encontrados</dt>
                <dd>{data.lastSync.pedidos_encontrados}</dd>
                <dt>Eventos gerados</dt>
                <dd>{data.lastSync.eventos_gerados}</dd>
              </dl>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Nenhuma sincronização registrada.</p>
            )}
          </div>

          {/* Open failures */}
          <div className="panel" style={{ background: data.openFailures > 0 ? "var(--warn-bg)" : undefined }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Falhas de Integração Abertas</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: data.openFailures > 0 ? "var(--danger)" : "var(--ok)" }}>
                {data.openFailures}
              </span>
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                {data.openFailures === 0 ? "Nenhuma falha pendente" : "falha(s) não resolvida(s)"}
              </span>
            </div>
            {data.recentFailures.length > 0 && (
              <table>
                <thead>
                  <tr><th>Operação</th><th>Erro</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {data.recentFailures.map((f, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: 12 }}>{f.operation}</code></td>
                      <td style={{ fontSize: 13, color: "var(--danger)", maxWidth: 300, wordBreak: "break-word" }}>{f.error_message}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{fmtDate(f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.openFailures > 5 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Exibindo as 5 mais recentes. Veja todas em{" "}
                <a href="/montadores/integracao-winthor" style={{ color: "var(--brand)" }}>Integração WinThor</a>.
              </p>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
