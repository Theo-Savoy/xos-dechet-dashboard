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
import { scopePace } from "./WeeklyApp.helpers";

const baseContext = {
  iso_week: "2026-W28",
  quarter_label: "FY27-Q1",
  week_of_quarter: 1,
  weeks_in_quarter: 13,
  compare_week: "2026-W27",
  prior_quarter_label: "FY26-Q4",
  anchor_week_start: "2026-07-06",
  live_week_start: "2026-07-06",
  live_iso_week: "2026-W28",
};

const selfPayload = {
  weeks: 2,
  period: "week" as const,
  timezone: "Europe/Paris",
  range: { from: "2026-06-29", to: "2026-07-12" },
  view: "team" as const,
  context: baseContext,
  week_meta: [
    { week_start: "2026-06-29", iso_week: "2026-W27" },
    { week_start: "2026-07-06", iso_week: "2026-W28" },
  ],
  period_history: {
    weeks: [
      { week_start: "2026-06-29", iso_week: "2026-W27", quarter: "FY27-Q1" },
      { week_start: "2026-07-06", iso_week: "2026-W28", quarter: "FY27-Q1" },
    ],
    quarters: ["FY27-Q1"],
  },
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
  prior_pulse: selfPayload.pulse.map((row) => ({ ...row, meetings: Math.max(0, row.meetings - 1), calls: Math.max(0, row.calls - 1) })),
  prior_pipeline: selfPayload.pipeline.map((row) => ({ ...row, generated_count: Math.max(0, row.generated_count - 1), won_amount: Math.max(0, row.won_amount - 1000) })),
};

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "token", user: { email: "ada@xos-learning.fr" } } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(selfPayload), { status: 200 })));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Weekly Perf", () => {
  it("renders the Monday decision board with weighted and stagnant opps", async () => {
    render(<WeeklyApp />);
    expect(await screen.findByText("À closer ce trimestre")).toBeTruthy();
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
    expect(screen.getByText("Line")).toBeTruthy();
    expect(screen.getByText("Non décroché")).toBeTruthy();
  });

  it("renders a commercial's week metrics with the team toggle", async () => {
    render(<WeeklyApp />);

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getAllByText("RDV").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+100\s*%/).length).toBeGreaterThan(0);
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText(/2 RDV sur 5/)).toBeTruthy();
    expect(screen.getByText(/bon rythme trimestre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /snapshot de la période/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Équipe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Moi" })).toBeTruthy();
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
    expect(await screen.findByText(/FY27-Q1 · S1\/13/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("period=quarter"))).toBe(true);
    expect(await screen.findByText("Semaine après semaine")).toBeTruthy();
    expect(screen.getByText("Projeté vs signé")).toBeTruthy();
  });

  it("splits the volume chart into one mini chart per unit instead of a shared axis", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(quarterPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));
    const title = await screen.findByText("Semaine après semaine");
    const section = title.closest(".weekly-section") as HTMLElement;
    expect(within(section).getByTestId("weekly-activity-mini-rdv")).toBeTruthy();
    expect(within(section).getByTestId("weekly-activity-mini-detections")).toBeTruthy();
    expect(within(section).getByTestId("weekly-activity-mini-calls")).toBeTruthy();
    expect(within(section).getByText("RDV")).toBeTruthy();
    expect(within(section).getByText("Détections")).toBeTruthy();
    expect(within(section).getByText("Appels")).toBeTruthy();
  });

  it("drops the Appels mini chart when no seller logged calls", async () => {
    const quarterNoCallsPayload = {
      ...quarterPayload,
      pulse: quarterPayload.pulse.map((row) => ({ ...row, calls: 0 })),
      prior_pulse: quarterPayload.prior_pulse.map((row) => ({ ...row, calls: 0 })),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(quarterNoCallsPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));
    const title = await screen.findByText("Semaine après semaine");
    const section = title.closest(".weekly-section") as HTMLElement;
    expect(within(section).getByTestId("weekly-activity-mini-rdv")).toBeTruthy();
    expect(within(section).getByTestId("weekly-activity-mini-detections")).toBeTruthy();
    expect(within(section).queryByTestId("weekly-activity-mini-calls")).toBeNull();
  });

  it("shows consolidated team stats in team view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(teamPayload), { status: 200 })));
    render(<WeeklyApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    expect(await screen.findByText(/Consolidé · S27/)).toBeTruthy();
    const rollup = screen.getByText(/Consolidé · S27/).closest(".weekly-section") as HTMLElement;
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
    expect(await screen.findByText(/FY27-Q1 · S1\/13/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cards" }).className).toContain("xos-btn--primary");
    expect(screen.getByRole("heading", { name: "Où en est le trimestre" })).toBeTruthy();
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

  it("shows three visible CA breakdown bars sized from won_by_type", async () => {
    render(<WeeklyApp />);
    const card = (await screen.findByRole("heading", { level: 4, name: "Ada Lovelace" })).closest(".weekly-pulse-card") as HTMLElement;
    const breakdown = within(card).getByLabelText("Répartition du CA signé");
    const widthOf = (type: string) => (breakdown.querySelector(`.weekly-breakdown-${type}`)?.closest(".weekly-tip") as HTMLElement).style.width;
    expect(widthOf("catalogue")).toBe(`${(3000 / 6000) * 100}%`);
    expect(widthOf("sur_mesure")).toBe(`${(2000 / 6000) * 100}%`);
    expect(widthOf("conseil")).toBe(`${(1000 / 6000) * 100}%`);
    expect(breakdown.querySelector(".weekly-breakdown-autres")).toBeNull();
  });

  it("does not render the CA breakdown when wonAmount is 0", async () => {
    const zeroWonPayload = {
      ...selfPayload,
      pipeline: selfPayload.pipeline.map((row) => (row.week === "2026-W28"
        ? { ...row, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0 }
        : row)),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(zeroWonPayload), { status: 200 })));
    render(<WeeklyApp />);
    const card = (await screen.findByRole("heading", { level: 4, name: "Ada Lovelace" })).closest(".weekly-pulse-card") as HTMLElement;
    expect(within(card).queryByLabelText("Répartition du CA signé")).toBeNull();
  });

  it("adds an Autres category and warns when won_by_type sum is below wonAmount", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const incoherentPayload = {
      ...selfPayload,
      pipeline: selfPayload.pipeline.map((row) => (row.week === "2026-W28"
        ? { ...row, won_amount: 6000, won_by_type: { catalogue: 2000, sur_mesure: 1000, conseil: 500 } }
        : row)),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(incoherentPayload), { status: 200 })));
    render(<WeeklyApp />);
    const card = (await screen.findByRole("heading", { level: 4, name: "Ada Lovelace" })).closest(".weekly-pulse-card") as HTMLElement;
    const breakdown = within(card).getByLabelText("Répartition du CA signé");
    expect(breakdown.querySelector(".weekly-breakdown-autres")).toBeTruthy();
    expect(within(card).getByText(/Autres/)).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
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

  it("renders amont before pace and line lower on the page", async () => {
    render(<WeeklyApp />);
    expect(await screen.findByText("Amont")).toBeTruthy();
    expect(screen.getByText("RDV → détection → volume")).toBeTruthy();
    expect(screen.getByText("Volume détecté")).toBeTruthy();
    expect(screen.getByText("Objectif du trimestre")).toBeTruthy();
    expect(screen.getAllByText("Mois indicatifs")).toHaveLength(1);
    expect(screen.getByText(/Juil\./)).toBeTruthy();
    expect(screen.getByText("Projeté fin de trimestre")).toBeTruthy();
    expect(screen.getByText("Line")).toBeTruthy();
    expect(screen.getByText("De l’appel au RDV")).toBeTruthy();
    expect(screen.getByText("Non décroché")).toBeTruthy();
    expect(screen.getByText("RDV planifié")).toBeTruthy();
    expect(screen.queryByText("Généré, puis gagné")).toBeNull();

    const leading = screen.getByText("Amont");
    const rythme = screen.getByText("Objectif du trimestre");
    const line = screen.getByText("Line");
    expect(leading.compareDocumentPosition(rythme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rythme.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("computes table totals and week-over-week deltas client-side", async () => {
    render(<WeeklyApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Tableau" }));
    const table = screen.getByRole("table", { name: "Suivi hebdomadaire de Ada Lovelace" });
    expect(within(table).getByRole("columnheader", { name: "Total" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: /Écart vs S27/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /RDV effectués/ })).toBeTruthy();
    expect(within(table).queryByRole("row", { name: /Pipe sur-mesure/ })).toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).queryByRole("row", { name: /Target/ })).toBeNull();
    expect(within(table.closest(".weekly-table-card") as HTMLElement).getByText("Objectif")).toBeTruthy();
  });

  it("keeps the SDR ledger visible with zeros instead of a hard empty state", async () => {
    const emptySdrPayload = {
      ...teamPayload,
      pulse: [
        { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", calls: 0, meetings: 0, proposals: 0 },
        { sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", calls: 0, meetings: 0, proposals: 0 },
        { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", calls: 0, meetings: 0, proposals: 0 },
        { sf_user_id: "sdr", week: "2026-W28", week_start: "2026-07-06", calls: 0, meetings: 0, proposals: 0 },
        { sf_user_id: "dg", week: "2026-W28", week_start: "2026-07-06", calls: 0, meetings: 0, proposals: 0 },
      ],
      pipeline: [
        { sf_user_id: "self", week: "2026-W27", week_start: "2026-06-29", generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
        { sf_user_id: "self", week: "2026-W28", week_start: "2026-07-06", generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
        { sf_user_id: "manager", week: "2026-W28", week_start: "2026-07-06", generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
        { sf_user_id: "sdr", week: "2026-W28", week_start: "2026-07-06", generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
        { sf_user_id: "dg", week: "2026-W28", week_start: "2026-07-06", generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, closing_rate_count: null, closing_rate_amount: null },
      ],
      effort: [],
      follow_up_opps: [],
      stagnant_opps: [],
      custom_pipe: { horizon_days: 180, total_amount: 0, total_expected: 0, count: 0, months: [], by_owner: [], opps: [] },
      pace: { ...teamPayload.pace, signed_to_date: 0, forecast: 0, won_count: 0 },
      quarter: teamPayload.quarter.map((row) => ({ ...row, signed_to_date: 0, forecast: 0, custom_pipe: 0 })),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(emptySdrPayload), { status: 200 })));
    render(<WeeklyApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Équipe" }));
    fireEvent.click(screen.getByLabelText("Filtrer un commercial"));
    fireEvent.click(screen.getByRole("option", { name: "Yanis Agharbi" }));
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    expect(screen.queryByText(/Rien à signaler/i)).toBeNull();
    expect(screen.getByText(/Pas encore d’activité/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Suivi hebdomadaire de Yanis Agharbi" });
    expect(within(table).getByRole("row", { name: /Appels/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /RDV pris/ })).toBeTruthy();
    expect(screen.getByText("Amont")).toBeTruthy();
    expect(screen.getByText("Volume détecté")).toBeTruthy();
  });

  it("keeps the week selector after choosing a past week", async () => {
    const pastPayload = {
      ...selfPayload,
      context: {
        ...baseContext,
        iso_week: "2026-W27",
        compare_week: "2026-W26",
        anchor_week_start: "2026-06-29",
        live_week_start: "2026-07-06",
        live_iso_week: "2026-W28",
      },
      period_history: { weeks: [], quarters: [] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(selfPayload), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(pastPayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WeeklyApp />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByLabelText("Choisir une semaine"));
    fireEvent.click(screen.getByRole("option", { name: "S27" }));
    expect(await screen.findByText("Semaine en cours")).toBeTruthy();
    expect(screen.getByLabelText("Choisir une semaine")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("week_start=2026-06-29"))).toBe(true);
  });

  it("shows section hints via portal on hover", async () => {
    render(<WeeklyApp />);
    const tip = await screen.findByRole("button", { name: /snapshot de la période/i });
    fireEvent.mouseEnter(tip.closest(".weekly-tip") as HTMLElement);
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toMatch(/snapshot de la période/i);
    expect(document.body.contains(screen.getByRole("tooltip"))).toBe(true);
  });
});

describe("scopePace", () => {
  const scopedQuarterRow = {
    sf_user_id: "005A",
    quarter: "FY27-Q1",
    signed_to_date: 90,
    weighted_open: 0,
    forecast: 0,
    custom_pipe: 0,
    target: 400,
    signed_n1: 0,
  } as const;

  it("prefers the per-row expected_to_date over the team-level pace meta", () => {
    const pace = scopePace(
      [{ ...scopedQuarterRow, expected_to_date: 100 }],
      {
        week_of_quarter: 1,
        weeks_in_quarter: 13,
        signed_to_date: 200,
        forecast: 0,
        target: 400,
        signed_n1: 0,
        expected_to_date: 300,
        run_rate: 2600,
        pace_ratio: 0,
        won_count: 4,
      },
      true,
    );
    expect(pace?.expected_to_date).toBe(100);
    expect(pace?.pace_ratio).toBeCloseTo(0.9);
  });

  it("hides won_count when the visible scope is narrower than the team", () => {
    const narrow = scopePace(
      [scopedQuarterRow],
      {
        week_of_quarter: 1,
        weeks_in_quarter: 13,
        signed_to_date: 0,
        forecast: 0,
        target: 400,
        signed_n1: 0,
        expected_to_date: 31,
        run_rate: 0,
        pace_ratio: null,
        won_count: 7,
      },
      false,
    );
    const full = scopePace(
      [scopedQuarterRow],
      {
        week_of_quarter: 1,
        weeks_in_quarter: 13,
        signed_to_date: 0,
        forecast: 0,
        target: 400,
        signed_n1: 0,
        expected_to_date: 31,
        run_rate: 0,
        pace_ratio: null,
        won_count: 7,
      },
      true,
    );
    expect(narrow?.won_count).toBeUndefined();
    expect(full?.won_count).toBe(7);
  });
});
