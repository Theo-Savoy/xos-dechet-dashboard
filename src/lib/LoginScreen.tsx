import { useState } from "react";
import { supabase } from "./supabase";
import "./login.css";

const ALLOWED_DOMAIN = "xos-learning.fr";

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        queryParams: {
          hd: ALLOWED_DOMAIN,
        },
      },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>XOS</h1>
        <p>Connectez-vous avec votre compte Google</p>
        <button onClick={handleLogin} disabled={loading} type="button">
          {loading ? "Connexion..." : "Se connecter avec Google"}
        </button>
        {error && <p className="login-error">{error}</p>}
        <p className="login-domain">
          Comptes <strong>@{ALLOWED_DOMAIN}</strong> uniquement
        </p>
      </div>
    </div>
  );
}
