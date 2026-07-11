// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ supabase: { auth: { getSession } } }));
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import WeeklyApp from "./WeeklyApp";

const selfPayload = {
  weeks: 8,
  timezone: "Europe/Paris",
  range: { from: "2026-05-18", to: "2026-07-12" },
  view: "self" as const,
  owners: [{ sf_user_id: "self", name: "Ada Lovelace", email: "ada@xos-learning.fr", role: "commercial" }],
  pulse: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", calls: 4, meetings: 2, proposals: 1 }],
  pipeline: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", generated_count: 2, generated_amount: 12000, won_count: 1, won_amount: 6000, closing_rate_count: 0.5, closing_rate_amount: 0.5 }],
  effort: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", progressions: 3, open_opps_at_start: 20, effort_rate: 0.15 }],
};

const teamPayload = {
  ...selfPayload,
  view: "team" as const,
  owners: [
    ...selfPayload.owners,
    { sf_user_id: "manager", name: "Grace Hopper", email: "grace@xos-learning.fr", role: "manager" },
  ],
  pulse: [...selfPayload.pulse, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", calls: 7, meetings: 3, proposals: 2 }],
  pipeline: [...selfPayload.pipeline, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", generated_count: 3, generated_amount: 18000, won_count: 2, won_amount: 9000, closing_rate_count: 0.67, closing_rate_amount: 0.5 }],
  effort: [...selfPayload.effort, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", progressions: 4, open_opps_at_start: 20, effort_rate: 0.2 }],
};

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "token", user: { email: "ada@xos-learning.fr" } } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(selfPayload), { status: 200 })));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Weekly Perf", () => {
  it("renders a commercial's metrics without a team toggle", async () => {
    render(<WeeklyApp />);

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Équipe" })).toBeNull();
  });

  it("filters managers by default and reveals them with their badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);

    expect(await screen.findByRole("button", { name: "Équipe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Équipe" }));
    expect(screen.queryByText("Grace Hopper")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Commerciaux seulement" }));
    expect(await screen.findByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("Manager")).toBeTruthy();
  });

  it("shows the Salesforce mapping warning as a banner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...selfPayload, warning: "sf_user_unmapped" }), { status: 200 })));
    render(<WeeklyApp />);

    expect(await screen.findByText(/Compte Salesforce non lié/)).toBeTruthy();
  });

  it("retries the request after an API error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fills missing weeks with zeroes without crashing", async () => {
    render(<WeeklyApp />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Semaines calmes : 7")).toBeTruthy();
  });
});
