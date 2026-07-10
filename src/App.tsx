import { LoginScreen } from "./lib/LoginScreen";
import { useSession } from "./lib/useSession";
import type { Session } from "@supabase/supabase-js";

function AppContent({ session }: { session: Session }) {
  return (
    <div>
      <p>Connecté en tant que : {session.user.email}</p>
    </div>
  );
}

function App() {
  const { session, loading } = useSession();

  if (loading) {
    return <div style={{ color: "#e6e6e6", padding: 40 }}>Chargement…</div>;
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <AppContent session={session} />;
}

export default App;
