import { useEffect, useState } from "react";
import { ActionButton, ConfirmDialog, JustifyDialog, LoadingState, MetricCard, Page, StatusBadge, useToast } from "../components/Ui";
import { api } from "../lib/api";

export function FinancePage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [programDate, setProgramDate] = useState<Record<string, string>>({});
  const [confirmPay, setConfirmPay] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const data = await api<any[]>("/payments");
      setPayments(data);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  async function doRelease(id: string, justification: string) {
    try {
      await api(`/payments/${id}/release`, { method: "POST", body: JSON.stringify({ justification }) });
      toast("Pagamento liberado.");
      setReleaseTarget(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setReleaseTarget(null);
    }
  }

  async function doProgram(id: string) {
    try {
      const date = programDate[id] ?? new Date().toISOString().slice(0, 10);
      await api(`/payments/${id}/program`, { method: "POST", body: JSON.stringify({ programmedFor: date }) });
      toast("Pagamento programado.");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function doPay(id: string) {
    try {
      await api(`/payments/${id}/pay`, { method: "POST", body: "{}" });
      toast("Pagamento marcado como pago.");
      setConfirmPay(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
      setConfirmPay(null);
    }
  }

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const totalBlocked = payments.filter((p) => p.status === "BLOQUEADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalReleased = payments.filter((p) => p.status === "LIBERADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalProgrammed = payments.filter((p) => p.status === "PROGRAMADO").reduce((s, p) => s + Number(p.amount), 0);
  const totalPaid = payments.filter((p) => p.status === "PAGO").reduce((s, p) => s + Number(p.amount), 0);

  const payToConfirm = confirmPay ? payments.find((p) => p.id === confirmPay) : null;
  const releasePayment = releaseTarget ? payments.find((p) => p.id === releaseTarget) : null;

  return (
    <Page
      title="Financeiro"
      subtitle="Pagamentos só podem ser programados após liberação; bloqueados ficam retidos até SAC resolver"
    >
      {loading ? (
        <LoadingState message="Carregando pagamentos..." />
      ) : (
        <>
          <div className="metricsGrid" style={{ marginBottom: 24 }}>
            <MetricCard label="Bloqueado" value={fmt(totalBlocked)} tone="danger" />
            <MetricCard label="Liberado (aguardando)" value={fmt(totalReleased)} tone="warn" />
            <MetricCard label="Programado" value={fmt(totalProgrammed)} tone="neutral" />
            <MetricCard label="Pago" value={fmt(totalPaid)} tone="ok" />
          </div>

          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Montador</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Programado para</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>Nenhum pagamento registrado.</td>
                </tr>
              )}
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.numped}</strong></td>
                  <td>{payment.provider_name}</td>
                  <td>{fmt(Number(payment.amount))}</td>
                  <td><StatusBadge value={payment.status} /></td>
                  <td>{payment.programmed_for ?? "—"}</td>
                  <td className="actionsRow">
                    {payment.status === "BLOQUEADO" && (
                      <ActionButton
                        className="ghostButton"
                        loadingLabel="..."
                        onClick={() => setReleaseTarget(payment.id)}
                      >
                        Liberar
                      </ActionButton>
                    )}
                    {payment.status === "LIBERADO" && (
                      <>
                        <input
                          type="date"
                          value={programDate[payment.id] ?? new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setProgramDate((prev) => ({ ...prev, [payment.id]: e.target.value }))}
                          style={{ minHeight: "auto", padding: "6px 8px" }}
                        />
                        <ActionButton loadingLabel="Programando..." onClick={() => doProgram(payment.id)}>
                          Programar
                        </ActionButton>
                      </>
                    )}
                    {payment.status === "PROGRAMADO" && (
                      <ActionButton
                        className="dangerButton"
                        loadingLabel="Processando..."
                        onClick={() => setConfirmPay(payment.id)}
                      >
                        Marcar como pago
                      </ActionButton>
                    )}
                    {payment.status === "PAGO" && (
                      <span style={{ color: "var(--ok)", fontWeight: 700, fontSize: 13 }}>✓ Pago</span>
                    )}
                    {payment.status === "AGUARDANDO_FINALIZACAO" && (
                      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Aguardando montagem</span>
                    )}
                    {payment.status === "AGUARDANDO_AVALIACAO_CLIENTE" && (
                      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Aguardando avaliação</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {payToConfirm && (
        <ConfirmDialog
          title="Confirmar pagamento"
          message={`Confirma o pagamento de ${fmt(Number(payToConfirm.amount))} para ${payToConfirm.provider_name} (Pedido ${payToConfirm.numped})? Esta ação não pode ser desfeita.`}
          confirmLabel="Sim, confirmar pagamento"
          cancelLabel="Cancelar"
          onConfirm={() => doPay(payToConfirm.id)}
          onCancel={() => setConfirmPay(null)}
        />
      )}

      {releasePayment && (
        <JustifyDialog
          title="Liberar pagamento"
          message={`Informe a justificativa para liberar ${fmt(Number(releasePayment.amount))} para ${releasePayment.provider_name} (Pedido ${releasePayment.numped}).`}
          confirmLabel="Liberar pagamento"
          onConfirm={(justification) => doRelease(releasePayment.id, justification)}
          onCancel={() => setReleaseTarget(null)}
        />
      )}
    </Page>
  );
}
