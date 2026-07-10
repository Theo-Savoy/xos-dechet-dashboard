import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./calls.js";

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

const mockSingle = vi.fn();

const mockChain = {
  then(onFulfilled, onRejected) {
    return Promise.resolve(mockSingle()).then(onFulfilled, onRejected);
  },
  select() { return this; },
  insert() { return this; },
  update() { return this; },
  eq() { return this; },
  in() { return this; },
  not() { return this; },
  order() { return this; },
  single() { return mockSingle(); },
};

const mockFrom = vi.fn(() => mockChain);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function makeReq(method, body, url = "http://localhost/api/calls") {
  const headers = new Headers();
  headers.set("Authorization", "Bearer supabase-jwt-token");
  headers.set("Content-Type", "application/json");
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeRawReq(method, rawBody, url = "http://localhost/api/calls") {
  const headers = new Headers();
  headers.set("Authorization", "Bearer supabase-jwt-token");
  headers.set("Content-Type", "application/json");
  return new Request(url, { method, headers, body: rawBody });
}

const defaultUser = {
  id: "user-123",
  email: "test@xos-learning.fr",
  user_metadata: { full_name: "Jean Dupont" },
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockSingle.mockReset();
  mockFrom.mockClear();

  vi.stubEnv("SF_CLIENT_ID", "test-client-id");
  vi.stubEnv("SF_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("SF_REFRESH_TOKEN", "test-refresh-token");
  vi.stubEnv("SF_LOGIN_URL", "https://login.test.salesforce.com");
  vi.stubEnv("SF_INSTANCE_URL", "https://test.my.salesforce.com");
  vi.stubEnv("SUPABASE_URL", "https://test-supabase-url.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

  mockVerifyJWT.mockResolvedValue(defaultUser);
});

describe("GET /api/calls", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns empty sessions list", async () => {
    mockSingle.mockResolvedValue({ data: [], error: null });
    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("returns 400 for invalid session_id", async () => {
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_session_id");
  });

  it("returns 404 when session not found", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when session owner does not match user", async () => {
    mockSingle.mockResolvedValue({ data: { id: 1, owner: "other-user", name: "Test", status: "active", created_at: "2026-01-01" }, error: null });
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns session with contacts", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Prospection", status: "active", created_at: "2026-01-01T00:00:00Z" }, error: null })
      .mockResolvedValueOnce({ data: [
        { id: 101, position: 0, sf_contact_id: "003000000000001", sf_account_id: "001000000000001", contact_name: "Marie Dupont", account_name: "ACME", phone: "+33...", status: "pending", outcome: null, comments: null, sf_task_id: null, called_at: null },
      ], error: null });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.name).toBe("Prospection");
    expect(body.session.owner).toBeUndefined();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].contact_name).toBe("Marie Dupont");
  });

  it("returns stats", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null })
      .mockResolvedValueOnce({ data: { status: "active" }, error: null })
      .mockResolvedValueOnce({ data: { status: "completed" }, error: null })
      .mockResolvedValueOnce({ data: { status: "completed" }, error: null })
      .mockResolvedValueOnce({ data: [
        { called_at: new Date().toISOString() },
        { called_at: new Date().toISOString() },
      ], error: null });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?stats=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toBeDefined();
    expect(body.stats.calls_today).toBeGreaterThanOrEqual(0);
    expect(body.stats.sessions_active).toBe(1);
    expect(body.stats.sessions_completed).toBe(2);
  });
});

