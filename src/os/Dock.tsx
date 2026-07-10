import type { AppWindow } from "./windowState";
import type { AppManifest } from "./registry";

type DockProps = {
  apps: AppManifest[];
  windows: AppWindow[];
  onOpen: (app: AppManifest) => void;
};

export function Dock({ apps, windows, onOpen }: DockProps) {
  return (
    <nav className="xos-dock" aria-label="Applications X OS">
      {apps.map((app) => {
        const appWindow = windows.find((window) => window.appId === app.id);
        const action = appWindow?.minimized ? "Restaurer" : "Ouvrir";

        return (
          <button
            className="xos-dock__item"
            data-open={Boolean(appWindow)}
            key={app.id}
            onClick={() => onOpen(app)}
            type="button"
            aria-label={`${action} ${app.title}`}
          >
            <span className="xos-dock__tooltip" aria-hidden="true">
              {app.title}
            </span>
            <span className="xos-dock__icon" aria-hidden="true">
              {app.icon}
            </span>
            <span className="xos-dock__indicator" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
