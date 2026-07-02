import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// ─── TOAST SYSTEM ───────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info";
interface ToastItem { id: number; message: string; type: ToastType; }

const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toastContainer" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`} role="alert">
            <span className="toastIcon">{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ─── STATUS LABELS ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PEDIDO_CRIADO: "Pedido criado",
  PEDIDO_SINCRONIZADO: "Sincronizado",
  MONTAGEM_NECESSARIA: "Montagem necessária",
  AGUARDANDO_ANALISE: "Aguardando análise",
  AGUARDANDO_AGENDAMENTO: "Aguardar agendamento",
  AGUARDANDO_AVALIACAO_CLIENTE: "Aguard. avaliação",
  AGUARDANDO_FINALIZACAO: "Aguard. finalização",
  AGUARDANDO_APROVACAO_SAC: "Aguard. SAC",
  AGUARDANDO_DOCUMENTACAO: "Aguard. documentação",
  EM_ANALISE: "Em análise",
  EM_EXECUCAO: "Em execução",
  PRE_CADASTRO: "Pré-cadastro",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
  SUSPENSO: "Suspenso",
  REATIVADO: "Reativado",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  BLOQUEADO: "Bloqueado",
  LIBERADO: "Liberado",
  PROGRAMADO: "Programado",
  PAGO: "Pago",
  CANCELADO: "Cancelado",
  AGENDADA: "Agendada",
  FINALIZADA: "Finalizada",
  ABERTO: "Aberto",
  RESOLVIDO: "Resolvido",
  ENCERRADO: "Encerrado",
  POSITIVA: "Positiva",
  NEGATIVA: "Negativa",
  NEUTRA: "Neutra",
  SUCESSO: "Sucesso",
  ERRO: "Erro",
  PENDENTE: "Pendente",
  CONFIGURADO: "Configurado",
  ENVIA_CLIENTE: "Envia ao cliente",
  INTERNO: "Interno",
};

// ─── STATUS BADGE ────────────────────────────────────────────────────────────

export function StatusBadge({ value }: { value: string }) {
  if (!value) return null;
  const label = STATUS_LABELS[value] ?? value.replaceAll("_", " ");
  const cls = value.toLowerCase().replaceAll("_", "-");
  return <span className={`badge badge--${cls}`}>{label}</span>;
}

// ─── PAGE STRUCTURE ──────────────────────────────────────────────────────────

export function Page({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="page">
      <div className="pageHeader">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="pageSubtitle">{subtitle}</p>}
        </div>
        {action && <div className="pageAction">{action}</div>}
      </div>
      {children}
    </section>
  );
}

// ─── METRIC CARD ─────────────────────────────────────────────────────────────

export function MetricCard({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  href?: string;
}) {
  const card = (
    <article className={`metric ${tone}${href ? " metric--link" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {href && <span className="metricArrow">→</span>}
    </article>
  );
  return href ? (
    <a href={href} style={{ textDecoration: "none", display: "block" }}>
      {card}
    </a>
  ) : (
    card
  );
}

// ─── LOADING STATE ───────────────────────────────────────────────────────────

export function LoadingState({ message = "Carregando..." }: { message?: string }) {
  return (
    <div className="loadingState">
      <div className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <table>
      <thead>
        <tr>{Array.from({ length: cols }).map((_, i) => <th key={i}><div className="skeleton" style={{ width: `${60 + i * 10}%` }} /></th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>{Array.from({ length: cols }).map((_, c) => <td key={c}><div className="skeleton" style={{ width: `${50 + c * 15}%` }} /></td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

export function EmptyState({
  title = "Nenhum item encontrado",
  description,
  action,
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="emptyState">
      <div className="emptyIcon">○</div>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

// ─── CONFIRM DIALOG ──────────────────────────────────────────────────────────

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modalOverlay" onClick={onCancel}>
      <div className="modalBox" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 8 }}>{title}</h2>
        <p style={{ color: "#475467", marginBottom: 20 }}>{message}</p>
        <div className="actionsRow">
          <button
            className={destructive ? "dangerButton" : ""}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processando..." : confirmLabel}
          </button>
          <button className="ghostButton" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JUSTIFY DIALOG (with textarea) ─────────────────────────────────────────

export function JustifyDialog({
  title,
  message,
  placeholder = "Justificativa obrigatória...",
  confirmLabel = "Confirmar",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: (justification: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="modalOverlay" onClick={onCancel}>
      <div className="modalBox" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 8 }}>{title}</h2>
        {message && <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: "0 0 12px" }}>{message}</p>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", marginBottom: 16 }}
          autoFocus
        />
        <div className="actionsRow">
          <button
            className={destructive ? "dangerButton" : ""}
            onClick={() => text.trim() && onConfirm(text.trim())}
            disabled={!text.trim() || loading}
          >
            {loading ? "Processando..." : confirmLabel}
          </button>
          <button className="ghostButton" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SEARCH INPUT ────────────────────────────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="searchWrapper">
      <span className="searchIcon">⌕</span>
      <input
        className="searchInput"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button className="searchClear" onClick={() => onChange("")} aria-label="Limpar">
          ×
        </button>
      )}
    </div>
  );
}

// ─── ACTION BUTTON (with loading protection) ─────────────────────────────────

export function ActionButton({
  onClick,
  children,
  className = "",
  disabled = false,
  loadingLabel = "Processando...",
}: {
  onClick: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  loadingLabel?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    if (loading || disabled) return;
    setLoading(true);
    try {
      await onClick();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className={className} onClick={handle} disabled={loading || disabled} aria-busy={loading}>
      {loading ? loadingLabel : children}
    </button>
  );
}

// ─── PRIORITY BADGE ──────────────────────────────────────────────────────────

export function PriorityBadge({ level }: { level: "alta" | "media" | "baixa" }) {
  const map = { alta: { label: "Alta", cls: "priorityHigh" }, media: { label: "Média", cls: "priorityMed" }, baixa: { label: "Baixa", cls: "priorityLow" } };
  const { label, cls } = map[level];
  return <span className={`priority ${cls}`}>{label}</span>;
}
