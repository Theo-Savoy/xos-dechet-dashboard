// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  pipeline: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", generated_count: 2, generated_amount: 12000, won_count: 1, won_amount: 6000, won_by_type: { catalogue: 3000, sur_mesure: 2000, conseil: 1000 }, won_arr_amount: 3000, closing_rate_count: 0.5, closing_rate_amount: 0.5 }],
  effort: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", progressions: 3, open_opps_at_start: 20, effort_rate: 0.15 }],
  quarter: [{ sf_user_id: "self", quarter: "FY27-Q1", signed_to_date: 20000, weighted_open: 15000, forecast: 35000, custom_pipe: 18000, target: 60000 }],
};

const teamPayload = {
  ...selfPayload,
  view: "team" as const,
  owners: [
    ...selfPayload.owners,
    { sf_user_id: "manager", name: "Grace Hopper", email: "grace@xos-learning.fr", role: "manager" },
  ],
  pulse: [...selfPayload.pulse, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", calls: 7, meetings: 3, proposals: 2 }],
  pipeline: [...selfPayload.pipeline, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", generated_count: 3, generated_amount: 18000, won_count: 2, won_amount: 9000, won_by_type: { catalogue: 4000, sur_mesure: 3000, conseil: 1000 }, won_arr_amount: 4000, closing_rate_count: 0.67, closing_rate_amount: 0.5 }],
  effort: [...selfPayload.effort, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", progressions: 4, open_opps_at_start: 20, effort_rate: 0.2 }],
  quarter: [...selfPayload.quarter, { sf_user_id: "manager", quarter: "FY27-Q1", signed_to_date: 25000, weighted_open: 10000, forecast: 35000, custom_pipe: 12000, target: null }],
};

const tablePayload = {
  ...selfPayload,
  weeks: 2,
  range: { from: "2026-06-29", to: "2026-07-12" },
  pulse: [
    { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", calls: 1, meetings: 2, proposals: 0 },
    { sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", calls: 2, meetings: 4, proposals: 1 },
  ],
  pipeline: [
    { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", generated_count: 1, generated_amount: 5000, won_count: 1, won_amount: 1000, won_by_type: { catalogue: 1000, sur_mesure: 0, conseil: 0 }, won_arr_amount: 1000, closing_rate_count: 1, closing_rate_amount: 0.2 },
    { sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", generated_count: 3, generated_amount: 9000, won_count: 2, won_amount: 3000, won_by_type: { catalogue: 1000, sur_mesure: 1000, conseil: 500 }, won_arr_amount: 1000, closing_rate_count: 2 / 3, closing_rate_amount: 1 / 3 },
  ],
  quarter: [{ sf_user_id: "self", quarter: "FY27-Q1", signed_to_date: 20000, weighted_open: 15000, forecast: 35000, custom_pipe: 18000, target: null }],
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

  it("renders the quarter gauge with signed, forecast and target amounts", async () => {
    render(<WeeklyApp />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByLabelText(/Signé.*20.*000/)).toBeTruthy();
    expect(screen.getByLabelText(/Forecast.*35.*000/)).toBeTruthy();
    expect(screen.getByLabelText(/Target.*60.*000/)).toBeTruthy();
    expect(screen.getByLabelText("Répartition du CA signé").parentElement?.querySelectorAll(".weekly-breakdown-labels span")).toHaveLength(3);
  });

  it("computes table totals and averages client-side", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tablePayload), { status: 200 })));
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Tableau" }));
    const table = screen.getByRole("table", { name: "Suivi hebdomadaire de Ada Lovelace" });
    expect(within(table).getByRole("columnheader", { name: "Total" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Moyenne" })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /RDV effectués.*2.*4.*6.*3/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /CA signé.*1.*000.*3.*000.*4.*000.*2.*000/ })).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(11);
  });

  it("shows dashes for a missing target and its empty average", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tablePayload), { status: 200 })));
    render(<WeeklyApp />);

    await screen.findByText("Ada Lovelace");
    expect(screen.getByLabelText("Target —")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    const targetRow = within(screen.getByRole("table", { name: "Suivi hebdomadaire de Ada Lovelace" })).getByRole("row", { name: /Target/ });
    expect(within(targetRow).getAllByText("—")).toHaveLength(4);
  });
});
