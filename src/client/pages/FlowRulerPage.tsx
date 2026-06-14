import { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

const EVENT_LABELS: Record<string, string> = {
  PEDIDO_CRIADO:              "Pedido criado",
  PEDIDO_SINCRONIZADO:        "Pedido sincronizado",
  SEPARACAO_INICIADA:         "Separação iniciada",
  CONFERENCIA_FINALIZADA:     "Conferência finalizada",
  FATURADO:                   "Faturado",
  SAIU_PARA_ENTREGA:          "Saiu para entrega",
  ENTREGA_REALIZADA:          "Entrega realizada",
  MONTAGEM_NECESSARIA:        "Montagem necessária",
  LINK_AGENDAMENTO_ENVIADO:   "Link de agendamento enviado",
  MONTAGEM_AGENDADA:          "Montagem agendada",
  MONTAGEM_INICIADA:          "Montagem iniciada",
  FOTOS_MONTAGEM_ANEXADAS:    "Fotos de montagem anexadas",
  MONTAGEM_FINALIZADA:        "Montagem finalizada",
  LINK_AVALIACAO_MONTAGEM_ENVIADO: "Link de avaliação enviado",
  AVALIACAO_CLIENTE_RECEBIDA: "Avaliação recebida",
  SAC_CASO_ABERTO:            "SAC — Caso aberto",
  SAC_RESPONSAVEL_ATRIBUIDO:  "SAC — Responsável atribuído",
  SAC_ENCERROU_CASO:          "SAC — Caso encerrado",
  PAGAMENTO_LIBERADO:         "Pagamento liberado",
  PAGAMENTO_REALIZADO:        "Pagamento realizado",
  INTEGRACAO_WINTHOR_ERRO:    "Erro de integração WinThor",
};

function lbl(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

type StepStat = { eventType: string; count: number };

// ── Aggregate ruler ───────────────────────────────────────────────────────────

function AggregateRuler({
  stats,
  lastRefresh,
  onRefresh,
  refreshing,
}: {
  stats: StepStat[];
  lastRefresh: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  // "Currently at step N" = completed step N but not yet step N+1
  const stepsWithCurrent = useMemo(() => {
    return stats.map((step, i) => {
      const next = stats[i + 1];
      const current = next ? step.count - next.count : step.count;
      const maxCount = stats[0]?.count || 1;
      const pct = maxCount > 0 ? Math.round((step.count / maxCount) * 100) : 0;
      return { ...step, current: Math.max(0, current), pct };
    });
  }, [stats]);

  const maxCount = stats[0]?.count || 1;

  return (
    <section className="panel spacedPanel">
      <div className="flowHeader" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Visão geral do pipeline</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
            Contagem de pedidos em cada etapa da jornada
          </p>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Total de pedidos</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--brand)" }}>{maxCount.toLocaleString("pt-BR")}</div>
          </div>
          <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 20 }}>
            {lastRefresh && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                Atualizado às {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
            )}
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                background: "var(--brand)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: refreshing ? "not-allowed" : "pointer",
                opacity: refreshing ? 0.7 : 1,
              }}
            >
              {refreshing ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {stepsWithCurrent.map((step, i) => {
          const pct = maxCount > 0 ? Math.round((step.count / maxCount) * 100) : 0;
          const barColor = pct >= 70 ? "var(--ok)" : pct >= 40 ? "var(--brand)" : pct >= 20 ? "var(--warn)" : "var(--danger)";

          return (
            <div
              key={step.eventType}
              style={{
                background: "var(--bg-white)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              {/* Step header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                  background: step.count > 0 ? "var(--brand)" : "var(--border)",
                  color: step.count > 0 ? "#fff" : "var(--text-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 11,
                }}>
                  {i + 1}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", lineHeight: 1.3 }}>
                  {lbl(step.eventType)}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ background: "var(--border)", borderRadius: 4, height: 6, marginBottom: 8, overflow: "hidden" }}>
                <div style={{
                  width: `${pct}%`, height: "100%", background: barColor,
                  borderRadius: 4, transition: "width .4s ease",
                }} />
              </div>

              {/* Counts */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: step.count > 0 ? "var(--text)" : "var(--text-muted)", lineHeight: 1 }}>
                    {step.count.toLocaleString("pt-BR")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    passaram por aqui
                  </div>
                </div>
                {step.current > 0 && (
                  <div style={{
                    background: "var(--brand-light)", color: "var(--brand)",
                    borderRadius: 20, padding: "3px 12px",
                    fontSize: 16, fontWeight: 800,
                  }}>
                    {step.current}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Individual ruler ──────────────────────────────────────────────────────────

function IndividualRuler({ order }: { order: any }) {
  return (
    <>
      <section className="panel spacedPanel">
        <div className="flowHeader">
          <div>
            <h2>Pedido {order.numped}</h2>
            <p>{order.customer_name}</p>
          </div>
          <StatusBadge value={order.current_status} />
        </div>
        <div className="ruler">
          {order.progress.map((step: any, index: number) => (
            <div className={`rulerStep ${step.done ? "done" : ""}`} key={step.eventType}>
              <span>{index + 1}</span>
              <strong>{lbl(step.eventType)}</strong>
              <small>
                {step.occurredAt
                  ? new Date(step.occurredAt).toLocaleString("pt-BR")
                  : "Pendente"}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel spacedPanel">
        <h2>Histórico do pedido</h2>
        <div className="timeline">
          {order.history.map((event: any, index: number) => (
            <div className="timelineItem" key={`${event.type}-${index}`}>
              <span />
              <div>
                <strong>{event.title ?? lbl(event.type)}</strong>
                <p>{event.description ?? `Origem: ${event.origin}`}</p>
                <small>{new Date(event.created_at).toLocaleString("pt-BR")} · {event.origin}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function FlowRulerPage() {
  const [orders, setOrders]         = useState<any[]>([]);
  const [stats, setStats]           = useState<StepStat[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");  // "" = aggregate view
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const toast = useToast();

  const loadData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      api<any[]>("/flow-ruler"),
      api<StepStat[]>("/flow-ruler/stats"),
    ])
      .then(([orderData, statsData]) => {
        setOrders(orderData);
        setStats(statsData);
        setLastRefresh(new Date());
      })
      .catch((err) => toast((err as Error).message, "error"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [toast]);

  useEffect(() => { loadData(false); }, [loadData]);

  const selected = useMemo(
    () => (selectedId ? orders.find((o) => o.id === selectedId) : null),
    [orders, selectedId],
  );

  return (
    <Page
      title="Régua de Fluxo"
      subtitle="Histórico visual fase a fase da jornada do pedido"
    >
      {loading ? (
        <LoadingState message="Carregando pedidos..." />
      ) : (
        <>
          {/* Selector */}
          <div className="toolbar" style={{ marginBottom: 20 }}>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ minWidth: 320 }}
            >
              <option value="">— Visão geral (todos os pedidos) —</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.numped} — {order.customer_name}
                </option>
              ))}
            </select>
            {selected && (
              <a className="ghostButton" href={`/montadores/pedidos/${selected.id}`}>
                Abrir pedido
              </a>
            )}
          </div>

          {/* Aggregate view (default) */}
          {!selected && stats.length > 0 && (
            <AggregateRuler
              stats={stats}
              lastRefresh={lastRefresh}
              onRefresh={() => loadData(true)}
              refreshing={refreshing}
            />
          )}

          {/* Individual order view */}
          {selected && <IndividualRuler order={selected} />}

          {orders.length === 0 && stats.length === 0 && (
            <div className="emptyState">
              <strong>Nenhum pedido monitorado</strong>
              <p>Crie um pedido para ver a régua em ação.</p>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
