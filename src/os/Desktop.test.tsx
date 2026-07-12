// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Desktop } from "./Desktop";
import { startSalesforceLink } from "./salesforceLink";

// Polyfill ResizeObserver (required by cmdk / Radix Dialog in jsdom)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock supabase — Launcher no longer imports it, but the import chain may
// pull in supabase.ts which throws if env vars are missing.
const { shortcutRows, shortcutDeleteEq } = vi.hoisted(() => ({
  shortcutRows: [] as { id: number; app_id: string; params: Record<string, string>; label: string }[],
  shortcutDeleteEq: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) =>
      table === "desktop_shortcuts"
        ? {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: shortcutRows, error: null }),
            }),
            delete: vi.fn().mockReturnValue({ eq: shortcutDeleteEq }),
          }
        : {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "admin", sf_auth_connected_at: "2026-07-01T00:00:00Z" },
                  error: null,
                }),
              }),
            }),
          },
    ),
  },
}));

vi.mock("../apps/calls/api", () => ({
  prefetchComboHub: vi.fn(),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) {
          return new Response(
            JSON.stringify({
              salesforce: { connected: true, orgConnected: true, userLinked: true },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    shortcutRows.length = 0;
    shortcutDeleteEq.mockClear();
  });

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

  it("renders a desktop shortcut and opens its app on click", async () => {
    shortcutRows.push({ id: 1, app_id: "notes-demo", params: { note: "42" }, label: "Mes notes" });
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    await user.click(await screen.findByRole("button", { name: "Mes notes" }));
    expect(await screen.findByRole("dialog", { name: "Notes d’équipe" })).toBeTruthy();
  });

  it("removes a desktop shortcut", async () => {
    shortcutRows.push({ id: 7, app_id: "notes-demo", params: {}, label: "Mes notes" });
    const user = userEvent.setup();
    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    await user.click(
      await screen.findByRole("button", { name: "Supprimer le raccourci Mes notes" }),
    );
    expect(shortcutDeleteEq).toHaveBeenCalledWith("id", 7);
  });

  it("starts the authenticated Salesforce account-link flow", async () => {
    const navigate = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authorization_url: "https://login.salesforce.test/authorize" }),
    });

    await startSalesforceLink("jwt-token", navigate, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/auth?flow=salesforce-link", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-token" },
    });
    expect(navigate).toHaveBeenCalledWith("https://login.salesforce.test/authorize");
  });

  it("shows a reconnect CTA when Salesforce API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/status")) {
          return new Response(
            JSON.stringify({
              salesforce: { connected: false, orgConnected: false, userLinked: true },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    render(<Desktop userEmail="theo@xos-learning.fr" accessToken="test-token" />);

    expect(await screen.findByText("SF à reconnecter")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnecter Salesforce" })).toBeTruthy();
  });
});
