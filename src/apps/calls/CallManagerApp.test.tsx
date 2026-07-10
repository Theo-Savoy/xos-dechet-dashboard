// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRegistry, getAppManifest } from "../../os/registry";

const mockSession = {
  user: { id: "user-1", email: "theo@xos-learning.fr" },
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

  it("invalidates the preview and ignores an older preview response", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    let previewRequest = 0;

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/calls") {
        return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      }
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      if (url === "/api/presets") {
        return Promise.resolve(new Response(JSON.stringify({ presets: [] }), { status: 200 }));
      }
      if (url === "/api/calls-list") {
        previewRequest += 1;
        return previewRequest === 1 ? first : second;
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp />);
    await user.click(await screen.findByText("Nouvelle séance"));
    await user.click(screen.getByText("Aperçu de la liste"));
    await user.click(screen.getByLabelText("A un numéro de téléphone"));
    await user.click(screen.getByText("Aperçu de la liste"));

    resolveSecond(
      new Response(
        JSON.stringify({
          contacts: [{ contact_name: "Contact récent" }],
          dedup: [],
        }),
        { status: 200 },
      ),
    );
    await screen.findByText("Contact récent");

    resolveFirst(
      new Response(
        JSON.stringify({
          contacts: [{ contact_name: "Contact obsolète" }],
          dedup: [],
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(screen.getByText("Contact récent")).toBeTruthy());

    expect(screen.queryByText("Contact obsolète")).toBeNull();
  });

  it("keeps the last RDV contact visible until its Event is logged", async () => {
    const user = userEvent.setup();
    const pendingContact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: "001000000000001AAA",
      contact_name: "Alice Martin",
      account_name: "Acme",
      phone: "0102030405",
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };
    const calledContact = {
      ...pendingContact,
      status: "called",
      outcome: "RDV planifié",
      sf_task_id: "00T000000000001AAA",
      called_at: "2026-07-10T20:00:00Z",
    };
    const activeSession = {
      id: 1,
      name: "Dernier contact",
      status: "active",
      created_at: "2026-07-10T10:00:00Z",
    };
    const detailResponses = [
      { session: activeSession, contacts: [pendingContact] },
      { session: activeSession, contacts: [calledContact] },
      { session: activeSession, contacts: [calledContact] },
      { session: { ...activeSession, status: "completed" }, contacts: [calledContact] },
    ];
    const postedActions: string[] = [];

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      if (url === "/api/calls?session_id=1") {
        const detail = detailResponses.shift();
        return Promise.resolve(new Response(JSON.stringify(detail), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const action = JSON.parse(String(init.body)).action as string;
        postedActions.push(action);
        const response = action === "log_call" ? { ok: true, needs_event: true } : { ok: true };
        return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
      }
      if (url === "/api/calls") {
        return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);
    await screen.findByRole("heading", { name: "Dernier contact" });
    await user.selectOptions(screen.getByLabelText("Résultat"), "RDV planifié");
    await user.click(screen.getByRole("button", { name: "Logguer & suivant" }));

    await screen.findByRole("heading", { name: "RDV planifié — Alice Martin" });
    expect(postedActions).toEqual(["log_call"]);

    await user.click(screen.getByRole("button", { name: "Enregistrer le RDV & suivant" }));
    await screen.findByText("Terminée");
    expect(postedActions).toEqual(["log_call", "log_event", "complete_session"]);
  });
});
