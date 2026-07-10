import { useState } from "react";
import { supabase } from "./supabase";
import "./login.css";

const ALLOWED_DOMAIN = "xos-learning.fr";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidEmail = (value: string) =>
    value.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      setError("Veuillez saisir une adresse email.");
      return;
    }

    if (!isValidEmail(normalized)) {
      setError(`Seules les adresses @${ALLOWED_DOMAIN} sont autorisées.`);
      return;
    }

    setLoading(true);

    const { error: err } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>XOS</h1>
        <p>Connectez-vous avec votre email</p>

        {sent ? (
          <p className="login-success">
            Lien envoyé, vérifie ta boîte mail ✉️
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`nom@${ALLOWED_DOMAIN}`}
              disabled={loading}
              autoFocus
              className="login-email-input"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Envoi en cours..." : "Recevoir un lien de connexion"}
            </button>
          </form>
        )}

        {error && <p className="login-error">{error}</p>}
        <p className="login-domain">
          Comptes <strong>@{ALLOWED_DOMAIN}</strong> uniquement
        </p>
      </div>
    </div>
  );
}
