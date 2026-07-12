// @vitest-environment jsdom

import { isValidElement } from "react";
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

// Évite de tirer lib/supabase (qui exige les env VITE_*) via os/shortcuts.
vi.mock("../../os/shortcuts", () => ({
  addShortcut: vi.fn().mockResolvedValue(undefined),
}));

import CallManagerApp from "./CallManagerApp";

const mockSessions = {
  sessions: [
    {
      id: 1,
      name: "Prospection Lyon",
      status: "active" as const,
      created_at: "2026-07-10T10:00:00Z",
      scheduled_for: "2026-07-10",
      session_type: "prospection" as const,
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
    week: {
      calls: 20,
      decroche: 10,
      argumente: 5,
      rdv: 2,
      npa: 1,
      rate_decroche: 50,
      rate_argumente: 25,
      rate_rdv_per_decroche: 20,
      rate_rdv_per_argumente: 40,
    },
    month: {
      calls: 40,
      decroche: 20,
      argumente: 10,
      rdv: 4,
      npa: 2,
      rate_decroche: 50,
      rate_argumente: 25,
      rate_rdv_per_decroche: 20,
      rate_rdv_per_argumente: 40,
    },
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

describe("Combo app manifest", () => {
  it("is registered with id 'calls'", () => {
    const manifest = getAppManifest("calls");
    expect(manifest).toBeDefined();
    expect(manifest?.id).toBe("calls");
  });

  it("has title 'Combo'", () => {
    const manifest = getAppManifest("calls");
    expect(manifest?.title).toBe("Combo");
  });

  it("exposes the CallsIcon as a React element", () => {
    const manifest = getAppManifest("calls");
    expect(isValidElement(manifest?.icon)).toBe(true);
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

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      if (url === "/api/calls?resource=presets") {
        return Promise.resolve(new Response(JSON.stringify({ presets: [] }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        previewRequest += 1;
        return previewRequest === 1 ? first : second;
      }
      if (url === "/api/calls") {
        return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp />);
    await user.click(await screen.findByText("Nouvelle séance"));
    await user.click(screen.getByText("Aperçu de la liste"));
    await user.click(screen.getByLabelText("A un numéro de mobile"));
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

  it("logs call and Event together when RDV planifié is selected", async () => {
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
      { session: { ...activeSession, status: "completed" }, contacts: [calledContact] },
    ];
    const postedActions: string[] = [];
    let contextFetches = 0;

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      if (url.startsWith("/api/calls?session_id=1&context_contact_id=")) {
        contextFetches += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: activeSession,
              contacts: [pendingContact],
              context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] },
            }),
            { status: 200 },
          ),
        );
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
    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByRole("button", { name: "RDV planifié" }));

    expect(await screen.findByRole("heading", { name: "Détails du RDV" })).toBeTruthy();
    expect(contextFetches).toBe(1);
    expect(screen.queryByRole("button", { name: "Logguer & suivant" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Logguer appel + RDV & suivant" }));
    await screen.findByText("Terminée");
    expect(postedActions).toEqual(["log_call", "log_event", "complete_session"]);
  });

  it("warns about a failed NPA sync without blocking runner progression", async () => {
    const user = userEvent.setup();
    const pendingContact = {
      id: 101, position: 0, sf_contact_id: "003000000000001AAA", sf_account_id: null,
      contact_name: "Alice Martin", account_name: "Acme", phone: "0102030405", title: null,
      linkedin_url: null, status: "pending", outcome: null, comments: null,
      sf_task_id: null, sf_event_id: null, called_at: null,
    };
    const activeSession = { id: 1, name: "NPA", status: "active", created_at: "2026-07-10T10:00:00Z" };
    let sessionFetches = 0;

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?session_id=1") {
        sessionFetches += 1;
        return Promise.resolve(new Response(JSON.stringify({
          session: sessionFetches === 1 ? activeSession : { ...activeSession, status: "completed" },
          contacts: sessionFetches === 1 ? [pendingContact] : [{ ...pendingContact, status: "called" }],
        }), { status: 200 }));
      }
      if (url.startsWith("/api/calls?session_id=1&context_contact_id=")) {
        return Promise.resolve(new Response(JSON.stringify({ context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] } }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const action = JSON.parse(String(init.body)).action;
        return Promise.resolve(new Response(JSON.stringify(action === "log_call" ? { ok: true, npa_failed: true } : { ok: true }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);
    await screen.findByRole("heading", { name: "NPA" });
    await user.click(screen.getByRole("button", { name: "Fiche" }));
    await user.click(screen.getByLabelText("Ne pas rappeler (NPA)"));
    await user.click(screen.getByRole("button", { name: "Logguer & suivant" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Appel consigné, mais le marquage NPA a échoué dans Salesforce — vérifie la fiche.",
    );
    expect(sessionFetches).toBeGreaterThan(1);
  });

  it("loads a new context when the focused contact changes", async () => {
    const contacts = [
      {
        id: 101, position: 0, sf_contact_id: "003000000000001AAA", sf_account_id: null,
        contact_name: "Alice Martin", account_name: "Acme", phone: "0102030405", title: null,
        linkedin_url: null, status: "pending" as const, outcome: null, comments: null,
        sf_task_id: null, sf_event_id: null, called_at: null,
      },
      {
        id: 102, position: 1, sf_contact_id: "003000000000002AAA", sf_account_id: null,
        contact_name: "Bruno Martin", account_name: "Acme", phone: "0102030406", title: null,
        linkedin_url: null, status: "pending" as const, outcome: null, comments: null,
        sf_task_id: null, sf_event_id: null, called_at: null,
      },
    ];
    const activeSession = { id: 1, name: "Changement de contact", status: "active" as const, created_at: "2026-07-10T10:00:00Z" };
    const contextFetches: string[] = [];
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?session_id=1") return Promise.resolve(new Response(JSON.stringify({ session: activeSession, contacts }), { status: 200 }));
      if (url.startsWith("/api/calls?session_id=1&context_contact_id=")) {
        contextFetches.push(url);
        return Promise.resolve(new Response(JSON.stringify({ context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] } }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    const user = userEvent.setup();
    render(<CallManagerApp params={{ session_id: "1" }} />);
    await screen.findByRole("heading", { name: "Changement de contact" });
    await waitFor(() => expect(contextFetches).toEqual(["/api/calls?session_id=1&context_contact_id=101"]));

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByRole("button", { name: "Bruno Martin" }));

    await waitFor(() => expect(contextFetches).toEqual([
      "/api/calls?session_id=1&context_contact_id=101",
      "/api/calls?session_id=1&context_contact_id=102",
    ]));
  });

  it("logs selected contacts in waves of four and aggregates failures", async () => {
    const contacts = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      position: index,
      sf_contact_id: `00300000000000${index + 1}AAA`,
      sf_account_id: null,
      contact_name: `Contact ${index + 1}`,
      account_name: "Acme",
      phone: "0102030405",
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    }));
    const activeSession = { id: 1, name: "Vagues", status: "active", created_at: "2026-07-10T10:00:00Z" };
    const resolvers: Array<(response: Response) => void> = [];
    let sessionFetches = 0;

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?resource=recalls") return Promise.resolve(new Response(JSON.stringify({ recalls: [] }), { status: 200 }));
      if (url === "/api/calls?session_id=1") {
        sessionFetches += 1;
        return Promise.resolve(new Response(JSON.stringify({
          session: sessionFetches === 1 ? activeSession : { ...activeSession, status: "completed" },
          contacts: sessionFetches === 1 ? contacts : contacts.map((contact) => ({ ...contact, status: "called" })),
        }), { status: 200 }));
      }
      if (url.startsWith("/api/calls?session_id=1&context_contact_id=")) {
        return Promise.resolve(new Response(JSON.stringify({ session: activeSession, contacts, context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] } }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const action = JSON.parse(String(init.body)).action;
        if (action === "log_call") return new Promise((resolve) => resolvers.push(resolve));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    const user = userEvent.setup();
    render(<CallManagerApp params={{ session_id: "1" }} />);
    await screen.findByRole("heading", { name: "Vagues" });
    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByRole("button", { name: "Sélectionner les à faire (7)" }));
    await user.click(screen.getByRole("button", { name: "Consigner pour 7" }));

    await waitFor(() => expect(resolvers).toHaveLength(4));
    resolvers[0](new Response(JSON.stringify({ ok: true }), { status: 200 }));
    resolvers[1](new Response(JSON.stringify({ ok: true }), { status: 200 }));
    resolvers[2](new Response(JSON.stringify({ error: "contact_already_processed" }), { status: 409 }));
    resolvers[3](new Response(JSON.stringify({ error: "sf_write_error" }), { status: 502 }));
    await waitFor(() => expect(resolvers).toHaveLength(7));
    resolvers[4](new Response(JSON.stringify({ ok: true }), { status: 200 }));
    resolvers[5](new Response(JSON.stringify({ ok: true }), { status: 200 }));
    resolvers[6](new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("6 consignés, 1 en échec — liste actualisée");
  });
});
