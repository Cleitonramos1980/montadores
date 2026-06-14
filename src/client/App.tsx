import { Layout } from "./components/Layout";
import { ApprovalPage } from "./pages/ApprovalPage";
import { AuditPage } from "./pages/AuditPage";
import { SystemHealthPage } from "./pages/SystemHealthPage";
import { CustomerJourneyPage } from "./pages/CustomerJourneyPage";
import { JourneyConfigPage } from "./pages/JourneyConfigPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FinancePage } from "./pages/FinancePage";
import { IntegrationPage } from "./pages/IntegrationPage";
import { FlowRulerPage } from "./pages/FlowRulerPage";
import { LoginPage } from "./pages/LoginPage";
import { MessageTemplatesPage } from "./pages/MessageTemplatesPage";
import { FluxoMensagensPage } from "./pages/FluxoMensagensPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProviderAppPage } from "./pages/ProviderAppPage";
import { ProviderProfilePage } from "./pages/ProviderProfilePage";
import { MontadorMinhasMontagens } from "./pages/MontadorMinhasMontagens";
import { CommissionsPage } from "./pages/CommissionsPage";
import { ProviderNewPage } from "./pages/ProviderNewPage";
import { ProviderRegistrationPage } from "./pages/ProviderRegistrationPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { PublicReviewPage } from "./pages/PublicReviewPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { EvaluationConfigPage } from "./pages/EvaluationConfigPage";
import { PublicEvaluationPage } from "./pages/PublicEvaluationPage";
import { SacPage } from "./pages/SacPage";
import { SchedulePage } from "./pages/SchedulePage";
import { getToken, hasRole } from "./lib/api";

export function App() {
  const path = location.pathname;

  // Public routes — no auth required, no layout
  if (path.startsWith("/montadores/jornada-publica/")) return <CustomerJourneyPage token={path.split("/").pop()!} />;
  if (path.startsWith("/montadores/avaliacao/")) return <PublicReviewPage token={path.split("/").pop()!} />;
  if (path.startsWith("/montadores/eval/")) return <PublicEvaluationPage token={path.split("/").pop()!} />;
  if (path === "/montadores/cadastro") return <ProviderRegistrationPage />;
  if (path === "/montadores/login") return <LoginPage />;

  // All other routes require auth
  if (!getToken()) {
    location.href = "/montadores/login";
    return null;
  }

  // Redirect root to dashboard
  if (path === "/montadores" || path === "/montadores/") {
    location.replace("/montadores/dashboard");
    return null;
  }

  const canAccessCommissions = hasRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "FINANCEIRO");
  const canAccessAgenda      = hasRole("ADMIN", "GESTOR", "OPERACAO", "LOGISTICA");
  const canAccessFinanceiro  = hasRole("ADMIN", "GESTOR", "FINANCEIRO");
  const canAccessAuditoria   = hasRole("ADMIN", "GESTOR");

  const Forbidden = () => (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Acesso restrito</h2>
      <p>Você não tem permissão para acessar esta página.</p>
    </div>
  );

  let page = <DashboardPage />;
  if (path === "/montadores/dashboard") page = <DashboardPage />;
  if (path === "/montadores/pedidos") page = <OrdersPage />;
  if (path.startsWith("/montadores/pedidos/")) page = <OrderDetailPage id={path.split("/").pop()!} />;
  if (path === "/montadores/agenda") page = canAccessAgenda ? <SchedulePage /> : <Forbidden />;
  if (path === "/montadores/prestadores") page = <ProvidersPage />;
  if (path === "/montadores/prestadores/novo") page = <ProviderNewPage />;
  if (path.match(/^\/montadores\/prestadores\/[^/]+\/perfil$/)) {
    page = <ProviderProfilePage id={path.split("/")[3]} />;
  }
  if (path === "/montadores/aprovacao") page = <ApprovalPage />;
  if (path === "/montadores/sac") page = <SacPage />;
  if (path === "/montadores/financeiro") page = canAccessFinanceiro ? <FinancePage /> : <Forbidden />;
  if (path === "/montadores/comissoes") page = canAccessCommissions ? <CommissionsPage /> : <Forbidden />;
  if (path === "/montadores/avaliacoes") page = <ReviewsPage />;
  if (path === "/montadores/eval-config") page = canAccessAuditoria ? <EvaluationConfigPage /> : <Forbidden />;
  if (path === "/montadores/mensagens") page = <FluxoMensagensPage />;
  if (path === "/montadores/mensagens-templates") page = hasRole("ADMIN", "GESTOR") ? <MessageTemplatesPage /> : <Forbidden />;
  if (path === "/montadores/jornada-config") page = hasRole("ADMIN", "GESTOR") ? <JourneyConfigPage /> : <Forbidden />;
  if (path === "/montadores/regua-fluxo") page = hasRole("ADMIN", "GESTOR") ? <FlowRulerPage /> : <Forbidden />;
  if (path === "/montadores/integracao-winthor") page = hasRole("ADMIN", "GESTOR") ? <IntegrationPage /> : <Forbidden />;
  if (path === "/montadores/app") page = <ProviderAppPage />;
  if (path === "/montadores/app/minhas-montagens") page = <MontadorMinhasMontagens />;
  if (path === "/montadores/auditoria") page = canAccessAuditoria ? <AuditPage /> : <Forbidden />;
  if (path === "/montadores/saude") page = hasRole("ADMIN", "GESTOR") ? <SystemHealthPage /> : <Forbidden />;


  return <Layout>{page}</Layout>;
}
