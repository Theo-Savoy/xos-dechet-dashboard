/**
 * api/search.test.js — Tests for api/search.js.
 *
 * Imports and exercises the actual server module at ../../api/search.js.
 * Uses vi.mock (hoisted) for _auth.js — not vi.doMock after static import.
 * Mocks: SF OAuth token fetch and SOSL search (external HTTP only).
 * Coverage: GET handler, JWT rejection, query validation, SOSL escaping,
 *   normalization (Account/Contact/Opportunity), recordUrl, Cache-Control no-store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  escapeSOSL,
  normalizeSFResults,
  GET,
} from "../../api/search.js";

// Hoisted mock — intercepts the static import inside ../../api/search.js.
// Path is relative to this test file (api/search.test.js) since both files
// import "./_auth.js", they resolve to the same absolute module.
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

// ── Helpers ──

function makeReq(query, token = "supabase-jwt-token") {
  const url = `http://localhost/api/search?q=${encodeURIComponent(query)}`;
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request(url, { method: "GET", headers });
}

const SF_SEARCH_RESPONSE = {
  searchRecords: [
    {
      attributes: {
        type: "Account",
        url: "/services/data/v67.0/sobjects/Account/001000000000001",
      },
      Id: "001000000000001",
      Name: "Acme Corp",
      Phone: "+33123456789",
      Industry: "Tech",
      Owner: { Name: "Alice Martin" },
    },
    {
      attributes: {
        type: "Account",
        url: "/services/data/v67.0/sobjects/Account/001000000000002",
      },
      Id: "001000000000002",
      Name: "Beta Inc",
      Phone: null,
      Industry: null,
      Owner: null,
    },
    {
      attributes: {
        type: "Contact",
        url: "/services/data/v67.0/sobjects/Contact/003000000000001",
      },
      Id: "003000000000001",
      FirstName: "Jean",
      LastName: "Dupont",
      Email: "jean@acme.com",
      Title: "CEO",
      Account: { Name: "Acme Corp" },
      Owner: { Name: "Alice Martin" },
    },
    {
      attributes: {
        type: "Opportunity",
        url: "/services/data/v67.0/sobjects/Opportunity/006000000000001",
      },
      Id: "006000000000001",
      Name: "Deal Alpha",
      Amount: 50000,
      StageName: "Qualification",
      CloseDate: "2026-12-31",
      Account: { Name: "Acme Corp" },
      Owner: { Name: "Bob Wilson" },
    },
  ],
};

// ── Unit: escapeSOSL ──

describe("escapeSOSL", () => {
  it("escapes single quotes", () => {
    expect(escapeSOSL("O'Brien")).toBe("O\\'Brien");
  });

  it("escapes backslash", () => {
    expect(escapeSOSL("path\\to")).toBe("path\\\\to");
  });

  it("escapes question mark", () => {
    expect(escapeSOSL("really?")).toBe("really\\?");
  });

  it("escapes multiple reserved chars", () => {
    expect(escapeSOSL("what's this?")).toBe("what\\'s this\\?");
  });

  it("strips braces entirely (set operator, not escapable)", () => {
    expect(escapeSOSL("{test}")).toBe("test");
  });

  it("escapes ampersand and exclamation", () => {
    expect(escapeSOSL("A & B!")).toBe("A \\& B\\!");
  });

  it("escapes wildcard asterisk", () => {
    expect(escapeSOSL("test*")).toBe("test\\*");
  });

  it("handles empty string", () => {
    expect(escapeSOSL("")).toBe("");
  });

  it("escapes all reserved chars in one pass", () => {
    expect(escapeSOSL("'\"\\?&!^~*[](){}|")).toBe(
      "\\'\\\"\\\\\\?\\&\\!\\^\\~\\*\\[\\]\\(\\)\\|",
    );
  });

  it("escapes + (SOSL OR operator)", () => {
    expect(escapeSOSL("A+B")).toBe("A\\+B");
  });

  it("escapes - (SOSL NOT operator)", () => {
    expect(escapeSOSL("foo-bar")).toBe("foo\\-bar");
  });

  it("escapes : (SOSL clause separator)", () => {
    expect(escapeSOSL("name:John")).toBe("name\\:John");
  });
});

// ── Unit: normalizeSFResults ──

describe("normalizeSFResults", () => {
  it("normalizes Account, Contact, and Opportunity records", () => {
    const result = normalizeSFResults(SF_SEARCH_RESPONSE.searchRecords);
    expect(result).toHaveLength(4);
  });

  it("groups records with correct type, id, name, detail", () => {
    const result = normalizeSFResults(SF_SEARCH_RESPONSE.searchRecords);
    expect(result[0]).toEqual({
      type: "Account",
      id: "001000000000001",
      name: "Acme Corp",
      detail: "Tech · Alice Martin",
      recordUrl: expect.stringContaining(
        "/lightning/r/Account/001000000000001/view",
      ),
    });
    expect(result[2]).toEqual({
      type: "Contact",
      id: "003000000000001",
      name: "Jean Dupont",
      detail: "CEO · Acme Corp",
      recordUrl: expect.stringContaining(
        "/lightning/r/Contact/003000000000001/view",
      ),
    });
    expect(result[3]).toEqual({
      type: "Opportunity",
      id: "006000000000001",
      name: "Deal Alpha",
      detail: `Qualification · 50\u202f000 € · Acme Corp`,
      recordUrl: expect.stringContaining(
        "/lightning/r/Opportunity/006000000000001/view",
      ),
    });
  });

  it("builds recordUrl from attributes.url when present", () => {
    const result = normalizeSFResults(SF_SEARCH_RESPONSE.searchRecords);
    expect(result[0].recordUrl).toBe(
      "https://login.salesforce.com/lightning/r/Account/001000000000001/view",
    );
  });

  it("falls back to SF_INSTANCE_URL when attributes.url is absent", () => {
    vi.stubEnv("SF_INSTANCE_URL", "https://custom.my.salesforce.com");
    const records = [{ attributes: { type: "Account" }, Id: "001AAA", Name: "Test" }];
    const result = normalizeSFResults(records);
    expect(result[0].recordUrl).toBe(
      "https://custom.my.salesforce.com/lightning/r/Account/001AAA/view",
    );
    vi.unstubAllEnvs();
  });

  it("ignores null fields in detail gracefully", () => {
    const result = normalizeSFResults(SF_SEARCH_RESPONSE.searchRecords);
    expect(result[1].detail).toBe("");
  });

  it("returns empty array for null input", () => {
    expect(normalizeSFResults(null)).toEqual([]);
  });

  it("ignores records with no attributes", () => {
    expect(normalizeSFResults([{ Id: "x" }])).toEqual([]);
  });

  it("ignores records with no Id", () => {
    expect(normalizeSFResults([{ attributes: { type: "Account" } }])).toEqual(
      [],
    );
  });

  it("ignores unknown SF types (Lead, etc.)", () => {
    const result = normalizeSFResults([
      { attributes: { type: "Lead" }, Id: "xxx", Name: "Test" },
    ]);
    expect(result).toHaveLength(0);
  });
});

// ── Integration: GET handler (exercises actual api/search.js) ──

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("SF_CLIENT_ID", "test-client-id");
    vi.stubEnv("SF_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("SF_REFRESH_TOKEN", "test-refresh-token");
    vi.stubEnv("SF_LOGIN_URL", "https://login.test.salesforce.com");
    vi.stubEnv("SF_INSTANCE_URL", "https://test.my.salesforce.com");
    mockVerifyJWT.mockResolvedValue({
      id: "user-1",
      email: "test@xos-learning.fr",
    });
  });

  // ── Auth ──

  it("returns 401 when verifyJWT returns null (no valid token)", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("test"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("sets Cache-Control: no-store on 401 responses", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("test"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // ── Query validation ──

  it("returns 400 when query is less than 2 characters", async () => {
    const res = await GET(makeReq("a"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query");
  });

  it("returns 400 when query is empty", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query");
  });

  it("sets Cache-Control: no-store on 400 responses", async () => {
    const res = await GET(makeReq("a"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // ── SF calls: GET method + URL encoding ──

  it("calls SF search endpoint with GET method and URL-encoded SOSL query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // OAuth token fetch (POST)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // SOSL search fetch — verify method + URL
    fetchSpy.mockImplementationOnce((url, init) => {
      expect(init?.method).toBeUndefined(); // GET has no method (defaults to GET)
      expect(init?.body).toBeUndefined(); // GET has no body

      const urlStr = typeof url === "string" ? url : url.toString();
      expect(urlStr).toContain("/services/data/v67.0/search?");
      expect(urlStr).toContain("q=");
      return Promise.resolve(
        new Response(JSON.stringify({ searchRecords: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const res = await GET(makeReq("Acme"));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("URL-encodes SOSL reserved characters in the q parameter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockImplementationOnce((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      // O\'Brien should appear URL-encoded in the query string
      expect(urlStr).toMatch(/q=.*O%5C%27Brien/);
      return Promise.resolve(
        new Response(JSON.stringify({ searchRecords: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const res = await GET(makeReq("O'Brien"));
    expect(res.status).toBe(200);
  });

  // ── Normalization ──

  it("returns normalized Account, Contact, and Opportunity with recordUrl", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(SF_SEARCH_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await GET(makeReq("Acme"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.results).toHaveLength(4);
    expect(body.results[0].recordUrl).toContain("/lightning/r/Account/");
    expect(body.results[2].recordUrl).toContain("/lightning/r/Contact/");
    expect(body.results[3].recordUrl).toContain("/lightning/r/Opportunity/");
  });

  // ── Cache-Control ──

  it("sets Cache-Control: no-store on success responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ searchRecords: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await GET(makeReq("test"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // ── Error paths ──

  it("returns 502 when SF OAuth fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 }),
    );

    const res = await GET(makeReq("Acme"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("sf_auth_error");
  });

  it("sets Cache-Control: no-store on 502 responses (SF auth error)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 }),
    );

    const res = await GET(makeReq("Acme"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 502 when SOSL search fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const res = await GET(makeReq("Acme"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("sf_search_error");
  });

  it("sets Cache-Control: no-store on 502 responses (SF search error)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "sf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const res = await GET(makeReq("Acme"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
