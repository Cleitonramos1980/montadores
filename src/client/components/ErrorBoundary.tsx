import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;

    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "60vh", padding: "2rem", textAlign: "center",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
          <h2 style={{ marginBottom: "0.5rem", color: "#1f2937" }}>Algo deu errado</h2>
          <p style={{ color: "#6b7280", marginBottom: "1.5rem", maxWidth: 420 }}>
            Ocorreu um erro inesperado nesta página. Tente recarregar ou volte ao painel.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={this.reset}
              style={{
                padding: "0.5rem 1.25rem", borderRadius: "0.375rem", border: "none",
                background: "#1f2937", color: "#fff", cursor: "pointer", fontWeight: 600,
              }}
            >
              Tentar novamente
            </button>
            <button
              onClick={() => { location.href = "/montadores/dashboard"; }}
              style={{
                padding: "0.5rem 1.25rem", borderRadius: "0.375rem",
                border: "1px solid #d1d5db", background: "#fff", cursor: "pointer",
              }}
            >
              Voltar ao painel
            </button>
          </div>
          {(import.meta as Record<string, any>).env?.DEV && (
            <pre style={{
              marginTop: "1.5rem", padding: "1rem", background: "#fef2f2",
              border: "1px solid #fca5a5", borderRadius: "0.5rem", textAlign: "left",
              fontSize: "0.75rem", color: "#991b1b", maxWidth: "100%", overflowX: "auto",
            }}>
              {error.message}{"\n"}{error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
