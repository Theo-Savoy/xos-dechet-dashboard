// @vitest-environment jsdom

import { isValidElement, useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRegistry, getAppManifest } from "../../os/registry";
import { useSession } from "../../auth/useSession";
import { todayParisIso } from "./formControls.helpers";

const testToday = todayParisIso();
const mockSession = {
  user: { id: "user-1", email: "theo@xos-learning.fr" },
  access_token: "test-token-abc",
};

function mockSessionState(state: {
  session: typeof mockSession | null;
  loading: boolean;
  bridgeError: boolean;
}) {
  vi.mocked(useSession).mockReturnValue(state as ReturnType<typeof useSession>);
}

vi.mock("../../auth/useSession", () => ({
  useSession: vi.fn(() => ({
    session: mockSession,
    loading: false,
    bridgeError: false,
  })),
}));

// Évite de tirer lib/supabase (qui exige les env VITE_*) via os/shortcuts / profils.
vi.mock("../../os/shortcuts", () => ({
  addShortcut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { role: "manager" }, error: null }),
        }),
      }),
    }),
  },
}));

import CallManagerApp from "./CallManagerApp";
import { invalidateComboHubCache } from "./api";

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

const mockHub = {
  sessions: mockSessions.sessions,
  stats: mockStats.stats,
  recall_count: 0,
};

