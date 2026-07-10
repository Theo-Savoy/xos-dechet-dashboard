import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTargetQuery, escapeSOQL, filterTargetContacts } from "./_crm/salesforce.js";
import mapping from "./_crm/mapping.js";
import { POST } from "./calls-list.js";

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
  return new Request("http://localhost/api/calls-list", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeRawReq(rawBody) {
  const headers = new Headers({
    Authorization: "Bearer supabase-jwt-token",
    "Content-Type": "application/json",
  });
  return new Request("http://localhost/api/calls-list", {
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
    AccountId: "001000000000001AAA",
    Account: { Id: "001000000000001AAA", Name: "ACME" },
    Tasks: { totalSize: 1, records: [{ ActivityDate: "2026-07-01", Resultat_call__c: "Appel décroché", CallDurationInSeconds: 60 }] },
  },
];

describe("adapter exports", () => {
  it("escapeSOQL escapes quotes and backslashes", () => {
    expect(escapeSOQL("O'Brien")).toBe("O\\'Brien");
    expect(escapeSOQL("path\\to")).toBe("path\\\\to");
  });

  it("buildTargetQuery uses mapping field names for v2 filter tree", () => {
    const soql = buildTargetQuery(baseFilters, mapping, "005000000000001AAA");
    expect(soql).toContain(`Account.${mapping.objects.account.fields.industry} IN ('Finance')`);
    expect(soql).toContain(`${mapping.objects.contact.fields.phone} != null`);
    expect(soql).toContain(`${mapping.objects.contact.fields.doNotCall} = false`);
    expect(soql).toContain("LIMIT 200");
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

describe("POST /api/calls-list", () => {
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
