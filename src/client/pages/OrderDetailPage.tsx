import { useEffect, useState } from "react";
import { ActionButton, JustifyDialog, LoadingState, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

type Tab = "timeline" | "produtos" | "sac" | "pagamentos" | "auditoria";

export function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("timeline");
  const [publicLink, setPublicLink] = useState("");
  const [showSacDialog, setShowSacDialog] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<any>(`/orders/${id}`);
      setOrder(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  async function createToken() {
    try {
      const token = await api<any>(`/orders/${order.id}/public-token`, { method: "POST", body: "{}" });
      setPublicLink(token.url);
      toast("Link público gerado. Copie e envie ao cliente.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function openSac(reason: string) {
    try {
      await api(`/orders/${order.id}/sac`, {
        method: "POST",
        body: JSON.stringify({ reason, description: `Caso aberto manualmente pela operação: ${reason}` }),
      });
      toast("SAC aberto com sucesso.");
      setShowSacDialog(false);
      load();
    } catch (err) {
      toast((err as Error).message, "error");
      setShowSacDialog(false);
    }
  }

  async function syncWinthor() {
    try {
      await api(`/integration/winthor/orders/${order.numped}/sync`, { method: "POST", body: "{}" });
      toast("Sincronização iniciada.");
      setTimeout(load, 1500);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  if (loading) return <Page title="Pedido"><LoadingState /></Page>;
  if (!order) return <Page title="Pedido"><div className="error">Pedido não encontrado.</div></Page>;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "timeline", label: "Timeline", count: order.timeline?.length },
    { key: "produtos", label: "Produtos", count: order.items?.length },
    { key: "sac", label: "SAC", count: order.sacCases?.length },
    { key: "pagamentos", label: "Pagamentos", count: order.payments?.length },
    { key: "auditoria", label: "Auditoria", count: order.audit?.length },
  ];

  return (
    <Page
      title={`Pedido ${order.numped}`}
      subtitle={order.customer_name}
      action={
        <div className="actionsRow">
          <ActionButton onClick={syncWinthor} className="ghostButton" loadingLabel="Sincronizando...">↻ Sincronizar</ActionButton>
          <ActionButton onClick={createToken} loadingLabel="Gerando...">🔗 Link do cliente</ActionButton>
          <button className="dangerButton" onClick={() => setShowSacDialog(true)}>Abrir SAC</button>
        </div>
      }
    >
      {publicLink && (
        <div className="success" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ wordBreak: "break-all", fontSize: 13 }}>{publicLink}</span>
          <button className="ghostButton" style={{ flexShrink: 0, marginLeft: 12 }} onClick={() => { navigator.clipboard?.writeText(publicLink); toast("Link copiado!"); }}>
            Copiar
          </button>
        </div>
      )}

      <div className="detailGrid" style={{ marginBottom: 20 }}>
        <section className="panel">
          <h2>Dados do pedido</h2>
          <dl className="descList">
            <dt>Status</dt><dd><StatusBadge value={order.current_status} /></dd>
            <dt>Montagem</dt><dd>{order.has_assembly ? "Sim" : "Não"}</dd>
            <dt>Filial</dt><dd>{order.branch ?? "—"}</dd>
            <dt>Vendedor</dt><dd>{order.seller ?? "—"}</dd>
            <dt>Cidade/UF</dt><dd>{order.city}/{order.uf}</dd>
            <dt>Total</dt><dd><strong>{Number(order.total_amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></dd>
          </dl>
        </section>
        <section className="panel">
          <h2>Dados do cliente</h2>
          <dl className="descList">
            <dt>Nome</dt><dd>{order.customer_name}</dd>
            <dt>Telefone</dt><dd>{order.customer_phone ?? "—"}</dd>
            <dt>E-mail</dt><dd>{order.customer_email ?? "—"}</dd>
            <dt>Endereço</dt><dd>{order.address?.street ?? "—"}</dd>
          </dl>
        </section>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tabBtn${tab === t.key ? " tabBtn--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="tabCount">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 0, borderRadius: "0 0 8px 8px", borderTop: "none" }}>
        {tab === "timeline" && (
          <div className="timeline">
            {order.timeline?.length === 0 && <p style={{ color: "var(--text-muted)" }}>Nenhum evento registrado.</p>}
            {order.timeline?.map((item: any) => (
              <div className="timelineItem" key={item.id}>
                <span />
                <div>
                  <strong>{item.title}</strong>
                  <p style={{ margin: "2px 0 0", fontSize: 14, color: "var(--text-secondary)" }}>{item.description}</p>
                  <small>{new Date(item.created_at).toLocaleString("pt-BR")}</small>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "produtos" && (
          <table>
            <thead><tr><th>Produto</th><th>Qtd</th><th>Montagem</th><th>Custo montagem</th></tr></thead>
            <tbody>
              {order.items?.map((item: any) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>{item.requires_assembly ? <span className="badge badge--em-analise">Sim</span> : "—"}</td>
                  <td>{item.assembly_cost > 0 ? Number(item.assembly_cost).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "sac" && (
          <>
            {order.sacCases?.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>Nenhum caso SAC registrado.</p>
            ) : (
              <table>
                <thead><tr><th>Motivo</th><th>Status</th><th>Abertura</th><th></th></tr></thead>
                <tbody>
                  {order.sacCases?.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.reason}</td>
                      <td><StatusBadge value={s.status} /></td>
                      <td>{new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
                      <td><a className="ghostButton" href="/montadores/sac" style={{ fontSize: 13 }}>Ver SAC</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "pagamentos" && (
          <>
            {order.payments?.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>Nenhum pagamento vinculado.</p>
            ) : (
              <table>
                <thead><tr><th>Valor</th><th>Status</th><th>Programado para</th></tr></thead>
                <tbody>
                  {order.payments?.map((p: any) => (
                    <tr key={p.id}>
                      <td>{Number(p.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                      <td><StatusBadge value={p.status} /></td>
                      <td>{p.programmed_for ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "auditoria" && (
          <table>
            <thead><tr><th>Ação</th><th>Entidade</th><th>Usuário</th><th>Data/Hora</th></tr></thead>
            <tbody>
              {order.audit?.length === 0 && <tr><td colSpan={4} style={{ color: "var(--text-muted)" }}>Nenhum registro.</td></tr>}
              {order.audit?.map((a: any) => (
                <tr key={a.id}>
                  <td><code style={{ fontSize: 12 }}>{a.action}</code></td>
                  <td>{a.entity_type}</td>
                  <td>{a.actor_user_id ?? "sistema"}</td>
                  <td style={{ fontSize: 12 }}>{new Date(a.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showSacDialog && (
        <JustifyDialog
          title="Abrir caso SAC"
          message="Informe o motivo para abrir um caso SAC neste pedido. A ação será registrada na auditoria."
          confirmLabel="Abrir SAC"
          destructive
          onConfirm={openSac}
          onCancel={() => setShowSacDialog(false)}
        />
      )}
    </Page>
  );
}
