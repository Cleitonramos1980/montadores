import {
  Activity, BadgeDollarSign, Bell, CalendarDays, ClipboardList, Gauge, GitBranch, Hammer,
  Headphones, History, Landmark, LogOut, MapPin, MessageSquareText, PlugZap, Search,
  Shield, Smartphone, Star, Users, X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, clearToken, getStoredUser, hasRole } from "../lib/api";

const ALL_NAV = [
  ["Dashboard",       "/montadores/dashboard",              Gauge,             null],
  ["Pedidos",         "/montadores/pedidos",                ClipboardList,     null],
  ["Agenda",          "/montadores/agenda",                 CalendarDays,      ["ADMIN","GESTOR","OPERACAO","LOGISTICA"]],
  ["Montadores",      "/montadores/prestadores",            Hammer,            null],
  ["Aprovação",       "/montadores/aprovacao",              Users,             null],
  ["App Montador",    "/montadores/app",                    Smartphone,        null],
  ["Minhas Montagens","/montadores/app/minhas-montagens",   History,           null],
  ["SAC",             "/montadores/sac",                    Headphones,        null],
  ["Financeiro",      "/montadores/financeiro",             Landmark,          ["ADMIN","GESTOR","FINANCEIRO"]],
  ["Comissões",       "/montadores/comissoes",              BadgeDollarSign,   ["ADMIN","GESTOR","OPERACAO","LOGISTICA","FINANCEIRO"]],
  ["Avaliações",      "/montadores/avaliacoes",             Star,              null],
  ["Fluxo Mensagens", "/montadores/mensagens",              MessageSquareText, null],
  ["Jornada Cliente", "/montadores/jornada-config",         MapPin,            ["ADMIN","GESTOR"]],
  ["Régua",           "/montadores/regua-fluxo",            GitBranch,         ["ADMIN","GESTOR"]],
  ["WinThor",         "/montadores/integracao-winthor",     PlugZap,           ["ADMIN","GESTOR"]],
  ["Saúde",           "/montadores/saude",                  Activity,          ["ADMIN","GESTOR"]],
  ["Auditoria",       "/montadores/auditoria",              Shield,            ["ADMIN","GESTOR"]],
] as const;

type Notifications = {
  openSac: number | null;
  blockedPayments: number | null;
  pendingProviders: number | null;
  expiringCerts: number | null;
  total: number;
};

type SearchResult = {
  orders: Array<{ id: string; numped: string; customer_name: string; current_status: string }>;
  providers: Array<{ id: string; name: string; document: string; city: string; status: string }>;
};

function logout() {
  clearToken();
  location.href = "/montadores/login";
}

function NotifBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span style={{
      position: "absolute", top: -4, right: -4,
      background: "var(--danger, #c62828)", color: "#fff",
      fontSize: 10, fontWeight: 700, borderRadius: "50%",
      minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0 3px", lineHeight: 1,
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const active = location.pathname;
  const user = getStoredUser();

  const nav = ALL_NAV.filter(([, , , roles]) =>
    roles === null || hasRole(...(roles as unknown as string[])),
  );

  const [oracleDown, setOracleDown] = useState(false);
  const [notif, setNotif] = useState<Notifications | null>(null);
  const [showNotif, setShowNotif] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Oracle health check every 60s
  useEffect(() => {
    async function checkHealth() {
      try {
        const h = await api<{ ok: boolean; db: string }>("/health");
        setOracleDown(h.db === "error");
      } catch {
        setOracleDown(true);
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 60_000);
    return () => clearInterval(id);
  }, []);

  // Notifications poll every 60s
  useEffect(() => {
    async function fetchNotif() {
      try {
        const data = await api<Notifications>("/notifications/summary");
        setNotif(data);
      } catch { /* Oracle may be down */ }
    }
    fetchNotif();
    const id = setInterval(fetchNotif, 60_000);
    return () => clearInterval(id);
  }, []);

  // Global search debounce
  function handleSearch(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults(null); setSearchOpen(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api<SearchResult>(`/search?q=${encodeURIComponent(q)}`);
        setSearchResults(r);
        setSearchOpen(true);
      } catch { /* ignore */ }
    }, 300);
  }

  // Close search on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const notifTotal = notif?.total ?? 0;

  const notifItems = notif ? [
    { label: "SAC abertos", count: notif.openSac, href: "/montadores/sac", color: "var(--danger, #c62828)" },
    { label: "Pgtos bloqueados", count: notif.blockedPayments, href: "/montadores/financeiro", color: "var(--warn, #f57f17)" },
    { label: "Montadores pendentes", count: notif.pendingProviders, href: "/montadores/aprovacao", color: "var(--brand, #2e7d32)" },
    { label: "Certs vencendo (30d)", count: notif.expiringCerts, href: "/montadores/prestadores", color: "var(--text-secondary)" },
  ].filter((i) => (i.count ?? 0) > 0) : [];

  const hasSearchResults = searchResults && (searchResults.orders.length > 0 || searchResults.providers.length > 0);

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
              {/* Notification dots on key nav items */}
              {href === "/montadores/sac" && (notif?.openSac ?? 0) > 0 && (
                <span style={{
                  marginLeft: "auto", background: "var(--danger, #c62828)", color: "#fff",
                  fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px",
                }}>
                  {notif!.openSac}
                </span>
              )}
              {href === "/montadores/financeiro" && (notif?.blockedPayments ?? 0) > 0 && (
                <span style={{
                  marginLeft: "auto", background: "var(--warn, #f57f17)", color: "#fff",
                  fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px",
                }}>
                  {notif!.blockedPayments}
                </span>
              )}
              {href === "/montadores/aprovacao" && (notif?.pendingProviders ?? 0) > 0 && (
                <span style={{
                  marginLeft: "auto", background: "var(--brand)", color: "#fff",
                  fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px",
                }}>
                  {notif!.pendingProviders}
                </span>
              )}
            </a>
          ))}
        </nav>
      </aside>

      <main>
        {/* Oracle offline banner */}
        {oracleDown && (
          <div style={{
            background: "#b71c1c", color: "#fff", padding: "8px 20px",
            fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span>⚠</span>
            <span>Oracle indisponível — algumas funcionalidades estão limitadas. O sistema tentará reconectar automaticamente.</span>
          </div>
        )}

        <header className="topbar">
          <div>
            <strong>Ecossistema Lara</strong>
            <span>Operação, montagem, SAC e financeiro</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, justifyContent: "center", maxWidth: 400, position: "relative" }} ref={searchRef}>
            <div style={{ position: "relative", width: "100%" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults && setSearchOpen(true)}
                placeholder="Buscar pedido ou montador..."
                style={{ width: "100%", paddingLeft: 32, paddingRight: searchQuery ? 32 : 10, minHeight: 36, fontSize: 13 }}
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults(null); setSearchOpen(false); }}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {searchOpen && (searchQuery.length >= 2) && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
                boxShadow: "0 6px 24px rgba(0,0,0,0.12)", zIndex: 1000, overflow: "hidden",
                maxHeight: 360, overflowY: "auto",
              }}>
                {!hasSearchResults ? (
                  <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>
                    Nenhum resultado encontrado.
                  </div>
                ) : (
                  <>
                    {(searchResults?.orders ?? []).length > 0 && (
                      <div>
                        <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>Pedidos</div>
                        {searchResults!.orders.map((o) => (
                          <a
                            key={o.id}
                            href={`/montadores/pedidos/${o.id}`}
                            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                            style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", textDecoration: "none", color: "var(--text)", borderTop: "1px solid var(--border)" }}
                          >
                            <span><strong style={{ fontSize: 13 }}>#{o.numped}</strong> <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 6 }}>{o.customer_name}</span></span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{o.current_status.replace(/_/g, " ")}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {(searchResults?.providers ?? []).length > 0 && (
                      <div>
                        <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>Montadores</div>
                        {searchResults!.providers.map((p) => (
                          <a
                            key={p.id}
                            href={`/montadores/prestadores/${p.id}/perfil`}
                            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                            style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", textDecoration: "none", color: "var(--text)", borderTop: "1px solid var(--border)" }}
                          >
                            <span><strong style={{ fontSize: 13 }}>{p.name}</strong> <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 6 }}>{p.city ?? ""}</span></span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.status}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
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

            {/* Notifications bell */}
            <div style={{ position: "relative" }}>
              <button
                className="ghostButton"
                style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, position: "relative" }}
                onClick={() => setShowNotif((v) => !v)}
                title="Notificações"
              >
                <Bell size={16} />
                <NotifBadge count={notifTotal} />
              </button>

              {showNotif && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 8px)",
                  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.12)", zIndex: 1000, minWidth: 260, overflow: "hidden",
                }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
                    Alertas do sistema
                  </div>
                  {notifItems.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-muted)" }}>
                      ✓ Nenhum alerta no momento
                    </div>
                  ) : (
                    notifItems.map((item) => (
                      <a
                        key={item.label}
                        href={item.href}
                        onClick={() => setShowNotif(false)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", textDecoration: "none", color: "var(--text)", borderTop: "1px solid var(--border)" }}
                      >
                        <span style={{ fontSize: 13 }}>{item.label}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: item.color }}>{item.count}</span>
                      </a>
                    ))
                  )}
                  <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
                    Atualizado automaticamente a cada minuto
                  </div>
                </div>
              )}
            </div>

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
