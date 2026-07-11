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
const mockFrom = vi.fn(() => ({ select: () => Promise.resolve({ data: teamProfiles, error: null }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mockFrom }) }));

import { GET } from "./perf.js";

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
    [{ OwnerId: "005A", CreatedDate: "2026-06-01T09:00:00.000Z", CloseDate: "2026-07-10", IsWon: true, IsClosed: true, StageName: "Fermée / Gagnée", Amount: 50 }],
    [
      { OwnerId: "005A", IsClosed: false, StageName: "Projet identifié" },
      { OwnerId: "005A", IsClosed: false, StageName: "Suspect enlisé" },
    ],
  ];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mockVerifyJWT.mockResolvedValue({ id: "user-a", email: "ada@xos-learning.fr" });
  mockGetProfile.mockResolvedValue({ sfUserId: "005A", fullName: "Ada", role: "commercial" });
  mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
  for (const records of recordSet()) mockSearchContacts.mockResolvedValueOnce({ records });
  // 7e requête : baseline pré-fenêtre des opps vues dans la fenêtre.
  mockSearchContacts.mockResolvedValueOnce({ records: [] });
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
    expect(body.pipeline.find((row) => row.week === week)).toMatchObject({ generated_count: 1, generated_amount: 100, won_count: 1, won_amount: 50, closing_rate_count: 1, closing_rate_amount: 0.5 });
    expect(body.effort.find((row) => row.week === week)).toMatchObject({ progressions: 1, open_opps_at_start: 1, effort_rate: 1 });
  });

  it("limits a commercial to their own Salesforce owner series", async () => {
    const records = recordSet();
    records[0].push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    mockSearchContacts.mockReset();
    for (const value of records) mockSearchContacts.mockResolvedValueOnce({ records: value });
    mockSearchContacts.mockResolvedValueOnce({ records: [] });
    const body = await (await GET(request())).json();
    expect(body.owners.map((owner) => owner.sf_user_id)).toEqual(["005A"]);
    expect(body.pulse.every((row) => row.sf_user_id === "005A")).toBe(true);
  });

  it("returns the team series to a manager", async () => {
    mockGetProfile.mockResolvedValue({ sfUserId: "005B", fullName: "Béa", role: "manager" });
    const records = recordSet();
    records[0].push({ OwnerId: "005B", ActivityDate: "2026-07-07", TaskSubtype: "Call" });
    mockSearchContacts.mockReset();
    for (const value of records) mockSearchContacts.mockResolvedValueOnce({ records: value });
    mockSearchContacts.mockResolvedValueOnce({ records: [] });
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

  it("counts the first in-window transition thanks to the pre-window baseline", async () => {
    const records = recordSet();
    // Fenêtre : une seule ligne d'historique (Proposition envoyée) — sans baseline, aucune progression.
    records[2] = [
      { OpportunityId: "opp-9", StageName: "Proposition envoyée", CreatedDate: "2026-07-07T09:00:00.000Z", CreatedById: "005A" },
    ];
    mockSearchContacts.mockReset();
    for (const value of records) mockSearchContacts.mockResolvedValueOnce({ records: value });
    mockSearchContacts.mockResolvedValueOnce({
      records: [{ OpportunityId: "opp-9", StageName: "Projet identifié" }],
    });

    const body = await (await GET(request())).json();
    const baselineQuery = mockSearchContacts.mock.calls[6][1];
    expect(baselineQuery).toContain("OpportunityId IN ('opp-9')");
    expect(baselineQuery).toContain("CreatedDate < 2026-05-18T00:00:00Z");
    expect(body.effort.find((row) => row.week === "2026-W28")).toMatchObject({ progressions: 1 });
  });

  it("sets the shared cache policy", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=60");
  });
});