function hubResponse() {
  return Promise.resolve(new Response(JSON.stringify(mockHub), { status: 200 }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invalidateComboHubCache();
});

beforeEach(() => {
  mockSessionState({ session: mockSession, loading: false, bridgeError: false });
  invalidateComboHubCache();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls") {
        return Promise.resolve(
          new Response(JSON.stringify(mockSessions), { status: 200 }),
        );
      }
      if (url === "/api/calls?resource=hub") return hubResponse();
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
  it("shows the Combo boot screen while the session bridge is loading", () => {
    mockSessionState({ session: null, loading: true, bridgeError: false });

    render(<CallManagerApp />);

    expect(screen.queryByText("Connexion requise…")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Ouverture de Combo…");
  });

  it("shows an actionable error when the session bridge fails", () => {
    mockSessionState({ session: null, loading: false, bridgeError: true });

    render(<CallManagerApp />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Reconnexion requise");
  });

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
        "/api/calls?resource=hub",
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

  it("opens the first ABM session directly in the pre-session flow", async () => {
    const user = userEvent.setup();
    const account = {
      id: "001000000000001AAA",
      name: "ACME",
      industry: "Services informatiques",
      owner_name: "Paul Martin",
      type_client: "Prospect",
      tier: "A",
      effectif: "51 - 250",
      contacts: [{
        sf_contact_id: "003000000000001AAA",
        contact_name: "Alice Martin",
        title: "Directrice",
        phone: "0102030405",
        mobile_phone: null,
        email: "alice@acme.fr",
        decision_level: "+",
      }],
    };
    const contact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: "001000000000001AAA",
      contact_name: "Alice Martin",
      account_name: "ACME",
      phone: "0102030405",
      title: "Directrice",
      linkedin_url: null,
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?resource=team") {
        return Promise.resolve(new Response(JSON.stringify({ team: [{ user_id: "user-1", label: "Paul Martin", sf_user_id: "005000000000001AAA" }] }), { status: 200 }));
      }
      if (url === "/api/calls?session_id=7") {
        return Promise.resolve(new Response(JSON.stringify({
          session: { id: 7, name: "ACME #1", status: "active", created_at: `${testToday}T10:00:00Z`, rdv_goal: null, engaged_at: null },
          contacts: [contact],
        }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "accounts_search") {
          return Promise.resolve(new Response(JSON.stringify({ accounts: [account], truncated: false }), { status: 200 }));
        }
        if (body.action === "create_audience_sessions") {
          return Promise.resolve(new Response(JSON.stringify({ sessions: [{ id: 7, name: "ACME #1", contact_count: 1, account_ids: [account.id] }] }), { status: 200 }));
        }
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp params={{ view: "abm" }} />);

    await user.type(await screen.findByLabelText("Nom du compte"), "ACME");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));
    await user.click(await screen.findByRole("checkbox", { name: "Sélectionner ACME" }));
    await user.click(screen.getByRole("button", { name: "Créer 1 séance ABM" }));

    expect(await screen.findByRole("heading", { name: "ACME #1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choisir le cap" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Rechercher des comptes" })).toBeNull();
  });

  it("keeps the pre-session flow open when the window manager round-trips params", async () => {
    const user = userEvent.setup();
    const account = {
      id: "001000000000001AAA",
      name: "ACME",
      industry: "Services informatiques",
      owner_name: "Paul Martin",
      type_client: "Prospect",
      tier: "A",
      effectif: "51 - 250",
      contacts: [{
        sf_contact_id: "003000000000001AAA",
        contact_name: "Alice Martin",
        title: "Directrice",
        phone: "0102030405",
        mobile_phone: null,
        email: "alice@acme.fr",
        decision_level: "+",
      }],
    };
    const contact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: "001000000000001AAA",
      contact_name: "Alice Martin",
      account_name: "ACME",
      phone: "0102030405",
      title: "Directrice",
      linkedin_url: null,
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?resource=team") {
        return Promise.resolve(new Response(JSON.stringify({ team: [{ user_id: "user-1", label: "Paul Martin", sf_user_id: "005000000000001AAA" }] }), { status: 200 }));
      }
      if (url === "/api/calls?session_id=7") {
        return Promise.resolve(new Response(JSON.stringify({
          session: { id: 7, name: "ACME #1", status: "active", created_at: `${testToday}T10:00:00Z`, rdv_goal: null, engaged_at: null },
          contacts: [contact],
        }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "accounts_search") {
          return Promise.resolve(new Response(JSON.stringify({ accounts: [account], truncated: false }), { status: 200 }));
        }
        if (body.action === "create_audience_sessions") {
          return Promise.resolve(new Response(JSON.stringify({ sessions: [{ id: 7, name: "ACME #1", contact_count: 1, account_ids: [account.id] }] }), { status: 200 }));
        }
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    // Reproduit le vrai WindowManager : onParamsChange réinjecte les params
    // dans la prop, ce que le rendu statique des autres tests ne couvre pas.
    function Harness() {
      const [params, setParams] = useState<Record<string, string> | undefined>({ view: "abm" });
      return <CallManagerApp params={params} onParamsChange={setParams} />;
    }
    render(<Harness />);

    await user.type(await screen.findByLabelText("Nom du compte"), "ACME");
    await user.click(screen.getByRole("button", { name: "Rechercher" }));
    await user.click(await screen.findByRole("checkbox", { name: "Sélectionner ACME" }));
    await user.click(screen.getByRole("button", { name: "Créer 1 séance ABM" }));

    expect(await screen.findByRole("heading", { name: "ACME #1" })).toBeTruthy();
    // Laisse la boucle params → view se stabiliser : le brief doit rester ouvert.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "Choisir le cap" })).toBeTruthy();
    expect(screen.queryByText("Nouvelle séance")).toBeNull();
  });

  it("opens recap follow-up sessions in the pre-session flow", async () => {
    const user = userEvent.setup();
    const contact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: null,
      contact_name: "Alice Martin",
      account_name: "ACME",
      phone: null,
      title: null,
      linkedin_url: null,
      status: "called",
      outcome: "Appel non décroché",
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: `${testToday}T10:00:00Z`,
    };
    const nextContact = { ...contact, status: "pending", outcome: null };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?session_id=1") {
        return Promise.resolve(new Response(JSON.stringify({
          session: { id: 1, name: "Prospection Lyon", status: "completed", created_at: `${testToday}T10:00:00Z` },
          contacts: [contact],
        }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "create_follow_up_session") {
          return Promise.resolve(new Response(JSON.stringify({
            session: { id: 7, name: "Prospection Lyon #2", status: "active", created_at: "2026-07-16T10:00:00Z", rdv_goal: null, engaged_at: null },
            contacts: [nextContact],
          }), { status: 200 }));
        }
      }
      return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);
    await user.click(await screen.findByRole("button", { name: /Préparer la relance/i }));

    expect(await screen.findByRole("heading", { name: "Prospection Lyon #2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choisir le cap" })).toBeTruthy();
  });

  it("keeps the runner objective read-only and sourced from the session", async () => {
    const activeSession = {
      id: 1,
      name: "Objectif verrouillé",
      status: "active",
      created_at: "2026-07-10T10:00:00Z",
      rdv_goal: 4,
      engaged_at: "2026-07-10T10:01:00Z",
    };
    const contact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: null,
      contact_name: "Alice Martin",
      account_name: "ACME",
      phone: "0102030405",
      title: null,
      linkedin_url: null,
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?resource=team") {
        return Promise.resolve(new Response(JSON.stringify({ team: [] }), { status: 200 }));
      }
      if (url === "/api/calls?session_id=1") {
        return Promise.resolve(new Response(JSON.stringify({ session: activeSession, contacts: [contact] }), { status: 200 }));
      }
      if (url.includes("context_contact_id=")) {
        return Promise.resolve(new Response(JSON.stringify({ context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] } }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);

    const kpis = await screen.findByLabelText("Indicateurs de séance");
    expect(kpis.textContent).toContain("0/4");
    expect(screen.getByRole("progressbar", { name: "Progression RDV : 0 sur 4" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Objectif/ })).toBeNull();
  });

  it("retiring 5 contacts in a row triggers only one full session refetch (debounce)", async () => {
    const user = userEvent.setup();
    const activeSession = {
      id: 1,
      name: "Prospection Lyon",
      status: "active",
      created_at: "2026-07-10T10:00:00Z",
      rdv_goal: null,
      engaged_at: "2026-07-10T10:01:00Z",
    };
    const contacts = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i,
      position: i,
      sf_contact_id: `003000000001${i}AAAA`,
      sf_account_id: null,
      contact_name: `Contact ${i}`,
      account_name: "ACME",
      phone: null,
      title: null,
      linkedin_url: null,
      status: "pending" as const,
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    }));

    let sessionRefetchCount = 0;
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?resource=team") {
        return Promise.resolve(new Response(JSON.stringify({ team: [] }), { status: 200 }));
      }
      if (url === "/api/calls?session_id=1") {
        sessionRefetchCount += 1;
        return Promise.resolve(new Response(JSON.stringify({ session: activeSession, contacts }), { status: 200 }));
      }
      if (url.includes("context_contact_id=")) {
        return Promise.resolve(new Response(JSON.stringify({
          context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] },
        }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "remove_contact") {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }
      }
      return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);

    await user.click(await screen.findByRole("button", { name: "Liste" }));
    const refetchesAfterOpen = sessionRefetchCount;
    expect(refetchesAfterOpen).toBe(1);

    for (const contact of contacts) {
      await user.click(screen.getByLabelText(`Sélectionner ${contact.contact_name}`));
      await user.click(screen.getByRole("button", { name: "Retirer" }));
      const dialog = screen.getByRole("dialog", { name: /Retirer.*séance/i });
      await user.click(within(dialog).getByRole("button", { name: "Retirer" }));
      await waitFor(() => expect(screen.queryByText(contact.contact_name)).toBeNull());
    }

    // Le remove local (filter du state) est immédiat : aucun refetch complet
    // tant que le debounce (500ms) n'a pas expiré.
    expect(sessionRefetchCount).toBe(refetchesAfterOpen);

    await waitFor(() => expect(sessionRefetchCount).toBe(refetchesAfterOpen + 1), { timeout: 2000 });
  });

  it("opens an unengaged session in the pre-session flow", async () => {
    const session = {
      id: 1,
      name: "Jamais engagée",
      status: "active",
      created_at: `${testToday}T10:00:00Z`,
      rdv_goal: 4,
      engaged_at: null,
    };
    const contact = {
      id: 101,
      position: 0,
      sf_contact_id: "003000000000001AAA",
      sf_account_id: null,
      contact_name: "Alice Martin",
      account_name: "ACME",
      phone: null,
      title: null,
      linkedin_url: null,
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?session_id=1") {
        return Promise.resolve(new Response(JSON.stringify({ session, contacts: [contact] }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp params={{ session_id: "1" }} />);

    expect(await screen.findByRole("heading", { name: "Jamais engagée" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choisir le cap" })).toBeTruthy();
  });

  it("closes an overdue active session and opens a decision screen for pending contacts", async () => {
    const overdue = {
      id: 9,
      name: "Séance à récupérer",
      status: "active" as const,
      created_at: `${testToday}T10:00:00Z`,
      scheduled_for: "2026-07-15",
      session_type: "prospection" as const,
      total: 1,
      called: 0,
      skipped: 0,
      pending: 1,
      rdv_goal: null,
      engaged_at: null,
    };
    const contact = {
      id: 901,
      position: 0,
      sf_contact_id: "003000000000009AAA",
      sf_account_id: null,
      contact_name: "Contact à décider",
      account_name: "ACME",
      phone: null,
      title: null,
      linkedin_url: null,
      status: "pending",
      outcome: null,
      comments: null,
      sf_task_id: null,
      sf_event_id: null,
      called_at: null,
    };
    const postedActions: string[] = [];
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/calls?resource=hub") {
        return Promise.resolve(new Response(JSON.stringify({ ...mockHub, sessions: [overdue] }), { status: 200 }));
      }
      if (url === "/api/calls?session_id=9") {
        return Promise.resolve(new Response(JSON.stringify({
          session: { ...overdue },
          contacts: [contact],
        }), { status: 200 }));
      }
      if (url === "/api/calls" && init?.method === "POST") {
        postedActions.push(JSON.parse(String(init.body)).action);
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    render(<CallManagerApp />);

    expect(await screen.findByRole("heading", { name: "Décider du devenir des contacts" })).toBeTruthy();
    expect(screen.getByText("Contact à décider")).toBeTruthy();
    expect(postedActions).toEqual(["complete_session"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retirer" }));
    await user.click(screen.getByRole("button", { name: "Appliquer les décisions" }));
    await user.click(screen.getByRole("button", { name: "Retirer le contact" }));
    await waitFor(() => expect(postedActions).toEqual(["complete_session", "remove_contact"]));
  });

  it("restores new session view from persisted params", async () => {
    render(<CallManagerApp params={{ view: "new" }} />);
    expect(await screen.findByText("Composer une liste")).toBeTruthy();
  });

  it("syncs navigation params when changing view", async () => {
    const onParamsChange = vi.fn();
    const user = userEvent.setup();
    render(<CallManagerApp onParamsChange={onParamsChange} />);
    await screen.findByText("Nouvelle séance");
    onParamsChange.mockClear();
    await user.click(screen.getByText("Nouvelle séance"));
    expect(onParamsChange).toHaveBeenCalledWith({ view: "new" });
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
      if (url === "/api/calls?resource=hub") return hubResponse();
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
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?stats=1") {
        return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      }
      if (url.includes("context_contact_id=")) {
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
    expect(screen.queryByRole("button", { name: "Consigner & suivant" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Consigner appel + RDV & suivant" }));
    await screen.findByText("Terminée");
    expect(postedActions).toEqual(["claim_contact", "log_call", "log_event", "complete_session"]);
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
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?session_id=1") {
        sessionFetches += 1;
        return Promise.resolve(new Response(JSON.stringify({
          session: sessionFetches === 1 ? activeSession : { ...activeSession, status: "completed" },
          contacts: sessionFetches === 1 ? [pendingContact] : [{ ...pendingContact, status: "called" }],
        }), { status: 200 }));
      }
      if (url.includes("context_contact_id=")) {
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
    await user.click(screen.getByLabelText(/Ne pas rappeler \(NPA\)/));
    await user.click(screen.getByRole("button", { name: "Consigner & suivant" }));

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
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?session_id=1") return Promise.resolve(new Response(JSON.stringify({ session: activeSession, contacts }), { status: 200 }));
      if (url.includes("context_contact_id=")) {
        contextFetches.push(url);
        return Promise.resolve(new Response(JSON.stringify({ context: { contact_record_url: null, account_record_url: null, tasks: [], opportunities: [] } }), { status: 200 }));
      }
      if (url === "/api/calls") return Promise.resolve(new Response(JSON.stringify(mockSessions), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    });

    const user = userEvent.setup();
    render(<CallManagerApp params={{ session_id: "1" }} />);
    await screen.findByRole("heading", { name: "Changement de contact" });
    await waitFor(() => {
      expect(contextFetches[0]).toContain("context_contact_id=101");
      expect(contextFetches.some((u) => u.includes("context_contact_id=101"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByRole("button", { name: "Bruno Martin" }));

    await waitFor(() => {
      expect(contextFetches.some((u) => u.includes("context_contact_id=101"))).toBe(true);
      expect(contextFetches.some((u) => u.includes("context_contact_id=102"))).toBe(true);
    });
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
      if (url === "/api/calls?resource=hub") return hubResponse();
      if (url === "/api/calls?stats=1") return Promise.resolve(new Response(JSON.stringify(mockStats), { status: 200 }));
      if (url === "/api/calls?resource=recalls") return Promise.resolve(new Response(JSON.stringify({ recalls: [] }), { status: 200 }));
      if (url === "/api/calls?session_id=1") {
        sessionFetches += 1;
        return Promise.resolve(new Response(JSON.stringify({
          session: sessionFetches === 1 ? activeSession : { ...activeSession, status: "completed" },
          contacts: sessionFetches === 1 ? contacts : contacts.map((contact) => ({ ...contact, status: "called" })),
        }), { status: 200 }));
      }
      if (url.includes("context_contact_id=")) {
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
    await user.click(screen.getByRole("button", { name: "Sélectionner (7)" }));
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