describe("POST /api/calls", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await POST(makeReq("POST", { action: "create_session" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeRawReq("POST", "{invalid-json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 invalid_body on null body", async () => {
    const res = await POST(makeRawReq("POST", "null"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_body on array body", async () => {
    const res = await POST(makeRawReq("POST", "[]"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 on missing action", async () => {
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_action");
  });

  it("returns 400 on invalid action", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeReq("POST", { action: "nonexistent" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_action");
  });

  describe("create_session", () => {
    it("returns 400 when name is missing", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie" }] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_name");
    });

    it("returns 400 when name is empty", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", name: "   ", contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie" }] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_name");
    });

    it("returns 400 when contacts is missing", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", name: "Test" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_contacts");
    });

    it("returns 400 when contacts is empty", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", name: "Test", contacts: [] }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_contacts");
    });

    it("returns 400 for invalid sf_contact_id", async () => {
      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Test",
        contacts: [{ sf_contact_id: "bad", contact_name: "Marie" }],
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_sf_contact_id");
    });

    it("returns 400 for invalid sf_account_id", async () => {
      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Test",
        contacts: [{ sf_contact_id: "003000000000001", sf_account_id: "bad", contact_name: "Marie" }],
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_sf_account_id");
    });

    it("returns 400 for missing contact_name", async () => {
      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Test",
        contacts: [{ sf_contact_id: "003000000000001" }],
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_contact_name");
    });

    it("creates session and contacts successfully", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 12, name: "Prospection Lyon", status: "active", created_at: "2026-01-01T00:00:00Z" }, error: null })
        .mockResolvedValueOnce({ data: [
          { id: 201, position: 0, sf_contact_id: "003000000000001", sf_account_id: "001000000000001", contact_name: "Marie Dupont", account_name: "ACME", phone: "+33...", status: "pending", outcome: null, comments: null, sf_task_id: null, called_at: null },
        ], error: null });

      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Prospection Lyon",
        contacts: [
          { sf_contact_id: "003000000000001", sf_account_id: "001000000000001", contact_name: "Marie Dupont", account_name: "ACME", phone: "+33..." },
        ],
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session.id).toBe(12);
      expect(body.session.name).toBe("Prospection Lyon");
      expect(body.contacts).toHaveLength(1);
    });
  });

  describe("log_call", () => {
    it("returns 400 for invalid session_id", async () => {
      const res = await POST(makeReq("POST", { action: "log_call", session_id: "abc", contact_id: 1, outcome: "answered" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_session_id");
    });

    it("returns 400 for invalid outcome", async () => {
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, outcome: "bad_outcome" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_outcome");
    });

    it("returns 404 when session not found", async () => {
      mockSingle.mockResolvedValue({ data: null, error: null });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, outcome: "answered" }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns 404 when session owned by other user", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "other-user", name: "Test" }, error: null });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, outcome: "answered" }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns 404 when contact not in session", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Test" }, error: null })
        .mockResolvedValueOnce({ data: { id: 1, session_id: 5, sf_contact_id: "003000000000001" }, error: null });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, outcome: "answered" }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("successfully logs a call, creates SF Task, updates contact, and journals", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Test" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, sf_contact_id: "003000000000001", sf_account_id: "001000000000001" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })  // update result
        .mockResolvedValueOnce({ data: null, error: null }); // journal insert result

      fetchSpy
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00T123", success: true }), { status: 201 }));

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        outcome: "answered",
        comments: "RDV fixé",
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.taskId).toBe("00T123");
      expect(body.contact_id).toBe(101);

      const [, sfCall] = fetchSpy.mock.calls;
      const [, init] = sfCall;
      const payload = JSON.parse(init.body);
      expect(payload.Subject).toBe("Appel — Répondu");
      expect(payload.Description).toContain("RDV fixé");
      expect(payload.Description).toContain("[via X OS par Jean Dupont]");
      expect(payload.WhoId).toBe("003000000000001");
      expect(payload.WhatId).toBe("001000000000001");
    });

    it("returns 502 on SF auth error", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Test" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, sf_contact_id: "003000000000001" }, error: null });

      fetchSpy.mockResolvedValueOnce(new Response("Auth Error", { status: 401 }));

      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 101, outcome: "no_answer" }));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("sf_auth_error");
    });

    it("returns 502 on SF Task creation failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Test" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, sf_contact_id: "003000000000001" }, error: null });

      fetchSpy
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "sf-token" }), { status: 200 }))
        .mockResolvedValueOnce(new Response("SF Error", { status: 500 }));

      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 101, outcome: "not_interested" }));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("sf_task_creation_failed");
    });
  });

  describe("skip_contact", () => {
    it("returns 400 invalid_session_id when session_id not a number", async () => {
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: "abc", contact_id: 1 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_session_id");
    });

    it("returns 400 invalid_contact_id when contact_id not a number", async () => {
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: "abc" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_contact_id");
    });

    it("returns 404 when session not owned by user", async () => {
      mockSingle.mockResolvedValue({ data: { id: 1, owner: "other-user" }, error: null });
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 1 }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns 404 when contact not in session", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 1, session_id: 99 }, error: null });
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 1 }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("skips contact successfully", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1 }, error: null })
        .mockResolvedValueOnce({ data: null, error: null }); // update result

      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe("complete_session", () => {
    it("returns 400 invalid_session_id when session_id not a number", async () => {
      const res = await POST(makeReq("POST", { action: "complete_session", session_id: "abc" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_session_id");
    });

    it("returns 404 when session not owned by user", async () => {
      mockSingle.mockResolvedValue({ data: { id: 1, owner: "other-user", status: "active" }, error: null });
      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("returns 400 when session already completed", async () => {
      mockSingle.mockResolvedValue({ data: { id: 1, owner: "user-123", status: "completed" }, error: null });
      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("already_completed");
    });

    it("completes session successfully", async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null }); // update result

      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });
});
