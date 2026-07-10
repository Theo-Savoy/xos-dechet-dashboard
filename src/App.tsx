import { LoginScreen } from "./auth/LoginScreen";
import { useSession } from "./auth/useSession";
import { Desktop } from "./os/Desktop";
import type { Session } from "@supabase/supabase-js";
import "./app.css";

function AppContent({ session }: { session: Session }) {
  return (
    <Desktop
      userEmail={session.user.email ?? "Utilisateur X OS"}
      accessToken={session.access_token}
    />
  );
}

function App() {
  const { session, loading, bridgeError } = useSession();

  if (loading) {
    return <div className="xos-app-loading">Chargement…</div>;
  }

  if (bridgeError) {
    return (
      <div className="xos-app-error">
        <p>Impossible de préparer l'accès au CRM.</p>
        <button type="button" onClick={() => window.location.reload()}>
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
