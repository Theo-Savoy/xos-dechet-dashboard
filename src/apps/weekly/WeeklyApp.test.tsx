// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ supabase: { auth: { getSession } } }));
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="forecast-chart">{children}</div>,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Scatter: ({ children }: { children?: React.ReactNode }) => <div data-testid="opp-scatter">{children}</div>,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ZAxis: () => null,
}));

import WeeklyApp from "./WeeklyApp";

const selfPayload = {
  weeks: 2,
  period: "week" as const,
  timezone: "Europe/Paris",
  range: { from: "2026-06-29", to: "2026-07-12" },
  view: "self" as const,
  owners: [{ sf_user_id: "self", name: "Ada Lovelace", email: "ada@xos-learning.fr", role: "commercial" as const, tracking: "commercial" as const }],
  pulse: [
    { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", calls: 2, meetings: 1, proposals: 0 },
    {
      sf_user_id: "self",
      week: "2026-W28",
      week_start: "2026-07-06",
      calls: 4,
      meetings: 2,
      proposals: 1,
      call_results: {
        "Appel non décroché": 1,
        "Message répondeur": 1,
        "Appel décroché": 1,
        "Appel argumenté": 0,
        "RDV planifié": 1,
      },
    },
  ],
  pipeline: [
    { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", generated_count: 1, generated_amount: 5000, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
    { sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", generated_count: 2, generated_amount: 12000, won_count: 1, won_amount: 6000, won_by_type: { catalogue: 3000, sur_mesure: 2000, conseil: 1000 }, won_arr_amount: 3000, closing_rate_count: 0.5, closing_rate_amount: 0.5 },
  ],
  effort: [{ sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", progressions: 3, open_opps_at_start: 20, effort_rate: 0.15 }],
  quarter: [{ sf_user_id: "self", quarter: "FY27-Q1", signed_to_date: 20000, weighted_open: 15000, forecast: 35000, custom_pipe: 18000, target: 60000, signed_n1: 15000, pace_ratio: 4.33, expected_to_date: 4615, monthly_indicative: [
    { month: "07", label: "Juil.", weight: 0.2, raw: 12000, indicative: 10000 },
    { month: "08", label: "Août", weight: 0.3, raw: 18000, indicative: 25000 },
    { month: "09", label: "Sept.", weight: 0.5, raw: 30000, indicative: 25000 },
  ] }],
  forecast_history: [
    { sf_user_id: "self", week_start: "2026-07-06", week: "2026-W28", forecast: 35000, signed_to_date: 20000 },
  ],
  follow_up_opps: [
    { id: "006F", name: "Deal à pousser", sf_user_id: "self", stage: "Négo financière engagée", amount: 20000, probability: 50, expected: 10000, close_date: "2026-08-15", url: "https://example.salesforce.com/lightning/r/Opportunity/006F/view" },
  ],
  stagnant_opps: [
    { id: "006S", name: "Deal silencieux", sf_user_id: "self", stage: "Proposition envoyée", amount: 12000, probability: 40, expected: 4800, close_date: "2026-09-01", days_in_stage: 52, days_since_activity: 28, reasons: ["stage", "silence"], url: "https://example.salesforce.com/lightning/r/Opportunity/006S/view" },
  ],
  pace: {
    week_of_quarter: 1,
    weeks_in_quarter: 13,
    signed_to_date: 20000,
    forecast: 35000,
    target: 60000,
    signed_n1: 15000,
    expected_to_date: 4615,
    run_rate: 260000,
    won_count: 1,
    monthly_indicative: [
      { month: "07", label: "Juil.", weight: 0.2, raw: 12000, indicative: 10000 },
      { month: "08", label: "Août", weight: 0.3, raw: 18000, indicative: 20000 },
      { month: "09", label: "Sept.", weight: 0.5, raw: 30000, indicative: 30000 },
    ],
  },
  quarter_bounds: { from: "2026-07-01", to: "2026-09-30", label: "FY27-Q1" },
  custom_pipe: {
    horizon_days: 180,
    total_amount: 18000,
    total_expected: 9000,
    count: 1,
    months: [
      { month: "2026-07", label: "juil.", amount: 0, expected: 0, count: 0, by_owner: {} },
      { month: "2026-08", label: "août", amount: 0, expected: 0, count: 0, by_owner: {} },
      { month: "2026-09", label: "sept.", amount: 0, expected: 0, count: 0, by_owner: {} },
      { month: "2026-10", label: "oct.", amount: 18000, expected: 9000, count: 1, by_owner: { self: { amount: 18000, expected: 9000, count: 1 } } },
      { month: "2026-11", label: "nov.", amount: 0, expected: 0, count: 0, by_owner: {} },
      { month: "2026-12", label: "déc.", amount: 0, expected: 0, count: 0, by_owner: {} },
    ],
    by_owner: [{ sf_user_id: "self", amount: 18000, expected: 9000, count: 1 }],
    opps: [{ id: "006", name: "Deal SM", sf_user_id: "self", amount: 18000, expected: 9000, probability: 50, close_date: "2026-10-15", month: "2026-10" }],
  },
};

const teamPayload = {
  ...selfPayload,
  view: "team" as const,
  owners: [
    ...selfPayload.owners,
    { sf_user_id: "manager", name: "Grace Hopper", email: "grace@xos-learning.fr", role: "manager" as const, tracking: "commercial" as const },
    { sf_user_id: "sdr", name: "Yanis Agharbi", email: "yanis@xos-learning.fr", role: "commercial" as const, tracking: "sdr" as const },
    { sf_user_id: "dg", name: "Jérôme Bosio", email: "jerome@xos-learning.fr", role: "manager" as const, tracking: "dg" as const },
  ],
  pulse: [
    ...selfPayload.pulse,
    { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", calls: 7, meetings: 3, proposals: 2 },
    { sf_user_id: "sdr", week: "2026-W28", week_start: "2026-07-06", calls: 12, meetings: 5, proposals: 0 },
    { sf_user_id: "dg", week: "2026-W28", week_start: "2026-07-06", calls: 0, meetings: 0, proposals: 0 },
  ],
  pipeline: [
    ...selfPayload.pipeline,
    { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", generated_count: 3, generated_amount: 18000, won_count: 2, won_amount: 9000, won_by_type: { catalogue: 4000, sur_mesure: 3000, conseil: 1000 }, won_arr_amount: 4000, closing_rate_count: 0.67, closing_rate_amount: 0.5 },
    { sf_user_id: "sdr", week: "2026-W28", week_start: "2026-07-06", generated_count: 4, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
    { sf_user_id: "dg", week: "2026-W28", week_start: "2026-07-06", generated_count: 0, generated_amount: 0, won_count: 1, won_amount: 15000, won_by_type: { catalogue: 0, sur_mesure: 15000, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
  ],
  effort: [...selfPayload.effort, { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", progressions: 4, open_opps_at_start: 20, effort_rate: 0.2 }],
  quarter: [...selfPayload.quarter, { sf_user_id: "manager", quarter: "FY27-Q1", signed_to_date: 25000, weighted_open: 10000, forecast: 35000, custom_pipe: 12000, target: null }],
};

const quarterPayload = {
  ...selfPayload,
  weeks: 2,
  period: "quarter" as const,
  range: { from: "2026-06-29", to: "2026-07-12" },
};

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "token", user: { email: "ada@xos-learning.fr" } } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(selfPayload), { status: 200 })));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Weekly Perf", () => {
  it("renders the Monday decision board with weighted and stagnant opps", async () => {
    render(<WeeklyApp />);
    expect(await screen.findByText("Opportunités essentielles du trimestre")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deal à pousser" }).getAttribute("href")).toBe("https://example.salesforce.com/lightning/r/Opportunity/006F/view");
    expect(screen.getByRole("link", { name: "Deal silencieux" })).toBeTruthy();
    expect(screen.getByText("Objectif du trimestre")).toBeTruthy();
    expect(screen.getByText(/vs N−1/)).toBeTruthy();
    expect(screen.getByTestId("opp-scatter")).toBeTruthy();
  });

  it("filters the team view down to one commercial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    expect(screen.getAllByText("Yanis Agharbi").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Filtrer un commercial"));
    fireEvent.click(screen.getByRole("option", { name: "Ada Lovelace" }));
    expect(screen.getByRole("heading", { level: 4, name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 4, name: "Yanis Agharbi" })).toBeNull();
    expect(screen.getByText("Funnel appels")).toBeTruthy();
    expect(screen.getByText("Non décroché")).toBeTruthy();
  });

  it("renders a commercial's week metrics without a team toggle", async () => {
    render(<WeeklyApp />);

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getAllByText("RDV").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText(/2 RDV sur 5/)).toBeTruthy();
    expect(screen.getByText(/bon rythme trimestre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Repères de la semaine/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Équipe" })).toBeNull();
  });

  it("requests the current week by default", async () => {
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/perf?period=week", expect.any(Object));
  });

  it("switches to quarter consolidated view", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(quarterPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));
    expect(await screen.findByText("Trimestre en cours")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("period=quarter"))).toBe(true);
  });

  it("shows consolidated team stats in team view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    expect(await screen.findByText("Consolidé vs S−1")).toBeTruthy();
    const rollup = screen.getByText("Consolidé vs S−1").closest(".weekly-section") as HTMLElement;
    expect(within(rollup).getByText("RDV")).toBeTruthy();
    expect(within(rollup).getByText("10")).toBeTruthy();
    expect(within(rollup).getByText("CA signé")).toBeTruthy();
    expect(within(rollup).getByText(/Ada 6/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    expect(await screen.findByRole("table", { name: /consolidé de l.équipe/i })).toBeTruthy();
  });

  it("keeps the display mode when switching to quarter", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(quarterPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Cards" }).className).toContain("xos-btn--primary");
    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));
    expect(await screen.findByText("Trimestre en cours")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cards" }).className).toContain("xos-btn--primary");
    expect(screen.getByText("Objectif trimestre")).toBeTruthy();
  });

  it("shows the full team roster without a DG badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    expect(screen.getByRole("heading", { level: 4, name: "Grace Hopper" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Jérôme Bosio" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Yanis Agharbi" })).toBeTruthy();
    expect(screen.getByText("SDR")).toBeTruthy();
    expect(screen.getByText("Manager")).toBeTruthy();
    expect(screen.queryByText("DG")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Commerciaux seulement" })).toBeNull();
  });

  it("shows SDR metrics without sales breakdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    const sdrCard = screen.getByRole("heading", { level: 4, name: "Yanis Agharbi" }).closest(".weekly-pulse-card");
    expect(sdrCard).toBeTruthy();
    expect(within(sdrCard as HTMLElement).getByText("RDV pris")).toBeTruthy();
    expect(within(sdrCard as HTMLElement).queryByLabelText("Répartition du CA signé")).toBeNull();
  });

  it("shows the Salesforce mapping warning as a banner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...selfPayload, warning: "sf_user_unmapped" }), { status: 200 })));
    render(<WeeklyApp />);

    expect(await screen.findByText(/Compte Salesforce non relié/)).toBeTruthy();
  });

  it("retries the request after an API error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
  });

  it("renders the dedicated sur-mesure 6-month section", async () => {
    render(<WeeklyApp />);
    expect(await screen.findByText("6 prochains mois")).toBeTruthy();
    expect(screen.getByText("Deal SM")).toBeTruthy();
  });

  it("renders leading flux before Cap and call funnel lower on the page", async () => {
    render(<WeeklyApp />);
    expect(await screen.findByText("Flux menant")).toBeTruthy();
    expect(screen.queryByText(/Les signés se lisent au Cap/)).toBeNull();
    expect(screen.getByText("Volume détecté")).toBeTruthy();
    expect(screen.getByText("Objectif du trimestre")).toBeTruthy();
    expect(screen.getAllByText("Mois indicatifs")).toHaveLength(1);
    expect(screen.getByText(/Juil\./)).toBeTruthy();
    expect(screen.getByText("Projection fin de trimestre")).toBeTruthy();
    expect(screen.getByText("Funnel appels")).toBeTruthy();
    expect(screen.getByText("Non décroché")).toBeTruthy();
    expect(screen.getByText("RDV planifié")).toBeTruthy();
    expect(screen.queryByText("Généré, puis gagné")).toBeNull();

    const leading = screen.getByText("Flux menant");
    const cap = screen.getByText("Objectif du trimestre");
    const funnel = screen.getByText("Funnel appels");
    expect(leading.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cap.compareDocumentPosition(funnel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("computes table totals and week-over-week deltas client-side", async () => {
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Tableau" }));
    const table = screen.getByRole("table", { name: "Suivi hebdomadaire de Ada Lovelace" });
    expect(within(table).getByRole("columnheader", { name: "Total" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Δ S−1" })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /RDV effectués/ })).toBeTruthy();
    expect(within(table).queryByRole("row", { name: /Pipe sur-mesure/ })).toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).queryByRole("row", { name: /Target/ })).toBeNull();
    expect(screen.getByText("Objectif trimestre")).toBeTruthy();
  });
});
