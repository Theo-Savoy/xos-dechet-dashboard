// @vitest-environment jsdom

import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { WindowManager } from "./WindowManager";
import type { AppWindow } from "./windowState";

const { renderCounts, components } = vi.hoisted(() => {
  const renderCounts: Record<string, number> = {};
  const components: Record<string, (props: { params?: Record<string, string> }) => ReactElement> = {};
  return { renderCounts, components };
});

vi.mock("./registry", () => ({
  getAppManifest: (appId: string) => {
    components[appId] ??= (props: { params?: Record<string, string> }) => {
      renderCounts[appId] = (renderCounts[appId] ?? 0) + 1;
      return <span>{`${appId}:${JSON.stringify(props.params ?? {})}`}</span>;
    };
    return { id: appId, title: appId, component: components[appId] };
  },
}));

function makeWindow(overrides: Partial<AppWindow>): AppWindow {
  return {
    appId: "insights",
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    zIndex: 1,
    minimized: false,
    maximized: false,
    ...overrides,
  };
}

describe("WindowManager memoization", () => {
  it("only re-renders the window whose props actually changed", () => {
    const dispatch = vi.fn();
    const first = makeWindow({ appId: "insights", zIndex: 1 });
    const second = makeWindow({ appId: "notes", zIndex: 2 });

    const { rerender } = render(
      <WindowManager windows={[first, second]} dispatch={dispatch} />,
    );

    expect(renderCounts.insights).toBe(1);
    expect(renderCounts.notes).toBe(1);

    // Simulate a "focus" action: reducer replaces only the focused window's
    // object, unaffected windows keep their exact reference.
    const focusedFirst = { ...first, zIndex: 3 };
    rerender(
      <WindowManager windows={[focusedFirst, second]} dispatch={dispatch} />,
    );

    expect(renderCounts.insights).toBe(2);
    expect(renderCounts.notes).toBe(1);
  });
});
