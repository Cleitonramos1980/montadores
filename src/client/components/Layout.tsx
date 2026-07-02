import { BadgeDollarSign, CalendarDays, ClipboardList, Gauge, GitBranch, Hammer, Headphones, History, Landmark, LogOut, MessageSquareText, PlugZap, Shield, Smartphone, Star, Users } from "lucide-react";
import type { ReactNode } from "react";
import { clearToken, getStoredUser } from "../lib/api";

const nav = [
  ["Dashboard", "/montadores/dashboard", Gauge],
  ["Pedidos", "/montadores/pedidos", ClipboardList],
  ["Agenda", "/montadores/agenda", CalendarDays],
  ["Montadores", "/montadores/prestadores", Hammer],
  ["Aprovação", "/montadores/aprovacao", Users],
  ["App Montador", "/montadores/app", Smartphone],
  ["Minhas Montagens", "/montadores/app/minhas-montagens", History],
  ["SAC", "/montadores/sac", Headphones],
  ["Financeiro", "/montadores/financeiro", Landmark],
  ["Comissões", "/montadores/comissoes", BadgeDollarSign],
  ["Avaliações", "/montadores/avaliacoes", Star],
  ["Fluxo Mensagens", "/montadores/mensagens", MessageSquareText],
  ["Régua", "/montadores/regua-fluxo", GitBranch],
  ["WinThor", "/montadores/integracao-winthor", PlugZap],
  ["Auditoria", "/montadores/auditoria", Shield],
] as const;

function logout() {
  clearToken();
  location.href = "/montadores/login";
}

export function Layout({ children }: { children: ReactNode }) {
  const active = location.pathname;
  const user = getStoredUser();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">AM</span>
          <div>
            <strong>App Montadores</strong>
            <small>Jornada pós-venda</small>
          </div>
        </div>
        <nav>
          {nav.map(([label, href, Icon]) => (
            <a
              className={active === href || active.startsWith(href + "/") ? "active" : ""}
              href={href}
              key={href}
            >
              <Icon size={18} />
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <strong>Ecossistema Lara</strong>
            <span>Operação, montagem, SAC e financeiro</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {user && (
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {user.name}
                {user.roles?.length > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>
                    {user.roles[0]}
                  </span>
                )}
              </span>
            )}
            <a className="ghostButton" href="/montadores/cadastro" style={{ fontSize: 13 }}>Cadastro público</a>
            <button
              className="ghostButton"
              style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}
              onClick={logout}
              title="Sair"
            >
              <LogOut size={14} />
              Sair
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
