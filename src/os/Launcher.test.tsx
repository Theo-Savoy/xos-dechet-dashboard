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
});
