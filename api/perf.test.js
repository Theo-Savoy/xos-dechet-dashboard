import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyJWT, mockGetProfile, mockFetchSFToken, mockSearchContacts } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockGetProfile: vi.fn(),
  mockFetchSFToken: vi.fn(),
  mockSearchContacts: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  respond: (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
  verifyJWT: mockVerifyJWT,
}));
vi.mock("./_calls/profileCache.js", () => ({ getProfile: mockGetProfile }));
vi.mock("./_crm/salesforce.js", () => ({
  fetchSFToken: mockFetchSFToken,
  searchContacts: mockSearchContacts,
  escapeSOQL: (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'"),
  buildLightningUrl: (type, id) => (id ? `https://sf.test/lightning/r/${type}/${id}/view` : null),
}));

const teamProfiles = [
  { id: "user-a", email: "ada@xos-learning.fr", full_name: "Ada", sf_user_id: "005A", role: "commercial" },
  { id: "user-b", email: "bea@xos-learning.fr", full_name: "Béa", sf_user_id: "005B", role: "manager" },
];
const mockFrom = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mockFrom }) }));

import mapping from "./_crm/mapping.js";
import * as perf from "./perf.js";

const { GET } = perf;

function request(query = "") {
  return new Request(`https://xos.test/api/perf${query}`, { headers: { Authorization: "Bearer token" } });
}

function recordSet() {
  return {
    tasks: [{ OwnerId: "005A", ActivityDate: "2026-07-07", TaskSubtype: "Call" }, { OwnerId: "005A", ActivityDate: "2026-07-07", TaskSubtype: "Email" }],
    events: [{ OwnerId: "005A", ActivityDate: "2026-07-08" }],
    histories: [
      { OpportunityId: "opp-1", StageName: "Projet identifié", CreatedDate: "2026-06-30T09:00:00.000Z", CreatedById: "005A" },
      { OpportunityId: "opp-1", StageName: "Proposition envoyée", CreatedDate: "2026-07-07T09:00:00.000Z", CreatedById: "005A" },
      { OpportunityId: "opp-1", StageName: "XOS short-listé", CreatedDate: "2026-07-08T09:00:00.000Z", CreatedById: "005A" },
    ],
    generated: [{ OwnerId: "005A", CreatedDate: "2026-07-09T09:00:00.000Z", CloseDate: "2026-07-10", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 100 }],
    won: [
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-10", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 50, Type_de_vente__c: "Catalogue", Type_de_commission__c: "Abonnement 3 ans" },
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-11", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 30, Type_de_vente__c: "LMS", Type_de_commission__c: null },
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-12", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 20, Type_de_vente__c: "XOS+", Type_de_commission__c: null },
    ],
    openOpps: [
      { Id: "006OPEN", Name: "Deal froid", OwnerId: "005A", IsClosed: false, StageName: "Proposition envoyée", Amount: 12000, Probability: 40, ExpectedRevenue: 4800, CloseDate: "2026-08-20", CreatedDate: "2026-04-01", LastActivityDate: null, LastStageChangeDate: "2026-04-15", "Account.Name": "Acme" },
      { OwnerId: "005A", IsClosed: false, StageName: "Suspect enlisé", Amount: 5000, Probability: 10 },
      { Id: "006Q1", Name: "Deal TQ", OwnerId: "005A", IsClosed: false, CloseDate: "2026-08-10", Amount: 200, Probability: 50, ExpectedRevenue: 100, StageName: "XOS recommandé", "Account.Name": "TQ" },
      { Id: "006Q2", Name: "Deal TQ 2", OwnerId: "005A", IsClosed: false, CloseDate: "2026-09-10", Amount: 100, Probability: 25, ExpectedRevenue: 25, StageName: "Projet identifié", "Account.Name": "TQ2" },
    ],
    quarterWon: [{ OwnerId: "005A", CloseDate: "2026-07-10", Amount: 100 }],
    quarterOpen: [
      { Id: "006Q1", Name: "Deal TQ", OwnerId: "005A", CloseDate: "2026-08-10", Amount: 200, Probability: 50, ExpectedRevenue: 100, StageName: "XOS recommandé" },
      { Id: "006Q2", Name: "Deal TQ 2", OwnerId: "005A", CloseDate: "2026-09-10", Amount: 100, Probability: 25, ExpectedRevenue: 25, StageName: "Projet identifié" },
    ],
    customOpen: [{ OwnerId: "005A", CloseDate: "2026-10-15", Amount: 300, Type_de_vente__c: "Sur-mesure", ExpectedRevenue: 150, Probability: 50, Id: "006SM", Name: "Deal SM" }],
    priorWon: [{ OwnerId: "005A", CloseDate: "2025-07-10", Amount: 80 }],
  };
}

