// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRegistry, getAppManifest } from "../../os/registry";

const mockSession = {
  user: { email: "theo@xos-learning.fr" },
  access_token: "test-token-abc",
};

vi.mock("../../auth/useSession", () => ({
  useSession: vi.fn(() => ({
    session: mockSession,
    loading: false,
    bridgeError: false,
  })),
}));

import CallManagerApp from "./CallManagerApp";

const mockSessions = {
  sessions: [
    {
      id: 1,
      name: "Prospection Lyon",
      status: "active" as const,
      created_at: "2026-07-10T10:00:00Z",
      total: 10,
      called: 3,
      skipped: 1,
      pending: 6,
    },
  ],
};

const mockStats = {
  stats: {
    calls_today: 5,
    calls_week: 20,
    sessions_active: 1,
    sessions_completed: 2,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/calls") {
        return Promise.resolve(
          new Response(JSON.stringify(mockSessions), { status: 200 }),
        );
      }
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    }),
  );
});

describe("Call Manager app manifest", () => {
  it("is registered with id 'calls'", () => {
    const manifest = getAppManifest("calls");
    expect(manifest).toBeDefined();
    expect(manifest?.id).toBe("calls");
  });

  it("has title 'Call Manager'", () => {
    const manifest = getAppManifest("calls");
    expect(manifest?.title).toBe("Call Manager");
  });

  it("has icon '☎'", () => {
    const manifest = getAppManifest("calls");
    expect(manifest?.icon).toBe("☎");
  });

  it("has defaultSize { w: 960, h: 620 }", () => {
    const manifest = getAppManifest("calls");
    expect(manifest?.defaultSize).toEqual({ w: 960, h: 620 });
  });

  it("has a unique id among all registered apps", () => {
    const ids = appRegistry.map((app) => app.id);
    expect(ids.filter((id) => id === "calls")).toHaveLength(1);
  });
});

describe("CallManagerApp component", () => {
  it("renders sessions list on load", async () => {
    render(<CallManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("Prospection Lyon")).toBeTruthy();
    });
    expect(screen.getByText("Nouvelle séance")).toBeTruthy();
  });

  it("sends Authorization Bearer header on API calls", async () => {
    render(<CallManagerApp />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/calls",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token-abc",
          }),
        }),
      );
    });
  });

  it("navigates to new session view", async () => {
    const user = userEvent.setup();
    render(<CallManagerApp />);

    await waitFor(() => {
      expect(screen.getByText("Nouvelle séance")).toBeTruthy();
    });

    await user.click(screen.getByText("Nouvelle séance"));

    expect(screen.getByText("Composer une liste")).toBeTruthy();
    expect(screen.getByText("Aperçu de la liste")).toBeTruthy();
  });
});
