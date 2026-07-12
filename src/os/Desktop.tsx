import { useCallback, useEffect, useReducer, useState } from "react";
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
import { ControlCenter } from "./ControlCenter";
import { Launcher } from "./Launcher";
import {
  fetchShortcuts,
  removeShortcut,
  SHORTCUTS_CHANGED_EVENT,
  type DesktopShortcut,
} from "./shortcuts";
import { startSalesforceLink } from "./salesforceLink";
// Side-effect import : déclenche les imports dynamiques qui cachent les
// chunks lazy des apps. Voir preload.ts pour la liste complète.
import "./preload";
import { prefetchComboHub } from "../apps/calls/api";
import "./theme.css";
import "./desktop.css";
import "./controlCenter.css";

const STORAGE_KEY = "xos.window-manager.v1";

type SfStatusKind = "checking" | "ok" | "needs_link" | "needs_reconnect";

type DesktopProps = {
  userEmail: string;
  accessToken: string;
};

function sfStatusLabel(kind: SfStatusKind): string {
  switch (kind) {
    case "ok":
      return "Salesforce connecté";
    case "needs_reconnect":
      return "SF à reconnecter";
    case "needs_link":
      return "SF non lié";
    default:
      return "Salesforce…";
  }
}

function sfStatusClass(kind: SfStatusKind): string {
  switch (kind) {
    case "ok":
      return "xos-menubar__sf-status--linked";
    case "needs_reconnect":
      return "xos-menubar__sf-status--degraded";
    case "needs_link":
      return "xos-menubar__sf-status--unlinked";
    default:
      return "xos-menubar__sf-status--checking";
  }
}

export function Desktop({ userEmail, accessToken }: DesktopProps) {
  const [state, dispatch] = useReducer(windowReducer, undefined, () =>
    hydrateWindowState(
      typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY),
      appRegistry.map((app) => app.id),
    ),
  );
  const [role, setRole] = useState<AppRole>("commercial");
  const [sfStatus, setSfStatus] = useState<SfStatusKind>("checking");
  const [sfLinking, setSfLinking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [shortcuts, setShortcuts] = useState<DesktopShortcut[]>([]);

  useEffect(() => {
    if (!accessToken) return;
    prefetchComboHub(accessToken);
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchShortcuts()
        .then((rows) => {
          if (!cancelled) setShortcuts(rows);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SHORTCUTS_CHANGED_EVENT, load);
    };
  }, []);

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
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const refreshSfStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch("/api/status", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        setSfStatus("needs_reconnect");
        return;
      }
      const body = (await res.json()) as {
        salesforce?: { connected?: boolean; userLinked?: boolean };
      };
      const connected = body.salesforce?.connected === true;
      const userLinked = body.salesforce?.userLinked === true;
      if (!userLinked) setSfStatus("needs_link");
      else if (!connected) setSfStatus("needs_reconnect");
      else setSfStatus("ok");
    } catch {
      setSfStatus("needs_reconnect");
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshSfStatus();
  }, [refreshSfStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sf_link") !== "success") return;
    setDismissed(false);
    void refreshSfStatus();
    params.delete("sf_link");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [refreshSfStatus]);

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

  const startLink = () => {
    setSfLinking(true);
    void startSalesforceLink(accessToken).catch(() => setSfLinking(false));
  };

  const needsSfAction = sfStatus === "needs_link" || sfStatus === "needs_reconnect";
  const showSfNotification = needsSfAction && !dismissed;
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
          <ControlCenter accessToken={accessToken} />
          <span className="xos-menubar__session" title={userEmail}>
            <span className="xos-menubar__status" aria-hidden="true" />
            {userEmail}
          </span>
          {needsSfAction ? (
            <button
              type="button"
              className={`xos-menubar__sf-status ${sfStatusClass(sfStatus)}`}
              title={
                sfStatus === "needs_link"
                  ? "Lier votre compte Salesforce"
                  : "Reconnecter Salesforce — l’API plateforme est indisponible"
              }
              disabled={sfLinking}
              onClick={startLink}
            >
              <svg className="xos-menubar__sf-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
              </svg>
              <span className="xos-menubar__sf-text">
                {sfLinking ? "Connexion…" : sfStatusLabel(sfStatus)}
              </span>
            </button>
          ) : (
            <span className={`xos-menubar__sf-status ${sfStatusClass(sfStatus)}`}>
              <svg className="xos-menubar__sf-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
              </svg>
              <span className="xos-menubar__sf-text">{sfStatusLabel(sfStatus)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="xos-menubar__logout"
          onClick={() => void supabase.auth.signOut()}
        >
          Déconnexion
        </button>
      </header>

      {shortcuts.length > 0 && (
        <nav className="xos-shortcuts" aria-label="Raccourcis du bureau">
          {shortcuts.map((shortcut) => {
            const app = visibleApps.find((a) => a.id === shortcut.app_id);
            if (!app) return null;
            return (
              <div key={shortcut.id} className="xos-shortcut">
                <button
                  type="button"
                  className="xos-shortcut__open"
                  title={shortcut.label}
                  onClick={() => openApp(app, shortcut.params)}
                >
                  <span className="xos-shortcut__icon" aria-hidden="true">
                    {app.icon}
                  </span>
                  <span className="xos-shortcut__label">{shortcut.label}</span>
                </button>
                <button
                  type="button"
                  className="xos-shortcut__remove"
                  aria-label={`Supprimer le raccourci ${shortcut.label}`}
                  onClick={() => void removeShortcut(shortcut.id).catch(() => {})}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </nav>
      )}

      <WindowManager windows={state.windows} dispatch={dispatch} />
      <Dock apps={visibleApps} windows={state.windows} onOpen={openApp} />
      <Launcher accessToken={accessToken} onOpenApp={openApp} apps={visibleApps} />

      {showSfNotification && (
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
            <h3 className="xos-notification__title">
              {sfStatus === "needs_reconnect" ? "Reconnexion requise" : "Liaison requise"}
            </h3>
            <p className="xos-notification__message">
              {sfStatus === "needs_reconnect"
                ? "Votre connexion Salesforce a expiré. Reconnectez votre compte pour continuer à utiliser Combo."
                : "Votre compte Salesforce n'est pas lié. Connectez-le pour synchroniser vos appels."}
            </p>
          </div>
          <div className="xos-notification__actions">
            <button
              type="button"
              className="xos-btn xos-btn--primary"
              disabled={sfLinking}
              onClick={startLink}
            >
              {sfLinking
                ? "Connexion…"
                : sfStatus === "needs_reconnect"
                  ? "Reconnecter Salesforce"
                  : "Lier Salesforce"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