function queueSalesforce(records = recordSet(), baseline = []) {
  mockSearchContacts.mockReset();
  mockSearchContacts.mockImplementation(async (_token, soql) => {
    if (soql.includes("FROM OpportunityHistory") && soql.includes("OpportunityId IN")) return { records: baseline };
    if (soql.includes("FROM OpportunityHistory")) return { records: records.histories };
    if (soql.includes("FROM User")) {
      return {
        records: [
          { Id: "005A", Name: "Ada", Email: "ada@xos-learning.fr", IsActive: true },
          { Id: "005B", Name: "Béa", Email: "bea@xos-learning.fr", IsActive: true },
        ],
      };
    }
    if (soql.includes("CALENDAR_YEAR") || soql.includes("CALENDAR_MONTH")) return { records: [] };
    if (soql.includes("TaskSubtype") || /\bFROM Task\b/.test(soql)) return { records: records.tasks };
    if (/\bFROM Event\b/.test(soql)) return { records: records.events };
    if (soql.includes("LastActivityDate") || soql.includes("LastStageChangeDate")) return { records: records.openOpps };
    if (soql.includes("Sur-mesure") || soql.includes("sur_mesure")) return { records: records.customOpen };
    if (soql.includes("IsWon = true") && soql.includes("2025-07-01")) return { records: records.priorWon };
    if (soql.includes("IsWon = true") && soql.includes("2026-07-01") && !soql.includes("CreatedDate")) return { records: records.quarterWon };
    if (soql.includes("IsWon = true")) return { records: records.won };
    if (soql.includes("IsClosed = false") && soql.includes("CloseDate >=") && soql.includes("2026-07-01")) return { records: records.quarterOpen };
    if (soql.includes("CreatedDate >=")) return { records: records.generated };
    return { records: [] };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mockFrom.mockImplementation((table) => {
    if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
    if (table === "settings") {
      return {
        select: () => ({
          eq: (_col, key) => ({
            maybeSingle: () => Promise.resolve({
              data: key === "weekly_targets" ? { value: { "005A": { "FY27-Q1": 60000 } } } : { value: {} },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "perf_forecast_snapshots") {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      };
    }
    if (table === "perf_week_snapshots") {
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      };
    }
    if (table === "perf_seasonality_cache") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  mockVerifyJWT.mockResolvedValue({ id: "user-a", email: "ada@xos-learning.fr" });
  mockGetProfile.mockResolvedValue({ sfUserId: "005A", fullName: "Ada", role: "commercial" });
  mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
  queueSalesforce();
});

describe("fiscal quarter helpers", () => {
  it("computes the January quarter in the fiscal year named by its ending year", () => {
    expect(perf.fiscalQuarter("2026-01-15")).toEqual({ from: "2026-01-01", toExclusive: "2026-04-01", label: "FY26-Q3" });
  });

  it("computes the August quarter across the July fiscal-year boundary", () => {
    expect(perf.fiscalQuarter("2026-08-20")).toEqual({ from: "2026-07-01", toExclusive: "2026-10-01", label: "FY27-Q1" });
  });

  it("builds the week window for the full fiscal quarter including future weeks", () => {
    expect(perf.quarterWeekWindow("2026-07-11")).toMatchObject({
      from: "2026-07-06",
      to: "2026-07-12",
      period: "quarter",
    });
    const window = perf.quarterWeekWindow("2026-07-11");
    expect(window.starts[0]).toBe("2026-07-06");
    expect(window.starts.at(-1)).toBe("2026-09-28");
    expect(window.starts).toHaveLength(13);
  });

  it("adds signed and probability-weighted open amounts", () => {
    expect(perf.quarterForecast(100, [{ Amount: 200, Probability: 50 }, { Amount: 100, Probability: 25 }], { amount: "Amount", probability: "Probability" })).toEqual({ weightedOpen: 125, forecast: 225 });
  });

  it("builds prior fiscal quarter one year earlier", () => {
    expect(perf.priorFiscalQuarter("2026-07-11")).toEqual({ from: "2025-07-01", toExclusive: "2025-10-01", label: "FY26-Q1" });
  });

  it("builds seasonality weights for year and month-in-quarter", () => {
    const seasonality = perf.buildSeasonality([
      { year: 2024, month: 7, amount: 100 },
      { year: 2025, month: 7, amount: 100 },
      { year: 2024, month: 8, amount: 50 },
      { year: 2024, month: 9, amount: 50 },
    ], "2026-07-11");
    expect(seasonality.month_of_year["07"]).toBeCloseTo(200 / 300, 5);
    expect(seasonality.month_in_quarter.Q1["07"]).toBeCloseTo(200 / 300, 5);
    expect(seasonality.quarter_of_year.Q1).toBeCloseTo(1, 5);
    const expected = perf.seasonalExpectedToDate(30000, "2026-07-15", { label: "FY27-Q1" }, seasonality);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(30000);
  });

  it("ranks follow-up opps by expected revenue", () => {
    const fields = { id: "Id", name: "Name", ownerId: "OwnerId", stageName: "StageName", amount: "Amount", probability: "Probability", expectedRevenue: "ExpectedRevenue", closeDate: "CloseDate" };
    const rows = perf.buildFollowUpOpps([
      { Id: "1", Name: "A", OwnerId: "005A", StageName: "XOS recommandé", Amount: 10000, Probability: 10, ExpectedRevenue: 1000, CloseDate: "2026-08-01" },
      { Id: "2", Name: "B", OwnerId: "005A", StageName: "Négo financière engagée", Amount: 8000, Probability: 50, ExpectedRevenue: 4000, CloseDate: "2026-08-15" },
    ], fields, ["005A"]);
    expect(rows.map((row) => row.id)).toEqual(["2", "1"]);
    expect(rows[0].expected).toBe(4000);
  });

  it("flags stagnant opps for long stage and silence", () => {
    const fields = {
      id: "Id", name: "Name", ownerId: "OwnerId", isClosed: "IsClosed", stageName: "StageName", amount: "Amount",
      probability: "Probability", expectedRevenue: "ExpectedRevenue", closeDate: "CloseDate", createdDate: "CreatedDate",
      lastActivityDate: "LastActivityDate", lastStageChangeDate: "LastStageChangeDate",
    };
    const rows = perf.buildStagnantOpps([
      { Id: "1", Name: "Silence", OwnerId: "005A", IsClosed: false, StageName: "XOS recommandé", Amount: 5000, Probability: 20, ExpectedRevenue: 1000, CloseDate: "2026-08-01", CreatedDate: "2026-06-01", LastActivityDate: "2026-05-01", LastStageChangeDate: "2026-06-20" },
      { Id: "2", Name: "Fresh", OwnerId: "005A", IsClosed: false, StageName: "XOS recommandé", Amount: 5000, Probability: 20, ExpectedRevenue: 1000, CloseDate: "2026-08-01", CreatedDate: "2026-07-01", LastActivityDate: "2026-07-10", LastStageChangeDate: "2026-07-08" },
    ], fields, ["005A"], "2026-07-11");
    expect(rows.map((row) => row.id)).toEqual(["1"]);
    expect(rows[0].reasons).toEqual(expect.arrayContaining(["silence"]));
  });
});

describe("GET /api/perf", () => {
  it("returns 401 without a JWT", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });

  it("aggregates the W28 pilot week by owner using the frozen metric definitions", async () => {
    const response = await GET(request());
    const body = await response.json();
    const week = "2026-W28";
    expect(body.view).toBe("team");
    expect(body.pulse.find((row) => row.week === week)).toMatchObject({ sf_user_id: "005A", calls: 1, meetings: 1, proposals: 1 });
    expect(body.pipeline.find((row) => row.week === week)).toMatchObject({ generated_count: 1, generated_amount: 100, won_count: 3, won_amount: 100, closing_rate_count: 3, closing_rate_amount: 1 });
    expect(body.effort.find((row) => row.week === week)).toMatchObject({ progressions: 1, open_opps_at_start: 3, effort_rate: 1 / 3 });
  });

  it("returns the team roster to a commercial for the Moi/Équipe toggle", async () => {
    const records = recordSet();
    records.tasks.push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    queueSalesforce(records);
    const body = await (await GET(request())).json();
    expect(body.view).toBe("team");
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A", "005B"]);
    expect(body.pulse.some((row) => row.sf_user_id === "005B")).toBe(true);
  });

  it("returns the team series to a manager", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005B", fullName: "Béa", role: "manager" });
    const records = recordSet();
    records.tasks.push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    queueSalesforce(records);
    const body = await (await GET(request())).json();
    expect(body.view).toBe("team");
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A", "005B"]);
  });

  it("never quotes SOQL date or datetime literals (Salesforce rejects them)", async () => {
    await GET(request("?weeks=8"));
    const queries = mockSearchContacts.mock.calls.map(([, soql]) => soql);
    expect(queries.length).toBeGreaterThanOrEqual(6);
    for (const soql of queries) {
      expect(soql).not.toMatch(/[<>=] '\d{4}-\d{2}-\d{2}/);
    }
    const historyQuery = queries[2];
    expect(historyQuery).toContain("CreatedDate >= 2026-05-18T00:00:00Z");
  });

  it("loads won deals once and derives ARR in JS from mapped commission types", async () => {
    await GET(request());
    const queries = mockSearchContacts.mock.calls.map(([, soql]) => soql);
    const wonQueries = queries.filter((soql) => soql.includes("IsWon = true") && soql.includes(mapping.objects.opportunity.commissionTypeField));
    expect(wonQueries.length).toBeGreaterThan(0);
    expect(wonQueries.some((soql) => mapping.objects.opportunity.arrCommissionTypes.every((value) => soql.includes(`'${value}'`)))).toBe(false);
    expect(wonQueries[0]).toContain(mapping.objects.opportunity.saleTypeField);
    expect(wonQueries[0]).toContain(mapping.objects.opportunity.commissionTypeField);
  });

  it("aggregates tracked sale types without bucketing LMS or XOS+, plus ARR and quarter metrics", async () => {
    const body = await (await GET(request())).json();
    expect(Object.keys(mapping.objects.opportunity.saleTypes)).toEqual(["catalogue", "sur_mesure", "conseil"]);
    expect(body.pipeline.find((row) => row.week === "2026-W28")).toMatchObject({
      won_amount: 100,
      won_by_type: { catalogue: 50, sur_mesure: 0, conseil: 0 },
      won_arr_amount: 50,
    });
    expect(body.quarter[0]).toMatchObject({
      sf_user_id: "005A",
      quarter: "FY27-Q1",
      signed_to_date: 100,
      weighted_open: 4925,
      forecast: 5025,
      custom_pipe: 300,
      target: 60000,
      signed_n1: 80,
      expected_to_date: expect.any(Number),
      pace_ratio: expect.any(Number),
    });
    expect(body.follow_up_opps[0]).toMatchObject({ id: "006OPEN", expected: 4800 });
    expect(body.stagnant_opps.some((row) => row.id === "006OPEN")).toBe(true);
    expect(body.pace).toMatchObject({ week_of_quarter: 1, signed_to_date: 100, signed_n1: 80, target: 60000 });
    // Saisonnalité calculée même en vue semaine (Bug 5) pour que le strip Pace affiche
    // un attendu cohérent entre les onglets Semaine et Trimestre.
    expect(body.seasonality).toMatchObject({ month_of_year: expect.any(Object), month_in_quarter: expect.any(Object) });
    expect(body.pulse.find((row) => row.week === "2026-W28")?.call_results).toEqual(expect.any(Object));

    const quarterBody = await (await GET(request("?period=quarter"))).json();
    expect(quarterBody.seasonality).toMatchObject({ month_of_year: expect.any(Object), month_in_quarter: expect.any(Object) });
  });

  it("returns a null target when weekly_targets is absent", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      if (table === "perf_forecast_snapshots") return { select: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }), upsert: () => Promise.resolve({ error: null }) };
      if (table === "perf_week_snapshots") return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }), in: () => Promise.resolve({ data: [], error: null }) }), upsert: () => Promise.resolve({ error: null }) };
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request())).json();
    expect(body.quarter[0].target).toBeNull();
  });

  it("keeps an explicitly null owner target null", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") {
        return {
          select: () => ({
            eq: (_col, key) => ({
              maybeSingle: () => Promise.resolve({
                data: key === "weekly_targets" ? { value: { "005A": { "FY27-Q1": null } } } : { value: {} },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "perf_forecast_snapshots") return { select: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }), upsert: () => Promise.resolve({ error: null }) };
      if (table === "perf_week_snapshots") return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }), in: () => Promise.resolve({ data: [], error: null }) }), upsert: () => Promise.resolve({ error: null }) };
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request())).json();
    expect(body.quarter[0].target).toBeNull();
  });

  it("attaches tracking modes and prefers profile names over Salesforce ids", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005A", fullName: "Ada", role: "manager" });
    const body = await (await GET(request())).json();
    expect(body.owners[0]).toMatchObject({ sf_user_id: "005A", name: "Ada", tracking: "commercial" });
    expect(body.owners[0].name).not.toMatch(/^005/);
  });

  it("counts the first in-window transition thanks to the pre-window baseline", async () => {
    const records = recordSet();
    // Fenêtre : une seule ligne d'historique (Proposition envoyée) — sans baseline, aucune progression.
    records.histories = [
      { OpportunityId: "opp-9", StageName: "Proposition envoyée", CreatedDate: "2026-07-07T09:00:00.000Z", CreatedById: "005A" },
    ];
    queueSalesforce(records, [{ OpportunityId: "opp-9", StageName: "Projet identifié" }]);

    const body = await (await GET(request("?weeks=8"))).json();
    const baselineQuery = mockSearchContacts.mock.calls.map(([, soql]) => soql).find((soql) => soql.includes("OpportunityId IN ('opp-9')"));
    expect(baselineQuery).toContain("CreatedDate < 2026-05-18T00:00:00Z");
    expect(body.effort.find((row) => row.week === "2026-W28")).toMatchObject({ progressions: 1 });
  });

  it("returns forecast history points for the effort chart", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005A", fullName: "Ada", role: "commercial" });
    const body = await (await GET(request())).json();
    expect(body.forecast_history.length).toBeGreaterThan(0);
    const ada = body.forecast_history.find((row) => row.sf_user_id === "005A" && row.week === "2026-W28");
    expect(ada).toMatchObject({
      sf_user_id: "005A",
      forecast: 5025,
      signed_to_date: 100,
    });
  });

  it("returns custom_pipe monthly buckets with expected revenue", async () => {
    const body = await (await GET(request())).json();
    expect(body.custom_pipe).toMatchObject({
      horizon_days: 180,
      total_amount: 300,
      total_expected: 150,
      count: 1,
    });
    expect(body.custom_pipe.months.find((month) => month.month === "2026-10")).toMatchObject({ amount: 300, expected: 150, count: 1 });
    expect(body.custom_pipe.opps[0]).toMatchObject({ name: "Deal SM", expected: 150 });
  });

  it("builds custom pipe months from today even when empty", () => {
    expect(perf.buildCustomPipe([], { ownerId: "OwnerId", closeDate: "CloseDate", amount: "Amount", probability: "Probability", expectedRevenue: "ExpectedRevenue", id: "Id", name: "Name" }, "2026-07-11").months.map((month) => month.month)).toEqual([
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
  });

  it("excludes inactive former commercials from the team roster", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005B", fullName: "Béa", role: "manager" });
    const records = recordSet();
    records.tasks.push(
      { OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" },
      { OwnerId: "005R", ActivityDate: "2026-07-07", TaskSubtype: "Call" },
    );
    queueSalesforce(records);
    const original = mockSearchContacts.getMockImplementation();
    mockSearchContacts.mockImplementation(async (token, soql) => {
      if (soql.includes("FROM User")) {
        return {
          records: [
            { Id: "005A", Name: "Ada", Email: "ada@xos-learning.fr", IsActive: true },
            { Id: "005B", Name: "Béa", Email: "bea@xos-learning.fr", IsActive: true },
            { Id: "005R", Name: "Romain Waeselynck", Email: "romain@xos-learning.fr", IsActive: false },
          ],
        };
      }
      return original(token, soql);
    });
    const body = await (await GET(request("?weeks=8"))).json();
    expect(body.owners.map((owner) => owner.sf_user_id).sort()).toEqual(["005A", "005B"]);
    expect(body.owners.some((owner) => /waeselynck/i.test(owner.name))).toBe(false);
  });

  it("discovers SF owners when profiles only has an excluded admin", async () => {
    mockGetProfile.mockResolvedValue({
      sfUserId: "005T",
      fullName: "Théo Savoy",
      email: "theo.savoy@xos-learning.fr",
      role: "admin",
    });
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") {
        return {
          select: () => Promise.resolve({
            data: [{ id: "user-t", email: "theo.savoy@xos-learning.fr", full_name: "Théo Savoy", sf_user_id: "005T", role: "admin" }],
            error: null,
          }),
        };
      }
      if (table === "settings") {
        return {
          select: () => ({
            eq: (_col, key) => ({
              maybeSingle: () => Promise.resolve({
                data: key === "weekly_targets" ? { value: {} } : { value: {} },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "perf_forecast_snapshots") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "perf_week_snapshots") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
            in: () => Promise.resolve({ data: [], error: null }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "perf_seasonality_cache") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    queueSalesforce();
    const soql = [];
    const original = mockSearchContacts.getMockImplementation();
    mockSearchContacts.mockImplementation(async (token, queryText) => {
      soql.push(queryText);
      if (queryText.includes("FROM User")) {
        return {
          records: [
            { Id: "005A", Name: "Ada", Email: "ada@xos-learning.fr", IsActive: true },
            { Id: "005T", Name: "Théo Savoy", Email: "theo.savoy@xos-learning.fr", IsActive: true },
          ],
        };
      }
      return original(token, queryText);
    });
    const body = await (await GET(request("?weeks=8"))).json();
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A"]);
    expect(body.owners.some((owner) => /th[eé]o/i.test(owner.name))).toBe(false);
    // Sans commercials mappés, les SOQL ne doivent pas filtrer sur le seul admin exclu.
    expect(soql.some((q) => /OwnerId IN \('005T'\)/.test(q) || /CreatedById IN \('005T'\)/.test(q))).toBe(false);
  });

  it("sets the shared cache policy", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=30, stale-while-revalidate=120");
  });

  it("lite mode skips heavy open-opp queries and reports timing", async () => {
    const soql = [];
    const original = mockSearchContacts.getMockImplementation();
    mockSearchContacts.mockImplementation(async (token, queryText) => {
      soql.push(queryText);
      return original(token, queryText);
    });
    const response = await GET(request("?lite=1"));
    const body = await response.json();
    expect(body.context.lite).toBe(true);
    expect(typeof body.context.timing_ms).toBe("number");
    expect(response.headers.get("Server-Timing")).toMatch(/perf;dur=\d+/);
    expect(soql.some((q) => /LastActivityDate|LastStageChangeDate/.test(q))).toBe(false);
    expect(body.follow_up_opps).toEqual([]);
    expect(body.stagnant_opps).toEqual([]);
  });

  it("enrich returns board payload without replaying the week pulse queries", async () => {
    const soql = [];
    const original = mockSearchContacts.getMockImplementation();
    mockSearchContacts.mockImplementation(async (token, queryText) => {
      soql.push(queryText);
      return original(token, queryText);
    });
    const body = await (await GET(request("?enrich=1"))).json();
    expect(body.context.enrich).toBe(true);
    expect(body.stagnant_opps.some((row) => row.id === "006OPEN")).toBe(true);
    expect(body.follow_up_opps.some((row) => row.id === "006Q1")).toBe(true);
    expect(body.follow_up_opps[0]).toMatchObject({ id: "006OPEN" });
    expect(body.custom_pipe.count).toBeGreaterThan(0);
    expect(soql.some((q) => q.includes("TaskSubtype"))).toBe(false);
    expect(soql.some((q) => q.includes("OpportunityHistory") && q.includes("CreatedDate >="))).toBe(false);
  });

  // Bug 1 — les rows N−1 doivent partager les week_start du TQ courant pour matcher l’indexation front (`sf_user_id:week_start`).
  it("aligns prior_pulse and prior_pipeline week_start on the current quarter", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") {
        return {
          select: () => ({
            eq: (_col, key) => ({
              maybeSingle: () => Promise.resolve({
                data: key === "weekly_targets" ? { value: { "005A": { "FY27-Q1": 60000 } } } : { value: {} },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "perf_forecast_snapshots") {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      if (table === "perf_week_snapshots") {
        const priorSnapshot = {
          week_start: "2025-07-06",
          sf_user_id: "005A",
          iso_week: "2025-W28",
          quarter: "FY26-Q1",
          calls: 5,
          meetings: 2,
          proposals: 1,
          progressions: 0,
          call_results: {},
          generated_count: 1,
          generated_amount: 1000,
          won_count: 1,
          won_amount: 500,
          won_catalogue: 500,
          won_sur_mesure: 0,
          won_conseil: 0,
          won_arr_amount: 0,
          signed_to_date: 0,
          forecast: 0,
        };
        return {
          select: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            in: () => Promise.resolve({ data: [priorSnapshot], error: null }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "perf_seasonality_cache") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request("?period=quarter"))).json();
    const quarterStarts = perf.quarterWeekWindow("2026-07-11").starts;
    expect(body.prior_pulse.length).toBeGreaterThan(0);
    expect(body.prior_pipeline.length).toBeGreaterThan(0);
    expect(body.prior_pulse[0]).toMatchObject({ sf_user_id: "005A", week_start: "2026-07-06" });
    expect(body.prior_pipeline[0]).toMatchObject({ sf_user_id: "005A", week_start: "2026-07-06" });
    expect(body.prior_pulse.every((row) => quarterStarts.includes(row.week_start))).toBe(true);
    expect(body.prior_pipeline.every((row) => quarterStarts.includes(row.week_start))).toBe(true);
    // Le champ `week` (iso) doit rester la vraie semaine N−1.
    expect(body.prior_pulse[0].week).toBe("2025-W28");
  });

  // Bug 2 — chemin snapshot : le target doit lire l’entrée `{ ownerId: { quarterLabel: amount } }` et non Number(targetEntry).
  it("reads the per-quarter target from weekly_targets in the snapshot path", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") {
        return {
          select: () => ({
            eq: (_col, key) => ({
              maybeSingle: () => Promise.resolve({
                data: key === "weekly_targets" ? { value: { "005A": { "FY26-Q4": 60000 } } } : { value: {} },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "perf_week_snapshots") {
        const snapshot = {
          week_start: "2026-06-29",
          sf_user_id: "005A",
          iso_week: "2026-W27",
          quarter: "FY26-Q4",
          calls: 0,
          meetings: 0,
          proposals: 0,
          progressions: 0,
          call_results: {},
          generated_count: 0,
          generated_amount: 0,
          won_count: 0,
          won_amount: 0,
          won_catalogue: 0,
          won_sur_mesure: 0,
          won_conseil: 0,
          won_arr_amount: 0,
          signed_to_date: 0,
          forecast: 0,
        };
        return {
          select: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            in: () => Promise.resolve({ data: [snapshot], error: null }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "perf_forecast_snapshots") {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      if (table === "perf_seasonality_cache") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), upsert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request("?week_start=2026-06-29"))).json();
    expect(body.context.source).toBe("snapshot");
    expect(body.context.quarter_label).toBe("FY26-Q4");
    expect(body.quarter[0]).toMatchObject({ sf_user_id: "005A", quarter: "FY26-Q4", target: 60000 });
  });

  // Bug 3 — semaine à cheval : le rattachement fiscal suit le LUNDI, pas le dimanche.
  it("anchors the fiscal quarter on the week’s Monday, not its Sunday", async () => {
    const body = await (await GET(request("?week_start=2026-06-29"))).json();
    expect(body.context.quarter_label).toBe("FY26-Q4");
    expect(body.context.anchor_week_start).toBe("2026-06-29");
  });

  // Bug 4 — buildCustomPipe : cohérence KPI ↔ graphe (un record hors buckets ne doit pas polluer count/by_owner/opps).
  it("ignores sur-mesure records that fall outside the 6 monthly buckets", () => {
    const fields = {
      ownerId: "OwnerId",
      closeDate: "CloseDate",
      amount: "Amount",
      probability: "Probability",
      expectedRevenue: "ExpectedRevenue",
      id: "Id",
      name: "Name",
    };
    const result = perf.buildCustomPipe(
      [
        { Id: "006SM", OwnerId: "005A", CloseDate: "2026-10-15", Amount: 300, ExpectedRevenue: 150, Probability: 50, Name: "Deal SM" },
        // Dans l'horizon 181 j (customToExclusive = 2027-01-08) mais hors des 6 buckets (7e mois).
        { Id: "006SM2", OwnerId: "005A", CloseDate: "2027-01-05", Amount: 999, ExpectedRevenue: 500, Probability: 50, Name: "Deal H+7" },
      ],
      fields,
      "2026-07-11",
    );
    expect(result.count).toBe(1);
    expect(result.total_amount).toBe(300);
    expect(result.total_expected).toBe(150);
    expect(result.by_owner).toEqual([{ sf_user_id: "005A", amount: 300, expected: 150, count: 1 }]);
    expect(result.opps).toHaveLength(1);
    const monthsFlat = result.months.flatMap((m) => [m.amount, m.expected, m.count]);
    expect(monthsFlat).not.toContain(999);
    expect(monthsFlat).not.toContain(500);
  });

  // Bug 5 — le strip Pace doit afficher un attendu saisonnier en onglet Semaine comme en Trimestre.
  it("computes a seasonal expected pace in week mode (consistent with quarter tab)", async () => {
    const body = await (await GET(request())).json();
    expect(body.pace).toMatchObject({ expected_mode: "seasonal" });
    expect(body.seasonality).toMatchObject({ month_in_quarter: expect.any(Object) });
  });

  // Bug 1 (fallback SF) — avec perf_week_snapshots vide, priorSeriesFromSnapshots retourne
  // null et le fallback SF prend le relais. Le remap doit rester correct même si SF renvoie
  // des OwnerId sous une variante de longueur différente (18 chars) qui crée des rows
  // supplémentaires via row() hors ownerIds ; le test couvre l’alignement sur les starts du TQ courant.
  it("aligns prior_pulse and prior_pipeline week_start on the SF-fallback path (empty snapshots)", async () => {
    // Mocks par défaut : perf_week_snapshots → data: [] → priorSeriesFromSnapshots → null → fallback SF.
    const body = await (await GET(request("?period=quarter"))).json();
    const quarterStarts = perf.quarterWeekWindow("2026-07-11").starts;
    expect(body.prior_pulse.length).toBeGreaterThan(0);
    expect(body.prior_pipeline.length).toBeGreaterThan(0);
    expect(body.prior_pulse.every((row) => quarterStarts.includes(row.week_start))).toBe(true);
    expect(body.prior_pipeline.every((row) => quarterStarts.includes(row.week_start))).toBe(true);
  });
});
