import { useState } from "react";
import logoXos from "../assets/logo-xos.png";
import { Button } from "../components/ui";
import { supabase } from "../lib/supabase";
import "./login.css";

const ALLOWED_DOMAIN = "xos-learning.fr";

/** Provider OIDC custom Supabase (Phase 8.1) — issuer = My Domain de l'org. */
export const SALESFORCE_PROVIDER = "custom:salesforce";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: `Seules les adresses @${ALLOWED_DOMAIN} sont autorisées.`,
  oauth_denied: "Connexion Salesforce annulée.",
  sf_email_mismatch: "L'email Salesforce ne correspond pas à un compte X OS autorisé.",
  server_error: "Impossible de démarrer la connexion Salesforce. Réessayez.",
};

function authErrorFromLocation(search: string, hash = ""): string | null {
  const code = new URLSearchParams(search).get("auth_error");
  if (code) return AUTH_ERROR_MESSAGES[code] ?? "La connexion a échoué. Réessayez.";
  // Échec OAuth Supabase : error/error_description reviennent en query ou en fragment.
  const params = new URLSearchParams(search || undefined);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const description = params.get("error_description") ?? hashParams.get("error_description");
  const oauthError = params.get("error") ?? hashParams.get("error");
  if (description) return description;
  if (oauthError) return "La connexion Salesforce a échoué. Réessayez.";
  return null;
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sfLoading, setSfLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? authErrorFromLocation(window.location.search, window.location.hash)
      : null,
  );

  const isValidEmail = (value: string) =>
    value.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

  const handleSalesforceLogin = async () => {
    setError(null);
    setSfLoading(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: SALESFORCE_PROVIDER,
      options: { redirectTo: window.location.origin },
    });
    // Succès = redirection navigateur ; on ne repasse ici qu'en cas d'échec.
    if (err) {
      setError(AUTH_ERROR_MESSAGES.server_error);
      setSfLoading(false);
    }
  };

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
      <div className="login-screen__backdrop" aria-hidden="true" />
      <div className="login-screen__glow login-screen__glow--a" aria-hidden="true" />
      <div className="login-screen__glow login-screen__glow--b" aria-hidden="true" />

      <div className="login-card xos-glass-card">
        <div className="login-card__brand">
          <img
            src={logoXos}
            alt="X OS"
            className="login-card__logo"
            width={880}
            height={334}
            decoding="async"
          />
          <p className="login-card__tagline">Portail commercial</p>
        </div>

        {sent ? (
          <div className="login-card__success" role="status">
            <h2>Lien envoyé</h2>
            <p>
              Vérifiez votre boîte mail <strong>{email.trim().toLowerCase()}</strong> et
              ouvrez le lien pour accéder au bureau.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
            >
              Utiliser une autre adresse
            </Button>
          </div>
        ) : (
          <>
            <div className="login-card__primary-action">
              <Button
                type="button"
                variant="secondary"
                className="login-sf-btn"
                disabled={sfLoading}
                onClick={() => void handleSalesforceLogin()}
              >
                <SalesforceMark />
                {sfLoading ? "Redirection vers Salesforce…" : "Se connecter avec Salesforce"}
              </Button>
            </div>

            <div className="login-divider" role="separator" aria-label="ou">
              <span>ou</span>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field">
                <span>Email professionnel</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`nom@${ALLOWED_DOMAIN}`}
                  disabled={loading}
                  autoFocus
                  autoComplete="email"
                  className="login-email-input"
                />
              </label>
              <Button type="submit" disabled={loading} className="login-submit">
                {loading ? "Envoi en cours…" : "Recevoir un lien de connexion"}
              </Button>
            </form>
          </>
        )}

        {error && (
          <p className="login-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}

        <p className="login-domain">
          Comptes <strong>@{ALLOWED_DOMAIN}</strong> uniquement
        </p>
      </div>
    </div>
  );
}

function SalesforceMark() {
  return (
    <svg
      className="login-sf-btn__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M10.04 5.28c.74-.7 1.76-1.13 2.88-1.13 1.5 0 2.82.74 3.62 1.86.66-.3 1.38-.46 2.14-.46 2.86 0 5.18 2.32 5.18 5.18 0 2.86-2.32 5.18-5.18 5.18h-.1c-.66 1.5-2.16 2.54-3.9 2.54-1.02 0-1.96-.34-2.72-.92-.74.86-1.82 1.4-3.04 1.4-1.5 0-2.82-.82-3.52-2.04A4.12 4.12 0 0 1 2.14 14.1C.92 14.1 0 13.18 0 11.96c0-1.02.68-1.88 1.62-2.14A4.47 4.47 0 0 1 5.2 6.2c.9 0 1.74.28 2.44.74.66-.7 1.5-1.22 2.4-1.66z"
      />
    </svg>
  );
}
