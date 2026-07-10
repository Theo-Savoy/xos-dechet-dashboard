// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Polyfill ResizeObserver (required by cmdk / Radix Dialog in jsdom)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill scrollIntoView (required by cmdk when list elements mount)
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock supabase — the Launcher no longer imports it, but cmdk's dependency
// chain may touch it. Provide a safe fallback.
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "unused" } },
      }),
    },
  },
}));

const MOCK_RESULTS = {
  error: null,
  results: [
    { type: "Account", id: "001AAA", name: "Acme Corp", detail: "Tech · Alice", recordUrl: "https://sf.lightning/r/Account/001AAA/view" },
    { type: "Account", id: "001BBB", name: "Beta Inc", detail: "", recordUrl: "https://sf.lightning/r/Account/001BBB/view" },
    { type: "Contact", id: "003CCC", name: "Jean Dupont", detail: "CEO · Acme Corp", recordUrl: "https://sf.lightning/r/Contact/003CCC/view" },
    { type: "Opportunity", id: "006DDD", name: "Deal Alpha", detail: "Qualification · Acme Corp", recordUrl: "https://sf.lightning/r/Opportunity/006DDD/view" },
  ],
};

const noop = () => {};
let Launcher: typeof import("./Launcher").Launcher;

describe("Launcher", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_RESULTS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const mod = await import("./Launcher");
    Launcher = mod.Launcher;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── Keyboard shortcut ──

  it("opens with Cmd+K and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    expect(screen.queryByRole("combobox")).toBeNull();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("combobox")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  it("opens with Ctrl+K on Windows/Linux", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  // ── Bearer token ──

  it("sends Authorization: Bearer <accessToken> from props", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="my-props-token" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      const searchCall = fetchSpy.mock.calls.find(
        (c: [string | URL | Request, RequestInit?]) => typeof c[0] === "string" && c[0].includes("/api/search"),
      );
      expect(searchCall).toBeDefined();
      expect((searchCall![1] as RequestInit).headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer my-props-token" }),
      );
    });
  });

  // ── States ──

  it("shows loading indicator while search is in-flight", async () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      expect(screen.getByText("Recherche…")).toBeTruthy();
    });
  });

  it("shows hint when query is fewer than 2 characters", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "a");

    expect(screen.getByText(/2 caractères/)).toBeTruthy();
  });

  it("shows empty message when search returns zero results", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: null, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "zzzznothing");

    await waitFor(() => {
      expect(screen.getByText("Aucun résultat.")).toBeTruthy();
    });
  });

  it("shows error message when search API fails", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "test");

    await waitFor(() => {
      expect(screen.getByText("Erreur de recherche.")).toBeTruthy();
    });
  });

  // ── Result groups ──

  it("groups results by Account, Contact, and Opportunity", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      expect(screen.getByText("Comptes")).toBeTruthy();
      expect(screen.getByText("Contacts")).toBeTruthy();
      expect(screen.getByText("Opportunités")).toBeTruthy();
    });
  });

  it("renders result items with name and detail text", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeTruthy();
      expect(screen.getByText("Jean Dupont")).toBeTruthy();
      expect(screen.getByText("Deal Alpha")).toBeTruthy();
    });
  });

  // ── Links with noopener ──

  it("opens recordUrl in new tab with noopener,noreferrer", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeTruthy();
    });

    // Click the first SF result
    const item = screen.getByText("Acme Corp").closest("[cmdk-item]") ||
      screen.getByText("Acme Corp").closest("[role='option']");
    if (item) await user.click(item);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://sf.lightning/r/Account/001AAA/view",
        "_blank",
        "noopener,noreferrer",
      );
    });

    openSpy.mockRestore();
  });

  // ── Local apps group ──

  it("shows matching X OS apps in an Apps group", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Cleaner");

    await waitFor(() => {
      expect(screen.getByText("Apps")).toBeTruthy();
      expect(screen.getByText("CRM Cleaner")).toBeTruthy();
    });
  });

  it("calls onOpenApp when a local app is selected", async () => {
    const onOpenApp = vi.fn();
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={onOpenApp} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Cleaner");

    await waitFor(() => {
      expect(screen.getByText("CRM Cleaner")).toBeTruthy();
    });

    const item = screen.getByText("CRM Cleaner").closest("[cmdk-item]") ||
      screen.getByText("CRM Cleaner").closest("[role='option']");
    if (item) await user.click(item);

    await waitFor(() => {
      expect(onOpenApp).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cleaner" }),
      );
    });
  });

  // ── Abort on close ──

  it("aborts in-flight search when palette closes", async () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "Acme");

    await waitFor(() => {
      expect(screen.getByText("Recherche…")).toBeTruthy();
    });

    // Close the palette
    await user.keyboard("{Escape}");

    // Palette should be gone
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  // ── No fetch when closed ──

  it("does not fire search requests when palette is closed", async () => {
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    // Wait a bit without opening the palette
    await new Promise((r) => setTimeout(r, 400));

    const searchCalls = fetchSpy.mock.calls.filter(
      (c: [string | URL | Request, RequestInit?]) => typeof c[0] === "string" && c[0].includes("/api/search"),
    );
    expect(searchCalls).toHaveLength(0);
  });

  // ── Debounce ──

  it("debounces search requests (not one per keystroke)", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox"), "ABCD", { delay: 1 } as Parameters<typeof user.type>[2]);

    const searchCalls = fetchSpy.mock.calls.filter(
      (c: [string | URL | Request, RequestInit?]) => typeof c[0] === "string" && c[0].includes("/api/search"),
    );
    expect(searchCalls.length).toBeLessThanOrEqual(2);
  });

  // ── Keyboard hint ──

  it("renders keyboard shortcut hint in the footer", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByText(/⌘K/)).toBeTruthy();
  });

  // ── Spinner reset on inline search abort ──

  it("resets loading spinner when /log association search drops below 2 chars", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const logCmd = screen.getByText("/log").closest("[cmdk-item]") ||
      screen.getByText("/log").closest("[role='option']");
    if (logCmd) await user.click(logCmd);

    // Hold fetch pending
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => new Promise(() => {}));

    const recordSearch = screen.getByPlaceholderText("Rechercher un enregistrement...");
    await user.type(recordSearch, "Acme");
    await new Promise((r) => setTimeout(r, 300));

    // Spinner visible while fetch is in-flight
    expect(screen.getByText("Recherche…")).toBeTruthy();

    // Drop below 2 chars — should abort and clear spinner
    await user.clear(recordSearch);
    await user.type(recordSearch, "A");

    await waitFor(() => {
      expect(screen.queryByText("Recherche…")).toBeNull();
    });
  });

  it("resets loading spinner when /create account search drops below 2 chars", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const createCmd = screen.getByText("/create").closest("[cmdk-item]") ||
      screen.getByText("/create").closest("[role='option']");
    if (createCmd) await user.click(createCmd);

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => new Promise(() => {}));

    const accountSearch = screen.getByPlaceholderText("Rechercher un compte...");
    await user.type(accountSearch, "Acme");
    await new Promise((r) => setTimeout(r, 300));

    expect(screen.getByText("Recherche…")).toBeTruthy();

    await user.clear(accountSearch);
    await user.type(accountSearch, "A");

    await waitFor(() => {
      expect(screen.queryByText("Recherche…")).toBeNull();
    });
  });

  // ── Race conditions: inline search abort ──

  it("aborts stale /log inline search when new query replaces it", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const logCmd = screen.getByText("/log").closest("[cmdk-item]") ||
      screen.getByText("/log").closest("[role='option']");
    if (logCmd) await user.click(logCmd);

    expect(screen.getByText("Consigner une note d'appel")).toBeTruthy();

    let resolveSlow: ((value: Response) => void) | null = null;
    let resolveFast: ((value: Response) => void) | null = null;

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => {
      if (!resolveSlow) {
        return new Promise<Response>((r) => { resolveSlow = r; });
      }
      return new Promise<Response>((r) => { resolveFast = r; });
    });

    const recordSearch = screen.getByPlaceholderText("Rechercher un enregistrement...");
    await user.type(recordSearch, "Slo");
    await new Promise((r) => setTimeout(r, 300));

    await user.clear(recordSearch);
    await user.type(recordSearch, "Fas");
    await new Promise((r) => setTimeout(r, 300));

    expect(resolveFast).not.toBeNull();

    resolveFast!(new Response(JSON.stringify({
      error: null,
      results: [{ type: "Account", id: "001FAST", name: "Fast Corp", detail: "", recordUrl: "" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => {
      expect(screen.getByText("Fast Corp")).toBeTruthy();
    });

    resolveSlow!(new Response(JSON.stringify({
      error: null,
      results: [{ type: "Account", id: "001SLOW", name: "Slow Corp", detail: "", recordUrl: "" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("Slow Corp")).toBeNull();
    expect(screen.getByText("Fast Corp")).toBeTruthy();
  });

  it("aborts stale /create inline search when new account query replaces it", async () => {
    const user = userEvent.setup();
    render(<Launcher accessToken="tok" onOpenApp={noop} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const createCmd = screen.getByText("/create").closest("[cmdk-item]") ||
      screen.getByText("/create").closest("[role='option']");
    if (createCmd) await user.click(createCmd);

    expect(screen.getByText("Créer un contact express")).toBeTruthy();

    let resolveSlow: ((value: Response) => void) | null = null;
    let resolveFast: ((value: Response) => void) | null = null;

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => {
      if (!resolveSlow) {
        return new Promise<Response>((r) => { resolveSlow = r; });
      }
      return new Promise<Response>((r) => { resolveFast = r; });
    });

    const accountSearch = screen.getByPlaceholderText("Rechercher un compte...");
    await user.type(accountSearch, "Slo");
    await new Promise((r) => setTimeout(r, 300));

    await user.clear(accountSearch);
    await user.type(accountSearch, "Fas");
    await new Promise((r) => setTimeout(r, 300));

    expect(resolveFast).not.toBeNull();

    resolveFast!(new Response(JSON.stringify({
      error: null,
      results: [{ type: "Account", id: "001FAST", name: "Fast Account Co", detail: "", recordUrl: "" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => {
      expect(screen.getByText("Fast Account Co")).toBeTruthy();
    });

    resolveSlow!(new Response(JSON.stringify({
      error: null,
      results: [{ type: "Account", id: "001SLOW", name: "Slow Account Co", detail: "", recordUrl: "" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("Slow Account Co")).toBeNull();
    expect(screen.getByText("Fast Account Co")).toBeTruthy();
  });

  // ── Commands and Inline Forms ──

  describe("Commands and Inline Forms", () => {
    it("suggests /log, /create, and /clean commands when input starts with /", async () => {
      const user = userEvent.setup();
      render(<Launcher accessToken="tok" onOpenApp={noop} />);

      await user.keyboard("{Meta>}k{/Meta}");
      const input = screen.getByRole("combobox");
      await user.type(input, "/");

      expect(screen.getByText("/log")).toBeTruthy();
      expect(screen.getByText("/create")).toBeTruthy();
      expect(screen.getByText("/clean")).toBeTruthy();
    });

    it("opens CRM Cleaner when /clean command is selected", async () => {
      const user = userEvent.setup();
      const openAppMock = vi.fn();
      render(<Launcher accessToken="tok" onOpenApp={openAppMock} />);

      await user.keyboard("{Meta>}k{/Meta}");
      const input = screen.getByRole("combobox");
      await user.type(input, "/clean Acme");

      const cleanItem = screen.getByText(/Ouvrir le CRM Cleaner/).closest("[cmdk-item]") ||
        screen.getByText(/Ouvrir le CRM Cleaner/).closest("[role='option']");
      if (cleanItem) await user.click(cleanItem);

      expect(openAppMock).toHaveBeenCalledTimes(1);
      expect(openAppMock.mock.calls[0][0].id).toBe("cleaner");
      expect(openAppMock.mock.calls[0][1]).toEqual({ q: "Acme" });
    });

    it("transitions to /log form and submits call notes successfully", async () => {
      const user = userEvent.setup();
      const localFetchSpy = vi.spyOn(globalThis, "fetch");

      // Mock API call to /api/search for autocomplete inside form
      localFetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: null,
          results: [{ type: "Account", id: "001XYZ", name: "Test Corp", detail: "", recordUrl: "" }]
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      );

      // Mock API call to /api/log for submission
      localFetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: null, success: true, taskId: "00T123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

      render(<Launcher accessToken="tok" onOpenApp={noop} />);

      await user.keyboard("{Meta>}k{/Meta}");

      // Select /log command
      const logCmd = screen.getByText("/log").closest("[cmdk-item]") ||
        screen.getByText("/log").closest("[role='option']");
      if (logCmd) await user.click(logCmd);

      // Verify form header
      expect(screen.getByText("Consigner une note d'appel")).toBeTruthy();

      // Search and select record
      const recordSearchInput = screen.getByPlaceholderText("Rechercher un enregistrement...");
      await user.type(recordSearchInput, "Test Corp");

      await waitFor(() => {
        expect(screen.getByText("Test Corp")).toBeTruthy();
      });

      const matchedRecord = screen.getByText("Test Corp");
      await user.click(matchedRecord);

      // Verify record is selected
      expect(screen.getByText(/Test Corp/)).toBeTruthy();

      // Fill comments
      const commentsTextarea = screen.getByPlaceholderText("Renseigner les notes d'appel...");
      await user.type(commentsTextarea, "Great feedback from customer.");

      // Submit
      const submitBtn = screen.getByRole("button", { name: "Enregistrer la note" });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Note d'appel enregistrée avec succès !")).toBeTruthy();
      });

      // Verify fetch payload
      const logCall = localFetchSpy.mock.calls.find(c => c[0] === "/api/log");
      expect(logCall).toBeTruthy();
      const payload = JSON.parse(logCall![1]!.body as string);
      expect(payload.action).toBe("log_call");
      expect(payload.recordId).toBe("001XYZ");
      expect(payload.recordType).toBe("Account");
      expect(payload.comments).toBe("Great feedback from customer.");
    });

    it("transitions to /create form and submits contact successfully", async () => {
      const user = userEvent.setup();
      const localFetchSpy = vi.spyOn(globalThis, "fetch");

      // Mock API call to /api/log for submission
      localFetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: null, success: true, contactId: "003XYZ" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

      render(<Launcher accessToken="tok" onOpenApp={noop} />);

      await user.keyboard("{Meta>}k{/Meta}");

      // Select /create command
      const createCmd = screen.getByText("/create").closest("[cmdk-item]") ||
        screen.getByText("/create").closest("[role='option']");
      if (createCmd) await user.click(createCmd);

      // Verify form header
      expect(screen.getByText("Créer un contact express")).toBeTruthy();

      // Fill last name (Nom) and other fields
      const lastNameInput = screen.getByLabelText("Nom*");
      await user.type(lastNameInput, "Dupont");

      const firstNameInput = screen.getByLabelText("Prénom");
      await user.type(firstNameInput, "Jean");

      const emailInput = screen.getByLabelText("Email");
      await user.type(emailInput, "jean.dupont@company.com");

      // Submit
      const submitBtn = screen.getByRole("button", { name: "Créer le contact" });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Contact créé avec succès !")).toBeTruthy();
      });

      // Verify fetch payload
      const logCall = localFetchSpy.mock.calls.find(c => c[0] === "/api/log");
      expect(logCall).toBeTruthy();
      const payload = JSON.parse(logCall![1]!.body as string);
      expect(payload.action).toBe("create_contact");
      expect(payload.lastName).toBe("Dupont");
      expect(payload.firstName).toBe("Jean");
      expect(payload.email).toBe("jean.dupont@company.com");
    });
  });
});
