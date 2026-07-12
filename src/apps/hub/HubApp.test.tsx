// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppManifest } from "../../os/registry";

const { getSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ supabase: { auth: { getSession, signOut } } }));
import HubApp from "./HubApp";

const managerPayload = {
  role: "manager",
  capabilities: { manageSettings: true, manageRoles: false },
  profile: { email: "ada@xos-learning.fr", fullName: "Ada Lovelace", sfUserId: "005xx" },
  salesforce: { connected: true, dailyApiRequests: { max: 15000, remaining: 14900 } },
  cache: { cleaner: { version: "history/latest.json" } },
  version: "abc123",
  settings: [{ id: 1, key: "cleaner_late_days", value: 14 }],
};

const targetsPayload = {
  quarter: { label: "FY27-Q1", from: "2026-07-01", to: "2026-09-30" },
  seasonality: { as_of: "2026-07-01", sample_years: [2024, 2025, 2026] },
  month_template: [{ month: "07", weight: 0.2 }, { month: "08", weight: 0.3 }, { month: "09", weight: 0.5 }],
  rows: [{
    sf_user_id: "005xx",
    name: "Ada Lovelace",
    email: "ada@xos-learning.fr",
    role: "commercial",
    quarterly_target: 60000,
    monthly_indicative: [
      { month: "07", label: "Juil.", weight: 0.2, raw: 12000, indicative: 10000 },
      { month: "08", label: "Août", weight: 0.3, raw: 18000, indicative: 25000 },
      { month: "09", label: "Sept.", weight: 0.5, raw: 30000, indicative: 25000 },
    ],
  }],
};

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  signOut.mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/api/weekly-targets")) {
      return Promise.resolve(new Response(JSON.stringify(targetsPayload), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(managerPayload), { status: 200 }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Hub app", () => {
  it("is registered for managers and admins only (dock gating)", () => {
    const manifest = getAppManifest("hub");
    expect(manifest?.id).toBe("hub");
    expect(manifest?.roles).toEqual(["manager", "admin"]);
  });

  it("renders manager settings from the status payload and does not expose role management", async () => {
    render(<HubApp />);
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(await screen.findByText("Trimestre en cours")).toBeTruthy();
    expect(await screen.findByText(/Juil\./)).toBeTruthy();
    expect(screen.queryByText("Accès & rôles")).toBeNull();
    expect(screen.getByText(/100 utilisés \/ 15.000 — 14.900 restants/)).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith("/api/status", expect.objectContaining({ headers: { Authorization: "Bearer token" } }));
  });

  it("does not render a logout button anymore (moved to the desktop menubar)", async () => {
    render(<HubApp />);
    await screen.findByText("Compte");
    expect(screen.queryByRole("button", { name: "Déconnexion" })).toBeNull();
  });
});
