import { useEffect, useRef, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { useSession } from "./auth/useSession";
import { BootScreen } from "./components/BootScreen";
import { Desktop } from "./os/Desktop";
import "./app.css";
import "./components/boot.css";

const BOOT_HOLD_MS = 520;
const BOOT_EXIT_MS = 820;

function sessionKey(session: { user: { id?: string; email?: string | null } } | null) {
  if (!session) return null;
  return session.user.id ?? session.user.email ?? "authenticated";
}

function App() {
  const { session, loading, bridgeError } = useSession();
  const [revealDesktop, setRevealDesktop] = useState(false);
  const [hideBoot, setHideBoot] = useState(false);
  const bootedFor = useRef<string | null>(null);
  const key = sessionKey(session);

  useEffect(() => {
    if (loading || !key) {
      bootedFor.current = null;
      setRevealDesktop(false);
      setHideBoot(false);
      return;
    }

    // Same authenticated user: keep desktop revealed (avoid blank stage on
    // token refresh / session object identity churn).
    if (bootedFor.current === key) {
      setRevealDesktop(true);
      setHideBoot(true);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      bootedFor.current = key;
      setRevealDesktop(true);
      setHideBoot(true);
      return;
    }

    const revealTimer = window.setTimeout(() => setRevealDesktop(true), BOOT_HOLD_MS);
    const hideTimer = window.setTimeout(() => {
      bootedFor.current = key;
      setHideBoot(true);
    }, BOOT_HOLD_MS + BOOT_EXIT_MS);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(hideTimer);
    };
  }, [loading, key]);

  if (loading) {
    return <BootScreen phase="loading" />;
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

  return (
    <div className="xos-boot-container">
      {!hideBoot && <BootScreen phase={revealDesktop ? "exit" : "ready"} />}
      <div className="xos-desktop-stage">
        <Desktop
          userEmail={session.user.email ?? "Utilisateur X OS"}
          accessToken={session.access_token}
        />
      </div>
    </div>
  );
}

export default App;
