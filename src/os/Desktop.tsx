import { useEffect, useReducer } from "react";
import logoXos from "../assets/logo-xos.png";
import { Dock } from "./Dock";
import { appRegistry, type AppManifest } from "./registry";
import { WindowManager } from "./WindowManager";
import {
  hydrateWindowState,
  serializeWindowState,
  windowReducer,
} from "./windowState";
import { Launcher } from "./Launcher";
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
        <span className="xos-menubar__session" title={userEmail}>
          <span className="xos-menubar__status" aria-hidden="true" />
          {userEmail}
        </span>
      </header>

      <WindowManager windows={state.windows} dispatch={dispatch} />
      <Dock apps={appRegistry} windows={state.windows} onOpen={openApp} />
      <Launcher accessToken={accessToken} onOpenApp={openApp} />
    </main>
  );
}
