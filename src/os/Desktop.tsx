import { useEffect, useReducer, useState } from "react";
import logoXos from "../assets/logo-xos.png";
import { supabase } from "../lib/supabase";
import { Dock } from "./Dock";
import { appRegistry, type AppManifest, type AppRole } from "./registry";
import { WindowManager } from "./WindowManager";
import {
  hydrateWindowState,
  serializeWindowState,
  windowReducer,
} from "./windowState";
import { Launcher } from "./Launcher";
import { startSalesforceLink } from "./salesforceLink";
import "./theme.css";
import "./desktop.css";

const STORAGE_KEY = "xos.window-manager.v1";

type DesktopProps = {
  userEmail: string;
  accessToken: string;
};

export function Desktop({ userEmail, accessToken }: DesktopProps) {
  const [state, dispatch] = useReducer(windowReducer, undefined, () =>
    hydrateWindowState(
      typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY),
      appRegistry.map((app) => app.id),
    ),
  );
  const [role, setRole] = useState<AppRole>("commercial");
  const [sfLinked, setSfLinked] = useState(false);
  const [sfLinking, setSfLinking] = useState(false);
  const [sfLinkChecked, setSfLinkChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("role")
      .eq("email", userEmail)
      .maybeSingle()
      .then(({ data }) => {
        const value = data?.role;
        if (!cancelled && (value === "admin" || value === "manager" || value === "commercial")) {
          setRole(value);
        }
      });
    void supabase
      .from("profiles")
      .select("sf_auth_connected_at")
      .eq("email", userEmail)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          if (data && "sf_auth_connected_at" in data) {
            setSfLinked(Boolean(data.sf_auth_connected_at));
          }
          setSfLinkChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const visibleApps = appRegistry.filter((app) => !app.roles || app.roles.includes(role));

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, serializeWindowState(state));
  }, [state]);

  const openApp = (app: AppManifest, params?: Record<string, string>) => {
    dispatch({
      type: "open",
      appId: app.id,
      defaultSize: app.defaultSize,
      params,
    });
  };

  const hasMaximizedWindow = state.windows.some((w) => w.maximized && !w.minimized);

  return (
    <main className={`xos-desktop ${hasMaximizedWindow ? "xos-desktop--has-maximized" : ""}`}>
      <div className="xos-wallpaper" aria-hidden="true" />
      <header className="xos-menubar">
        <span className="xos-logo">
          <img
            src={logoXos}
            alt="XOS"
            className="xos-logo__img"
            decoding="async"
            width={880}
            height={334}
          />
        </span>
        <div className="xos-menubar__session-group">
          <span className="xos-menubar__session" title={userEmail}>
            <span className="xos-menubar__status" aria-hidden="true" />
            {userEmail}
          </span>
          <span className={`xos-menubar__sf-status ${sfLinked ? 'xos-menubar__sf-status--linked' : 'xos-menubar__sf-status--unlinked'}`}>
            <svg className="xos-menubar__sf-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
            </svg>
            <span className="xos-menubar__sf-text">{sfLinked ? "Salesforce connecté" : "Salesforce non lié"}</span>
          </span>
        </div>
        <button
          type="button"
          className="xos-menubar__logout"
          onClick={() => void supabase.auth.signOut()}
        >
          Déconnexion
        </button>
      </header>

      <WindowManager windows={state.windows} dispatch={dispatch} />
      <Dock apps={visibleApps} windows={state.windows} onOpen={openApp} />
      <Launcher accessToken={accessToken} onOpenApp={openApp} apps={visibleApps} />

      {!sfLinked && sfLinkChecked && !dismissed && (
        <div className="xos-notification" role="alert">
          <div className="xos-notification__header">
            <div className="xos-notification__icon">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
              </svg>
            </div>
            <span className="xos-notification__appname">Salesforce</span>
            <span className="xos-notification__time">maintenant</span>
            <button
              type="button"
              className="xos-notification__close"
              aria-label="Fermer"
              onClick={() => setDismissed(true)}
            >
              &times;
            </button>
          </div>
          <div className="xos-notification__body">
            <h3 className="xos-notification__title">Liaison requise</h3>
            <p className="xos-notification__message">
              Votre compte Salesforce n'est pas lié. Connectez-le pour synchroniser vos appels.
            </p>
          </div>
          <div className="xos-notification__actions">
            <button
              type="button"
              className="xos-btn xos-btn--primary"
              disabled={sfLinking}
              onClick={() => {
                setSfLinking(true);
                void startSalesforceLink(accessToken).catch(() => setSfLinking(false));
              }}
            >
              {sfLinking ? "Connexion…" : "Lier Salesforce"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
