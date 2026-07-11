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
vi.mock("./_crm/salesforce.js", () => ({ fetchSFToken: mockFetchSFToken, searchContacts: mockSearchContacts, escapeSOQL: (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") }));

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
  return [
    [{ OwnerId: "005A", ActivityDate: "2026-07-07", TaskSubtype: "Call" }, { OwnerId: "005A", ActivityDate: "2026-07-07", TaskSubtype: "Email" }],
    [{ OwnerId: "005A", ActivityDate: "2026-07-08" }],
    [
      { OpportunityId: "opp-1", StageName: "Projet identifié", CreatedDate: "2026-06-30T09:00:00.000Z", CreatedById: "005A" },
      { OpportunityId: "opp-1", StageName: "Proposition envoyée", CreatedDate: "2026-07-07T09:00:00.000Z", CreatedById: "005A" },
      { OpportunityId: "opp-1", StageName: "XOS short-listé", CreatedDate: "2026-07-08T09:00:00.000Z", CreatedById: "005A" },
    ],
    [{ OwnerId: "005A", CreatedDate: "2026-07-09T09:00:00.000Z", CloseDate: "2026-07-10", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 100 }],
    [
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-10", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 50, Type_de_vente__c: "Catalogue", Type_de_commission__c: "Abonnement 3 ans" },
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-11", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 30, Type_de_vente__c: "LMS", Type_de_commission__c: null },
      { OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-12", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 20, Type_de_vente__c: "XOS+", Type_de_commission__c: null },
    ],
    [{ OwnerId: "005A", CloseDate: "2026-07-10", Amount: 50 }],
    [
      { OwnerId: "005A", IsClosed: false, StageName: "Projet identifié" },
      { OwnerId: "005A", IsClosed: false, StageName: "Suspect enlisé" },
    ],
    [{ OwnerId: "005A", CloseDate: "2026-07-10", Amount: 100 }],
    [
      { OwnerId: "005A", CloseDate: "2026-08-10", Amount: 200, Probability: 50 },
      { OwnerId: "005A", CloseDate: "2026-09-10", Amount: 100, Probability: 25 },
    ],
    [{ OwnerId: "005A", CloseDate: "2026-10-15", Amount: 300, Type_de_vente__c: "Sur-mesure" }],
  ];
}

function queueSalesforce(records = recordSet(), baseline = []) {
  mockSearchContacts.mockReset();
  let index = 0;
  mockSearchContacts.mockImplementation(async (_token, soql) => {
    if (soql.includes("FROM OpportunityHistory") && soql.includes("OpportunityId IN")) return { records: baseline };
    return { records: records[index++] || [] };
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
    if (table === "settings") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: { "005A": { "FY27-Q1": 60000 } } }, error: null }) }) }) };
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

  it("adds signed and probability-weighted open amounts", () => {
    expect(perf.quarterForecast(100, [{ Amount: 200, Probability: 50 }, { Amount: 100, Probability: 25 }], { amount: "Amount", probability: "Probability" })).toEqual({ weightedOpen: 125, forecast: 225 });
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
    expect(body.view).toBe("self");
    expect(body.pulse.find((row) => row.week === week)).toMatchObject({ sf_user_id: "005A", calls: 1, meetings: 1, proposals: 1 });
    expect(body.pipeline.find((row) => row.week === week)).toMatchObject({ generated_count: 1, generated_amount: 100, won_count: 3, won_amount: 100, closing_rate_count: 3, closing_rate_amount: 1 });
    expect(body.effort.find((row) => row.week === week)).toMatchObject({ progressions: 1, open_opps_at_start: 1, effort_rate: 1 });
  });

  it("limits a commercial to their own Salesforce owner series", async () => {
    const records = recordSet();
    records[0].push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    queueSalesforce(records);
    const body = await (await GET(request())).json();
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A"]);
    expect(body.pulse.every((row) => row.sf_user_id === "005A")).toBe(true);
  });

  it("returns the team series to a manager", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005B", fullName: "Béa", role: "manager" });
    const records = recordSet();
    records[0].push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    queueSalesforce(records);
    const body = await (await GET(request())).json();
    expect(body.view).toBe("team");
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A", "005B"]);
  });

  it("never quotes SOQL date or datetime literals (Salesforce rejects them)", async () => {
    await GET(request());
    const queries = mockSearchContacts.mock.calls.map(([, soql]) => soql);
    expect(queries.length).toBeGreaterThanOrEqual(6);
    for (const soql of queries) {
      expect(soql).not.toMatch(/[<>=] '\d{4}-\d{2}-\d{2}/);
    }
    const historyQuery = queries[2];
    expect(historyQuery).toContain("CreatedDate >= 2026-05-18T00:00:00Z");
  });

  it("builds ARR SOQL from the mapped field and four mapped commission values", async () => {
    await GET(request());
    const queries = mockSearchContacts.mock.calls.map(([, soql]) => soql);
    const arrQuery = queries.find((soql) => mapping.objects.opportunity.arrCommissionTypes.every((value) => soql.includes(`'${value}'`)));
    expect(arrQuery).toContain(mapping.objects.opportunity.saleTypeField);
    expect(arrQuery).toContain(mapping.objects.opportunity.commissionTypeField);
    expect(arrQuery).toContain(`'${mapping.objects.opportunity.saleTypes.catalogue[0]}'`);
  });

  it("aggregates tracked sale types without bucketing LMS or XOS+, plus ARR and quarter metrics", async () => {
    const body = await (await GET(request())).json();
    expect(Object.keys(mapping.objects.opportunity.saleTypes)).toEqual(["catalogue", "sur_mesure", "conseil"]);
    expect(body.pipeline.find((row) => row.week === "2026-W28")).toMatchObject({
      won_amount: 100,
      won_by_type: { catalogue: 50, sur_mesure: 0, conseil: 0 },
      won_arr_amount: 50,
    });
    expect(body.quarter).toEqual([{
      sf_user_id: "005A",
      quarter: "FY27-Q1",
      signed_to_date: 100,
      weighted_open: 125,
      forecast: 225,
      custom_pipe: 300,
      target: 60000,
    }]);
  });

  it("returns a null target when weekly_targets is absent", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request())).json();
    expect(body.quarter[0].target).toBeNull();
  });

  it("keeps an explicitly null owner target null", async () => {
    mockFrom.mockImplementation((table) => {
      if (table === "profiles") return { select: () => Promise.resolve({ data: teamProfiles, error: null }) };
      if (table === "settings") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: { "005A": { "FY27-Q1": null } } }, error: null }) }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    const body = await (await GET(request())).json();
    expect(body.quarter[0].target).toBeNull();
  });

  it("counts the first in-window transition thanks to the pre-window baseline", async () => {
    const records = recordSet();
    // Fenêtre : une seule ligne d'historique (Proposition envoyée) — sans baseline, aucune progression.
    records[2] = [
      { OpportunityId: "opp-9", StageName: "Proposition envoyée", CreatedDate: "2026-07-07T09:00:00.000Z", CreatedById: "005A" },
    ];
    queueSalesforce(records, [{ OpportunityId: "opp-9", StageName: "Projet identifié" }]);

    const body = await (await GET(request())).json();
    const baselineQuery = mockSearchContacts.mock.calls.at(-1)[1];
    expect(baselineQuery).toContain("OpportunityId IN ('opp-9')");
    expect(baselineQuery).toContain("CreatedDate < 2026-05-18T00:00:00Z");
    expect(body.effort.find((row) => row.week === "2026-W28")).toMatchObject({ progressions: 1 });
  });

  it("sets the shared cache policy", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=60");
  });
});
