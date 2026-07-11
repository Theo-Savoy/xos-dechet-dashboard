import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  boundedLimit,
  buildTargetQuery,
  escapeSOQL,
  filterTargetContacts,
  hasRelanceQueryFilters,
  SOQL_FETCH_CAP,
} from "./_crm/salesforce.js";
import mapping from "./_crm/mapping.js";
import { FONCTION_PRESETS } from "../src/crm/index.ts";
import { POST } from "./calls.js";

const { mockVerifyJWT } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
  respond: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle, eq: mockEq, in: () => mockChain }));
const mockIn = vi.fn(() => mockChain);
const mockSelect = vi.fn(() => ({ eq: mockEq, in: mockIn, select: mockSelect }));
const mockChain = { eq: mockEq, in: mockIn, select: mockSelect };
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function makeReq(body, token = "supabase-jwt-token") {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  return new Request("http://localhost/api/calls", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify({ action: "list_contacts", ...body }),
  });
}

function makeRawReq(rawBody) {
  const headers = new Headers({
    Authorization: "Bearer supabase-jwt-token",
    "Content-Type": "application/json",
  });
  return new Request("http://localhost/api/calls", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

const baseFilters = {
  entreprise: { secteurs: ["Finance"] },
  contact: { a_telephone: true },
  relance: {},
};

const SF_RECORDS = [
  {
    Id: "003000000000001AAA",
    Name: "Marie Dupont",
    Phone: "+33123456789",
    Title: "Responsable formation",
    Profil_Linkedin__c: "https://linkedin.com/in/marie",
    Email: "marie@acme.fr",
    MobilePhone: "+33600000000",
    AccountId: "001000000000001AAA",
    Account: { Id: "001000000000001AAA", Name: "ACME" },
    Tasks: { totalSize: 1, records: [{ ActivityDate: "2026-07-01", Resultat_call__c: "Appel décroché", CallDurationInSeconds: 60 }] },
  },
];

describe("adapter exports", () => {
  it("fonctionPresets mirror front FONCTION_PRESETS ids and labels", () => {
    const backend = mapping.objects.contact.fonctionPresets;
    expect(FONCTION_PRESETS.map((preset) => preset.id)).toEqual(backend.map((preset) => preset.id));
    expect(FONCTION_PRESETS.map((preset) => preset.label)).toEqual(backend.map((preset) => preset.label));
  });

  it("escapeSOQL escapes quotes and backslashes", () => {
    expect(escapeSOQL("O'Brien")).toBe("O\\'Brien");
    expect(escapeSOQL("path\\to")).toBe("path\\\\to");
  });

  it("buildTargetQuery uses mapping field names for v2 filter tree", () => {
    const soql = buildTargetQuery(baseFilters, mapping, "005000000000001AAA");
    expect(soql).toContain(`Account.${mapping.objects.account.fields.industry} IN ('Finance')`);
    expect(soql).toContain(`${mapping.objects.contact.fields.mobilePhone} != null`);
    expect(soql).toContain(`${mapping.objects.contact.fields.doNotCall} = false`);
    expect(soql).toContain(`${mapping.objects.contact.fields.inactive} = false`);
    expect(soql).toContain(`${mapping.objects.contact.fields.title}`);
    expect(soql).toContain(`${mapping.objects.contact.fields.linkedin}`);
    expect(soql).not.toMatch(/NOT IN \(SELECT .* FROM Task/);
    expect(soql).toContain("LIMIT 200");
  });

  it("buildTargetQuery adds Account tier filter", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, tiers: ["A", "B"] } },
      mapping,
      null,
    );
    expect(soql).toContain(`Account.${mapping.objects.account.fields.tier} IN ('A', 'B')`);
  });

  it("mapping exposes Account tier picklist A–D", () => {
    expect(mapping.objects.account.tiers).toEqual(["A", "B", "C", "D"]);
    expect(mapping.objects.account.fields.tier).toBe("Tier__c");
  });

  it("buildTargetQuery fetches wide when relance predicates need JS filtering", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, relance: { jamais_appele: true }, limit: 50 },
      mapping,
      null,
    );
    expect(soql).not.toMatch(/LAST_N_DAYS/);
    expect(soql).toContain(`LIMIT ${SOQL_FETCH_CAP}`);
    expect(hasRelanceQueryFilters({ relance: { jamais_appele: true } })).toBe(true);
  });

  it("boundedLimit accepts up to the SOQL fetch cap", () => {
    expect(boundedLimit(2000)).toBe(2000);
    expect(boundedLimit(9000)).toBe(SOQL_FETCH_CAP);
  });

  it("buildTargetQuery adds fonction preset clauses", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, contact: { fonctions: ["responsable_formation"] } },
      mapping,
      null,
    );
    expect(soql).toContain("Title LIKE '%responsable%formation%'");
    expect(soql).toContain("Title IN ('RF')");
  });

  it("buildTargetQuery adds responsable_rh preset clauses", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, contact: { fonctions: ["responsable_rh"] } },
      mapping,
      null,
    );
    expect(soql).toContain("Title LIKE '%responsable rh%'");
    expect(soql).toContain("Title LIKE '%hr business partner%'");
    expect(soql).toContain("Title IN ('RRH', 'HRBP', 'Cadre RH')");
  });

  it("buildTargetQuery ignores unknown fonction presets without crashing", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, contact: { fonctions: ["preset_inexistant", "responsable_formation"] } },
      mapping,
      null,
    );
    expect(soql).toContain("Title LIKE '%responsable%formation%'");
    expect(soql).not.toContain("preset_inexistant");
  });

  it("buildTargetQuery opp_ouverte=true adds open opportunity IN clause", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, opp_ouverte: true } },
      mapping,
      null,
    );
    expect(soql).toContain(`AccountId IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)`);
    expect(soql).not.toContain("NOT IN");
  });

  it("buildTargetQuery opp_ouverte=false adds NOT IN open opportunity", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, opp_ouverte: false } },
      mapping,
      null,
    );
    expect(soql).toContain(`AccountId NOT IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)`);
  });

  it("buildTargetQuery opp_perdue=true adds lost stage IN + NOT IN open", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, opp_perdue: true } },
      mapping,
      null,
    );
    expect(soql).toContain(`AccountId IN (SELECT AccountId FROM Opportunity WHERE StageName = 'Fermée / Perdue')`);
    expect(soql).toContain(`AccountId NOT IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)`);
  });

  it("buildTargetQuery opp_ouverte=true + opp_perdue=true produces contradictory conditions without duplicate subqueries", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, opp_ouverte: true, opp_perdue: true } },
      mapping,
      null,
    );
    expect(soql).toContain(`AccountId IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)`);
    expect(soql).toContain(`AccountId IN (SELECT AccountId FROM Opportunity WHERE StageName = 'Fermée / Perdue')`);
    expect(soql).toContain(`AccountId NOT IN (SELECT AccountId FROM Opportunity WHERE IsClosed = false)`);
    const notInMatches = soql.match(/AccountId NOT IN \(SELECT AccountId FROM Opportunity WHERE IsClosed = false\)/g);
    expect(notInMatches).toHaveLength(1);
  });

  it("buildTargetQuery opp_ouverte=false + opp_perdue=true has no duplicate NOT IN subquery", () => {
    const soql = buildTargetQuery(
      { ...baseFilters, entreprise: { ...baseFilters.entreprise, opp_ouverte: false, opp_perdue: true } },
      mapping,
      null,
    );
    expect(soql).toContain(`AccountId IN (SELECT AccountId FROM Opportunity WHERE StageName = 'Fermée / Perdue')`);
    const notInMatches = soql.match(/AccountId NOT IN \(SELECT AccountId FROM Opportunity WHERE IsClosed = false\)/g);
    expect(notInMatches).toHaveLength(1);
  });

  it("filterTargetContacts applies relance predicates from Tasks child records", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const records = [
      { Id: "never", Tasks: null },
      {
        Id: "recent",
        Tasks: { records: [{ ActivityDate: "2026-07-09", Resultat_call__c: "Appel décroché" }] },
      },
      {
        Id: "old",
        Tasks: { records: [{ ActivityDate: "2026-05-01", Resultat_call__c: "Appel décroché" }] },
      },
    ];
    expect(
      filterTargetContacts(records, { relance: { jamais_appele: true } }, mapping, now).map((r) => r.Id),
    ).toEqual(["never"]);
    expect(
      filterTargetContacts(records, { relance: { dernier_appel_avant_jours: 30 } }, mapping, now).map((r) => r.Id).sort(),
    ).toEqual(["never", "old"]);
    expect(
      filterTargetContacts(records, { relance: { dernier_appel_dans_jours: 7 } }, mapping, now).map((r) => r.Id),
    ).toEqual(["recent"]);
  });

  it("filterTargetContacts ignores legacy duration keys from old presets", () => {
    const filtered = filterTargetContacts(
      SF_RECORDS,
      { relance: { duree_min_sec: 9999, duree_max_sec: 1 } },
      mapping,
    );
    expect(filtered).toHaveLength(1);
  });

  it("filterTargetContacts applies dernier_resultat from relance filters", () => {
    const filtered = filterTargetContacts(
      SF_RECORDS,
      { relance: { dernier_resultat: [mapping.objects.task.resultSemantic.followUpNoAnswer] } },
      mapping,
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("POST /api/calls action=list_contacts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockMaybeSingle.mockReset();
    mockFrom.mockClear();

    vi.stubEnv("SF_CLIENT_ID", "test-client-id");
    vi.stubEnv("SF_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("SF_REFRESH_TOKEN", "test-refresh-token");
    vi.stubEnv("SF_LOGIN_URL", "https://login.test.salesforce.com");
    vi.stubEnv("SF_INSTANCE_URL", "https://test.my.salesforce.com");
    vi.stubEnv("SUPABASE_URL", "https://test-supabase-url.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

    mockVerifyJWT.mockResolvedValue({ id: "user-123", email: "test@xos-learning.fr" });
    mockMaybeSingle.mockResolvedValue({ data: { sf_user_id: "005000000000001AAA" }, error: null });
  });

  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await POST(makeReq({ filters: {} }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await POST(makeRawReq("{invalid"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 400 invalid_body when body is null", async () => {
    const res = await POST(makeRawReq("null"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("returns 400 when filters is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_filters");
  });

  it("returns 400 when filters is not an object", async () => {
    const res = await POST(makeReq({ filters: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_filters");
  });

  it("returns 400 when entreprise family is not an object", async () => {
    const res = await POST(makeReq({ filters: { entreprise: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_filters");
  });

  it("returns 400 when relance family is not an object", async () => {
    const res = await POST(makeReq({ filters: { relance: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_filters");
  });

  it("returns 400 for invalid limit", async () => {
    const res = await POST(makeReq({ filters: {}, limit: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_limit");
  });

  it("returns 400 for invalid preset_id", async () => {
    const res = await POST(makeReq({ filters: {}, preset_id: -1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_preset_id");
  });

  it("returns 500 when profile lookup fails", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "db error" } });
    const res = await POST(makeReq({ filters: {} }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("profile_lookup_failed");
  });

  it("returns contacts and dedup from adapter-backed query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: SF_RECORDS }), { status: 200 }));

    mockFrom.mockImplementation((table) => {
      if (table === "call_sessions") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      return { select: mockSelect };
    });

    const res = await POST(makeReq({ filters: baseFilters, limit: 50 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).toMatchObject({
      title: "Responsable formation",
      linkedin_url: "https://linkedin.com/in/marie",
      email: "marie@acme.fr",
      mobile_phone: "+33600000000",
    });
    expect(body.dedup).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns dedup entries for contacts already in active sessions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: SF_RECORDS }), { status: 200 }));

    mockFrom.mockImplementation((table) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mockMaybeSingle }),
            in: () => Promise.resolve({ data: [{ id: "user-456", full_name: "Paul" }], error: null }),
          }),
        };
      }
      if (table === "call_sessions") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 9, owner: "user-456" }], error: null }) }) };
      }
      if (table === "call_session_contacts") {
        return {
          select: () => ({
            in: () => ({
              in: () => Promise.resolve({
                data: [{ sf_contact_id: "003000000000001AAA", session_id: 9 }],
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: mockSelect };
    });

    const res = await POST(makeReq({ filters: baseFilters }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dedup).toEqual([{ sf_contact_id: "003000000000001AAA", in_session_of: "Paul" }]);
  });

  it("sets Cache-Control: no-store on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: [] }), { status: 200 }));

    mockFrom.mockImplementation((table) => {
      if (table === "call_sessions") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      return { select: mockSelect };
    });

    const res = await POST(makeReq({ filters: {} }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 502 when SF OAuth fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));

    const res = await POST(makeReq({ filters: {} }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("sf_auth_error");
  });

  it("returns 502 when SOQL query fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("MALFORMED_QUERY", { status: 400 }));

    const res = await POST(makeReq({ filters: {} }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("sf_query_error");
  });
});
