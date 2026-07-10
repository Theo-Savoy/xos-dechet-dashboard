import { Suspense, type Dispatch } from "react";
import { Rnd } from "react-rnd";
import { getAppManifest } from "./registry";
import type { AppWindow, WindowAction } from "./windowState";

type WindowManagerProps = {
  windows: AppWindow[];
  dispatch: Dispatch<WindowAction>;
};

export function WindowManager({ windows, dispatch }: WindowManagerProps) {
  return (
    <div className="xos-window-layer">
      {windows.map((window) => {
        const app = getAppManifest(window.appId);
        if (!app) return null;

        const AppComponent = app.component;
        const position = { x: window.x, y: window.y };
        const size = { width: window.w, height: window.h };

        return (
          <Rnd
            bounds="parent"
            cancel=".xos-window__controls"
            className={`xos-rnd-window ${window.maximized ? "xos-rnd-window--maximized" : ""} ${window.minimized ? "xos-rnd-window--minimized" : ""}`}
            disableDragging={window.maximized || window.minimized}
            dragHandleClassName="xos-window__titlebar"
            enableResizing={!window.maximized && !window.minimized}
            key={window.appId}
            minHeight={320}
            minWidth={420}
            onDragStop={(_, data) =>
              dispatch({
                type: "setBounds",
                appId: window.appId,
                bounds: {
                  x: data.x,
                  y: data.y,
                  w: window.w,
                  h: window.h,
                },
              })
            }
            onMouseDown={() => dispatch({ type: "focus", appId: window.appId })}
            onResizeStop={(_, __, element, ___, nextPosition) =>
              dispatch({
                type: "setBounds",
                appId: window.appId,
                bounds: {
                  x: nextPosition.x,
                  y: nextPosition.y,
                  w: element.offsetWidth,
                  h: element.offsetHeight,
                },
              })
            }
            position={position}
            size={size}
            style={{ zIndex: window.zIndex }}
          >
            <section
              className="xos-window"
              role="dialog"
              aria-label={app.title}
              inert={window.minimized ? true : undefined}
            >
              <header className="xos-window__titlebar">
                <div className="xos-window__controls">
                  <button
                    className="xos-window__control xos-window__control--close"
                    onClick={() => dispatch({ type: "close", appId: window.appId })}
                    type="button"
                    aria-label={`Fermer ${app.title}`}
                  />
                  <button
                    className="xos-window__control xos-window__control--minimize"
                    onClick={() => dispatch({ type: "minimize", appId: window.appId })}
                    type="button"
                    aria-label={`Réduire ${app.title}`}
                  />
                  <button
                    className="xos-window__control xos-window__control--maximize"
                    onClick={() =>
                      dispatch({ type: "toggleMaximize", appId: window.appId })
                    }
                    type="button"
                    aria-label={`${window.maximized ? "Restaurer" : "Agrandir"} ${app.title}`}
                  />
                </div>
                <span className="xos-window__title">{app.title}</span>
                <span className="xos-window__spacer" aria-hidden="true" />
              </header>
              <div className="xos-window__content">
                <Suspense fallback={<div className="xos-window__loading">Ouverture…</div>}>
                  <AppComponent params={window.params} />
                </Suspense>
              </div>
            </section>
          </Rnd>
        );
      })}
    </div>
  );
}
