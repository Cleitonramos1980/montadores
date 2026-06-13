import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, Page, SearchInput, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";
import { WinthorOrdersTab } from "./WinthorOrdersTab";

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "PEDIDO_CRIADO", label: "Pedido criado" },
  { value: "PEDIDO_SINCRONIZADO", label: "Sincronizado" },
  { value: "MONTAGEM_NECESSARIA", label: "Montagem necessária" },
  { value: "FATURADO", label: "Faturado" },
  { value: "SAIU_PARA_ENTREGA", label: "Saiu para entrega" },
  { value: "ENTREGA_REALIZADA", label: "Entregue" },
  { value: "MONTAGEM_AGENDADA", label: "Montagem agendada" },
  { value: "MONTAGEM_INICIADA", label: "Montagem iniciada" },
  { value: "MONTAGEM_FINALIZADA", label: "Montagem finalizada" },
  { value: "AVALIADO", label: "Avaliado" },
  { value: "SAC_ABERTO", label: "SAC aberto" },
  { value: "CONCLUIDO", label: "Concluído" },
];

const PAGE_SIZE = 100;

function AppOrdersTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const toast = useToast();

  async function load(nextPage = 0, append = false) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextPage * PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      const data = await api<any[]>(`/orders?${params}`);
      setOrders(append ? (prev) => [...prev, ...data] : data);
      setHasMore(data.length === PAGE_SIZE);
      setPage(nextPage);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0); }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.numped?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.city?.toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar pedido ou cliente..." />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setSearch(""); }}
          style={{ minWidth: 200 }}
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loading && orders.length === 0 ? (
        <LoadingState message="Buscando pedidos..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhum pedido encontrado"
          description={search || statusFilter ? "Ajuste os filtros acima." : "Sincronize o WinThor ou crie um pedido demo."}
          action={<a className="ghostButton" href="/montadores">Ir ao dashboard</a>}
        />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Cidade/UF</th>
                <th>Status</th>
                <th>Montagem</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.numped}</strong></td>
                  <td>{order.customer_name}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{order.city}/{order.uf}</td>
                  <td><StatusBadge value={order.current_status} /></td>
                  <td>
                    {order.has_assembly
                      ? <span className="badge badge--em-analise">Sim</span>
                      : <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Não</span>}
                  </td>
                  <td>{Number(order.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                  <td>
                    <a className="ghostButton" href={`/montadores/pedidos/${order.id}`} style={{ fontSize: 13 }}>
                      Ver detalhes
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              {filtered.length} pedido{filtered.length !== 1 ? "s" : ""} exibido{filtered.length !== 1 ? "s" : ""}
              {orders.length !== filtered.length ? ` de ${orders.length} carregado(s)` : ""}
            </p>
            {hasMore && !search && (
              <button
                className="ghostButton"
                style={{ fontSize: 13 }}
                disabled={loading}
                onClick={() => load(page + 1, true)}
              >
                {loading ? "Carregando..." : "Carregar mais"}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function OrdersPage() {
  const [tab, setTab] = useState<"app" | "winthor">("app");

  const tabs = [
    { key: "app",     label: "App Montadores" },
    { key: "winthor", label: "WinThor — PCPEDC" },
  ] as const;

  return (
    <Page title="Pedidos" subtitle="Pedidos sincronizados e consulta direta ao WinThor">
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid var(--border)", marginBottom: 20 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "10px 24px", border: "none", background: "transparent",
              borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -2,
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? "var(--brand)" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 15,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "app"     && <AppOrdersTab />}
      {tab === "winthor" && <WinthorOrdersTab />}
    </Page>
  );
}
