// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Desktop } from "./Desktop";

// Polyfill ResizeObserver (required by cmdk / Radix Dialog in jsdom)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock supabase — Launcher no longer imports it, but the import chain may
// pull in supabase.ts which throws if env vars are missing.
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

describe("Desktop", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });
  afterEach(cleanup);

  it("opens two dock applications in simultaneous windows", async () => {
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    await user.click(screen.getByRole("button", { name: "Ouvrir Aperçu commercial" }));
    await user.click(screen.getByRole("button", { name: "Ouvrir Notes d’équipe" }));

    expect(await screen.findByRole("dialog", { name: "Aperçu commercial" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Notes d’équipe" })).toBeTruthy();
  });

  it("minimizes a window and restores it from the dock", async () => {
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    const dockButton = screen.getByRole("button", { name: "Ouvrir Notes d’équipe" });
    await user.click(dockButton);
    await user.click(await screen.findByRole("button", { name: "Réduire Notes d’équipe" }));
    expect(screen.getByRole("dialog", { name: "Notes d’équipe" }).closest(".xos-rnd-window")?.className).toContain("xos-rnd-window--minimized");

    await user.click(screen.getByRole("button", { name: "Restaurer Notes d’équipe" }));
    expect(screen.getByRole("dialog", { name: "Notes d’équipe" }).closest(".xos-rnd-window")?.className).not.toContain("xos-rnd-window--minimized");
  });

  it("sets inert on minimized window dialog and removes inert after restore", async () => {
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    await user.click(screen.getByRole("button", { name: /Ouvrir Notes d/ }));
    const dialog = await screen.findByRole("dialog", { name: /Notes d/ });

    // Minimize
    await user.click(screen.getByRole("button", { name: /Réduire Notes d/ }));
    const winSection = dialog.closest(".xos-window");
    expect(winSection).toBeTruthy();
    expect(winSection!.hasAttribute("inert")).toBe(true);

    // Restore from dock
    await user.click(screen.getByRole("button", { name: /Restaurer Notes d/ }));
    expect(winSection!.hasAttribute("inert")).toBe(false);
  });

  it("toggles maximize and closes a window with its traffic-light controls", async () => {
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    await user.click(screen.getByRole("button", { name: "Ouvrir Aperçu commercial" }));
    await user.click(await screen.findByRole("button", { name: "Agrandir Aperçu commercial" }));
    expect(screen.getByRole("button", { name: "Restaurer Aperçu commercial" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Fermer Aperçu commercial" }));
    expect(screen.queryByRole("dialog", { name: "Aperçu commercial" })).toBeNull();
  });
});
