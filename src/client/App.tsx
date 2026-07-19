import { Layout } from "./components/Layout";
import { ApprovalPage } from "./pages/ApprovalPage";
import { AuditPage } from "./pages/AuditPage";
import { CustomerJourneyPage } from "./pages/CustomerJourneyPage";
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
import { MontadorMinhasMontagens } from "./pages/MontadorMinhasMontagens";
import { CommissionsPage } from "./pages/CommissionsPage";
import { ProviderNewPage } from "./pages/ProviderNewPage";
import { ProviderRegistrationPage } from "./pages/ProviderRegistrationPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { PublicReviewPage } from "./pages/PublicReviewPage";
import { PublicEvaluationPage } from "./pages/PublicEvaluationPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { SacPage } from "./pages/SacPage";
import { SchedulePage } from "./pages/SchedulePage";
import { UsersPage } from "./pages/UsersPage";
import { SystemHealthPage } from "./pages/SystemHealthPage";
import { EvaluationConfigPage } from "./pages/EvaluationConfigPage";
import { ProviderProfilePage } from "./pages/ProviderProfilePage";
import { getToken, getStoredUser } from "./lib/api";

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

  // Guarda de papel no client (UX; o RBAC real permanece no backend).
  // Montadores só acessam as rotas do app do montador — qualquer outra rota
  // (incluindo o painel admin por URL direta) redireciona para a tela do montador.
  // Papéis de staff mantêm o painel completo (comportamento preservado).
  const roles = getStoredUser()?.roles ?? [];
  const STAFF_ROLES = ["ADMIN", "GESTOR", "OPERACAO", "SAC", "FINANCEIRO", "CONSULTA"];
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
  const isMontador = roles.includes("MONTADOR");
  const MONTADOR_PATHS = ["/montadores/app", "/montadores/app/minhas-montagens"];
  if (isMontador && !isStaff && !MONTADOR_PATHS.includes(path)) {
    location.replace("/montadores/app");
    return null;
  }

  // Redirect root to dashboard (staff). Montadores já foram redirecionados acima.
  if (path === "/montadores" || path === "/montadores/") {
    location.replace("/montadores/dashboard");
    return null;
  }

  let page = <DashboardPage />;
  if (path === "/montadores/dashboard") page = <DashboardPage />;
  if (path === "/montadores/pedidos") page = <OrdersPage />;
  if (path.startsWith("/montadores/pedidos/")) page = <OrderDetailPage id={path.split("/").pop()!} />;
  if (path === "/montadores/agenda") page = <SchedulePage />;
  if (path === "/montadores/prestadores") page = <ProvidersPage />;
  if (path === "/montadores/prestadores/novo") page = <ProviderNewPage />;
  // :id precisa vir DEPOIS de /novo (senão "novo" seria capturado como id)
  else if (path.startsWith("/montadores/prestadores/")) page = <ProviderProfilePage id={path.split("/").pop()!} />;
  if (path === "/montadores/aprovacao") page = <ApprovalPage />;
  if (path === "/montadores/sac") page = <SacPage />;
  if (path === "/montadores/financeiro") page = <FinancePage />;
  if (path === "/montadores/comissoes") page = <CommissionsPage />;
  if (path === "/montadores/avaliacoes") page = <ReviewsPage />;
  if (path === "/montadores/mensagens") page = <FluxoMensagensPage />;
  if (path === "/montadores/mensagens-templates") page = <MessageTemplatesPage />;
  if (path === "/montadores/regua-fluxo") page = <FlowRulerPage />;
  if (path === "/montadores/integracao-winthor") page = <IntegrationPage />;
  if (path === "/montadores/app") page = <ProviderAppPage />;
  if (path === "/montadores/app/minhas-montagens") page = <MontadorMinhasMontagens />;
  if (path === "/montadores/auditoria") page = <AuditPage />;
  if (path === "/montadores/usuarios") page = <UsersPage />;
  if (path === "/montadores/saude") page = <SystemHealthPage />;
  if (path === "/montadores/avaliacoes-config") page = <EvaluationConfigPage />;

  return <Layout>{page}</Layout>;
}
