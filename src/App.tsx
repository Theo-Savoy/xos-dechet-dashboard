import { LoginScreen } from "./lib/LoginScreen";
import { useSession } from "./lib/useSession";
import { Desktop } from "./os/Desktop";
import type { Session } from "@supabase/supabase-js";

function AppContent({ session }: { session: Session }) {
  return <Desktop userEmail={session.user.email ?? "Utilisateur X OS"} />;
}

function App() {
  const { session, loading, bridgeError } = useSession();

  if (loading) {
    return <div style={{ color: "#e6e6e6", padding: 40 }}>Chargement…</div>;
  }

  if (bridgeError) {
    return (
      <div style={{ color: "#e6e6e6", padding: 40, textAlign: "center" }}>
        <p>Impossible de préparer l'accès au CRM.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: "8px 24px",
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <AppContent session={session} />;
}

export default App;
