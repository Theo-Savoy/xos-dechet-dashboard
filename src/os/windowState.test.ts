import { describe, expect, it } from "vitest";
import {
  createWindowState,
  hydrateWindowState,
  serializeWindowState,
  windowReducer,
} from "./windowState";

const defaultSize = { w: 720, h: 480 };

describe("windowReducer", () => {
  it("opens two applications with independent bounds and increasing focus", () => {
    const first = windowReducer(createWindowState(), {
      type: "open",
      appId: "insights",
      defaultSize,
    });
    const second = windowReducer(first, {
      type: "open",
      appId: "notes",
      defaultSize: { w: 560, h: 420 },
    });

    expect(second.windows).toHaveLength(2);
    expect(second.windows[0]).toMatchObject({ appId: "insights", w: 720, h: 480 });
    expect(second.windows[1]).toMatchObject({ appId: "notes", w: 560, h: 420 });
    expect(second.windows[1].zIndex).toBeGreaterThan(second.windows[0].zIndex);
  });

  it("restores and focuses an already-open minimized application", () => {
    const opened = windowReducer(createWindowState(), {
      type: "open",
      appId: "insights",
      defaultSize,
    });
    const minimized = windowReducer(opened, { type: "minimize", appId: "insights" });
    const restored = windowReducer(minimized, {
      type: "open",
      appId: "insights",
      defaultSize,
    });

    expect(restored.windows).toHaveLength(1);
    expect(restored.windows[0].minimized).toBe(false);
    expect(restored.windows[0].zIndex).toBe(restored.nextZ - 1);
  });

  it("focuses a background window above the others", () => {
    const first = windowReducer(createWindowState(), {
      type: "open",
      appId: "insights",
      defaultSize,
    });
    const second = windowReducer(first, {
      type: "open",
      appId: "notes",
      defaultSize,
    });
    const focused = windowReducer(second, { type: "focus", appId: "insights" });

    const insights = focused.windows.find((window) => window.appId === "insights");
    const notes = focused.windows.find((window) => window.appId === "notes");
    expect(insights?.zIndex).toBeGreaterThan(notes?.zIndex ?? 0);
  });

  it("keeps normal bounds while maximizing and restores them on toggle", () => {
    const opened = windowReducer(createWindowState(), {
      type: "open",
      appId: "insights",
      defaultSize,
    });
    const moved = windowReducer(opened, {
      type: "setBounds",
      appId: "insights",
      bounds: { x: 140, y: 90, w: 810, h: 530 },
    });
    const maximized = windowReducer(moved, { type: "toggleMaximize", appId: "insights" });
    const restored = windowReducer(maximized, { type: "toggleMaximize", appId: "insights" });

    expect(maximized.windows[0]).toMatchObject({
      maximized: true,
      x: 140,
      y: 90,
      w: 810,
      h: 530,
    });
    expect(restored.windows[0]).toMatchObject({
      maximized: false,
      x: 140,
      y: 90,
      w: 810,
      h: 530,
    });
  });

  it("closes only the selected application", () => {
    const first = windowReducer(createWindowState(), {
      type: "open",
      appId: "insights",
      defaultSize,
    });
    const second = windowReducer(first, {
      type: "open",
      appId: "notes",
      defaultSize,
    });

    const closed = windowReducer(second, { type: "close", appId: "notes" });
    expect(closed.windows.map((window) => window.appId)).toEqual(["insights"]);
  });
});

describe("window persistence", () => {
  it("round-trips valid open windows and ignores apps no longer registered", () => {
    const state = {
      windows: [
        {
          appId: "insights",
          x: 32,
          y: 48,
          w: 720,
          h: 480,
          zIndex: 4,
          minimized: true,
          maximized: false,
        },
        {
          appId: "removed-app",
          x: 0,
          y: 0,
          w: 400,
          h: 300,
          zIndex: 2,
          minimized: false,
          maximized: false,
        },
      ],
      nextZ: 5,
    };

    const hydrated = hydrateWindowState(serializeWindowState(state), ["insights", "notes"]);
    expect(hydrated).toEqual({ windows: [state.windows[0]], nextZ: 5 });
  });

  it("falls back to an empty state when persisted JSON is malformed", () => {
    expect(hydrateWindowState("not-json", ["insights"])).toEqual(createWindowState());
  });
});
