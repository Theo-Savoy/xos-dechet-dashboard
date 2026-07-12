export type WindowBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AppWindow = WindowBounds & {
  appId: string;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  params?: Record<string, string>;
};

export type WindowManagerState = {
  windows: AppWindow[];
  nextZ: number;
};

export type WindowAction =
  | { type: "open"; appId: string; defaultSize: { w: number; h: number }; params?: Record<string, string> }
  | { type: "close"; appId: string }
  | { type: "minimize"; appId: string }
  | { type: "focus"; appId: string }
  | { type: "toggleMaximize"; appId: string }
  | { type: "setBounds"; appId: string; bounds: WindowBounds }
  | { type: "setParams"; appId: string; params?: Record<string, string> };

export function createWindowState(): WindowManagerState {
  return { windows: [], nextZ: 1 };
}

function updateWindow(
  state: WindowManagerState,
  appId: string,
  update: (window: AppWindow) => AppWindow,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((window) =>
      window.appId === appId ? update(window) : window,
    ),
  };
}

function focusWindow(state: WindowManagerState, appId: string): WindowManagerState {
  if (!state.windows.some((window) => window.appId === appId)) return state;

  const focused = updateWindow(state, appId, (window) => ({
    ...window,
    zIndex: state.nextZ,
  }));
  return { ...focused, nextZ: state.nextZ + 1 };
}

function paramsEqual(
  left?: Record<string, string>,
  right?: Record<string, string>,
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

export function windowReducer(
  state: WindowManagerState,
  action: WindowAction,
): WindowManagerState {
  switch (action.type) {
    case "open": {
      const existing = state.windows.find((window) => window.appId === action.appId);
      if (existing) {
        const restored = updateWindow(state, action.appId, (window) => ({
          ...window,
          minimized: false,
          params: action.params ?? window.params,
        }));
        return focusWindow(restored, action.appId);
      }

      const offset = state.windows.length * 36;
      return {
        windows: [
          ...state.windows,
          {
            appId: action.appId,
            x: 72 + offset,
            y: 64 + offset,
            ...action.defaultSize,
            zIndex: state.nextZ,
            minimized: false,
            maximized: false,
            params: action.params,
          },
        ],
        nextZ: state.nextZ + 1,
      };
    }
    case "close":
      return {
        ...state,
        windows: state.windows.filter((window) => window.appId !== action.appId),
      };
    case "minimize":
      return updateWindow(state, action.appId, (window) => ({
        ...window,
        minimized: true,
      }));
    case "focus":
      return focusWindow(state, action.appId);
    case "toggleMaximize": {
      const toggled = updateWindow(state, action.appId, (window) => ({
        ...window,
        minimized: false,
        maximized: !window.maximized,
      }));
      return focusWindow(toggled, action.appId);
    }
    case "setBounds": {
      const { x, y, w, h } = action.bounds;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w <= 0 ||
        h <= 0
      ) {
        return state;
      }
      return updateWindow(state, action.appId, (window) => ({
        ...window,
        x,
        y,
        w,
        h,
      }));
    }
    case "setParams": {
      const existing = state.windows.find((window) => window.appId === action.appId);
      if (!existing || paramsEqual(existing.params, action.params)) return state;
      return updateWindow(state, action.appId, (window) => ({
        ...window,
        params: action.params,
      }));
    }
  }
}

export function serializeWindowState(state: WindowManagerState): string {
  return JSON.stringify(state);
}

function isPersistedWindow(value: unknown): value is AppWindow {
  if (!value || typeof value !== "object") return false;
  const window = value as Record<string, unknown>;
  return (
    typeof window.appId === "string" &&
    ["x", "y", "w", "h", "zIndex"].every(
      (key) => typeof window[key] === "number" && Number.isFinite(window[key]),
    ) &&
    (window.w as number) > 0 &&
    (window.h as number) > 0 &&
    typeof window.minimized === "boolean" &&
    typeof window.maximized === "boolean"
  );
}

export function hydrateWindowState(
  serialized: string | null,
  registeredAppIds: readonly string[],
): WindowManagerState {
  if (!serialized) return createWindowState();

  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    if (!Array.isArray(parsed.windows)) return createWindowState();

    const allowedIds = new Set(registeredAppIds);
    const seenIds = new Set<string>();
    const windows = parsed.windows.filter((window): window is AppWindow => {
      if (!isPersistedWindow(window)) return false;
      if (!allowedIds.has(window.appId) || seenIds.has(window.appId)) return false;
      seenIds.add(window.appId);
      return true;
    });
    const minimumNextZ = Math.max(0, ...windows.map((window) => window.zIndex)) + 1;
    const persistedNextZ =
      typeof parsed.nextZ === "number" && Number.isFinite(parsed.nextZ)
        ? parsed.nextZ
        : minimumNextZ;

    return { windows, nextZ: Math.max(minimumNextZ, persistedNextZ) };
  } catch {
    return createWindowState();
  }
}
