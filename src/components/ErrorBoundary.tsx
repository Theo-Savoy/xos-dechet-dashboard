import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error inside X OS React tree:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100vw",
            height: "100vh",
            background: "#0d173f",
            color: "#ffffff",
            fontFamily: "system-ui, sans-serif",
            padding: "20px",
            boxSizing: "border-box",
            textAlign: "center",
          }}
        >
          <div
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              backdropFilter: "blur(20px)",
              padding: "30px",
              borderRadius: "16px",
              maxWidth: "500px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            }}
          >
            <h2 style={{ margin: "0 0 16px 0", color: "#ff5e57" }}>Erreur Système X OS</h2>
            <p style={{ fontSize: "14px", color: "#a5b4fc", marginBottom: "24px", lineHeight: "1.5" }}>
              Une erreur inattendue est survenue dans l'interface.
            </p>
            <pre
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#ff8b8b",
                overflowX: "auto",
                textAlign: "left",
                margin: "0 0 24px 0",
              }}
            >
              {this.state.error?.toString() || "Erreur inconnue"}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#8b5bfa",
                color: "#ffffff",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(139, 91, 250, 0.3)",
                transition: "background 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#9d72ff")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#8b5bfa")}
            >
              Recharger X OS
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
