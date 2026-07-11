// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  signOut.mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(managerPayload), { status: 200 })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Hub app", () => {
  it("is registered for every role", () => {
    const manifest = getAppManifest("hub");
    expect(manifest?.id).toBe("hub");
    expect(manifest?.roles).toBeUndefined();
  });

  it("renders manager settings from the status payload and does not expose role management", async () => {
    render(<HubApp />);
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Configuration équipe")).toBeTruthy();
    expect(screen.queryByText("Accès & rôles")).toBeNull();
    expect(screen.getByText("14 900 / 15 000")).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith("/api/status", expect.objectContaining({ headers: { Authorization: "Bearer token" } }));
  });

  it("uses Supabase signOut from the account panel", async () => {
    const user = userEvent.setup();
    render(<HubApp />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Déconnexion" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
