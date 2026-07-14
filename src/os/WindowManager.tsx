import { Suspense, memo, useCallback, type Dispatch } from "react";
import { Rnd, type RndDragCallback, type RndResizeCallback } from "react-rnd";
import { WindowBootScreen } from "../components/WindowBootScreen";
import { getAppManifest } from "./registry";
import type { AppWindow, WindowAction } from "./windowState";

type WindowManagerProps = {
  windows: AppWindow[];
  dispatch: Dispatch<WindowAction>;
};

type WindowFrameProps = {
  window: AppWindow;
  dispatch: Dispatch<WindowAction>;
};

export const WindowFrame = memo(function WindowFrame({
  window,
  dispatch,
}: WindowFrameProps) {
  const appId = window.appId;

  const handleParamsChange = useCallback(
    (params?: Record<string, string>) => {
      dispatch({ type: "setParams", appId, params });
    },
    [dispatch, appId],
  );

  const handleDragStop: RndDragCallback = useCallback(
    (_, data) => {
      dispatch({
        type: "setBounds",
        appId,
        bounds: { x: data.x, y: data.y, w: window.w, h: window.h },
      });
    },
    [dispatch, appId, window.w, window.h],
  );

  const handleResizeStop: RndResizeCallback = useCallback(
    (_, __, element, ___, nextPosition) => {
      dispatch({
        type: "setBounds",
        appId,
        bounds: {
          x: nextPosition.x,
          y: nextPosition.y,
          w: element.offsetWidth,
          h: element.offsetHeight,
        },
      });
    },
    [dispatch, appId],
  );

  const handleFocus = useCallback(() => {
    dispatch({ type: "focus", appId });
  }, [dispatch, appId]);

  const handleClose = useCallback(() => {
    dispatch({ type: "close", appId });
  }, [dispatch, appId]);

  const handleMinimize = useCallback(() => {
    dispatch({ type: "minimize", appId });
  }, [dispatch, appId]);

  const handleToggleMaximize = useCallback(() => {
    dispatch({ type: "toggleMaximize", appId });
  }, [dispatch, appId]);

  const app = getAppManifest(appId);
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
      minHeight={320}
      minWidth={420}
      onDragStop={handleDragStop}
      onMouseDown={handleFocus}
      onResizeStop={handleResizeStop}
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
              onClick={handleClose}
              type="button"
              aria-label={`Fermer ${app.title}`}
            />
            <button
              className="xos-window__control xos-window__control--minimize"
              onClick={handleMinimize}
              type="button"
              aria-label={`Réduire ${app.title}`}
            />
            <button
              className="xos-window__control xos-window__control--maximize"
              onClick={handleToggleMaximize}
              type="button"
              aria-label={`${window.maximized ? "Restaurer" : "Agrandir"} ${app.title}`}
            />
          </div>
          <span className="xos-window__title">{app.title}</span>
          <span className="xos-window__spacer" aria-hidden="true" />
        </header>
        <div className="xos-window__content">
          <Suspense fallback={<WindowBootScreen label="Ouverture…" />}>
            <AppComponent
              params={window.params}
              onParamsChange={handleParamsChange}
            />
          </Suspense>
        </div>
      </section>
    </Rnd>
  );
});

export function WindowManager({ windows, dispatch }: WindowManagerProps) {
  return (
    <div className="xos-window-layer">
      {windows.map((window) => (
        <WindowFrame key={window.appId} window={window} dispatch={dispatch} />
      ))}
    </div>
  );
}
