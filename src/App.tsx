import { useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { useSession } from "./auth/useSession";
import { BootScreen } from "./components/BootScreen";
import { Desktop } from "./os/Desktop";
import "./app.css";
import "./components/boot.css";

const BOOT_HOLD_MS = 520;
const BOOT_EXIT_MS = 820;

function App() {
  const { session, loading, bridgeError } = useSession();
  const [revealDesktop, setRevealDesktop] = useState(false);
  const [hideBoot, setHideBoot] = useState(false);

  useEffect(() => {
    if (loading || !session) {
      setRevealDesktop(false);
      setHideBoot(false);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setRevealDesktop(true);
      setHideBoot(true);
      return;
    }

    const revealTimer = window.setTimeout(() => setRevealDesktop(true), BOOT_HOLD_MS);
    const hideTimer = window.setTimeout(
      () => setHideBoot(true),
      BOOT_HOLD_MS + BOOT_EXIT_MS,
    );

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(hideTimer);
    };
  }, [loading, session]);

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
      <div className={`xos-desktop-stage ${revealDesktop ? "xos-desktop-stage--in" : ""}`}>
        <Desktop
          userEmail={session.user.email ?? "Utilisateur X OS"}
          accessToken={session.access_token}
        />
      </div>
    </div>
  );
}

export default App;
