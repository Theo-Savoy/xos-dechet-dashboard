import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./log.js";

// Hoisted mock for _auth.js
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

// Mock @supabase/supabase-js
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
const mockSupabase = { from: mockFrom };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabase,
}));

function makeReq(body) {
  const url = `http://localhost/api/log`;
  const headers = new Headers();
  headers.set("Authorization", "Bearer supabase-jwt-token");
  headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeRawReq(rawBody) {
  const url = `http://localhost/api/log`;
  const headers = new Headers();
  headers.set("Authorization", "Bearer supabase-jwt-token");
  headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/log", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockInsert.mockClear();
    mockFrom.mockClear();

    vi.stubEnv("SF_CLIENT_ID", "test-client-id");
    vi.stubEnv("SF_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("SF_REFRESH_TOKEN", "test-refresh-token");
    vi.stubEnv("SF_LOGIN_URL", "https://login.test.salesforce.com");
    vi.stubEnv("SF_INSTANCE_URL", "https://test.my.salesforce.com");
    vi.stubEnv("SUPABASE_URL", "https://test-supabase-url.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

    mockVerifyJWT.mockResolvedValue({
      id: "user-123",
      email: "test@xos-learning.fr",
      user_metadata: {
        full_name: "Jean Dupont",
      },
    });
  });

  it("returns 401 when user is unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await POST(makeReq({ action: "log_call" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost/api/log", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: "{invalid-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 when action is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_action");
  });

  it("returns 400 invalid_body when parsed body is null", async () => {
    // body is valid JSON but parses to null
    const res = await POST(makeRawReq("null"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_body when body is not a JSON object", async () => {
    // body parses to a valid JSON array
    const res = await POST(makeRawReq("[]"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_body when body is a JSON primitive (string)", async () => {
    const res = await POST(makeRawReq('"hello"'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  describe("action: log_call", () => {
    it("returns 400 on invalid record ID", async () => {
      const res = await POST(makeReq({ action: "log_call", recordId: "tooShort", recordType: "Account", comments: "hello" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_record_id");
    });

    it("returns 400 invalid_record_id when recordId is not a string (coerced number)", async () => {
      const res = await POST(makeReq({ action: "log_call", recordId: 123456789012345, recordType: "Account", comments: "hello" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_record_id");
    });

    it("returns 400 on invalid record type", async () => {
      const res = await POST(makeReq({ action: "log_call", recordId: "001000000000001", recordType: "Lead", comments: "hello" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_record_type");
    });

    it("returns 400 on missing comments", async () => {
      const res = await POST(makeReq({ action: "log_call", recordId: "001000000000001", recordType: "Account", comments: "   " }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing_comments");
    });

    it("creates a Salesforce Task with WhatId and logs to database on success", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // 1. OAuth
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      // 2. SF Task Creation
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-sf-id-123", success: true }), { status: 201 })
      );

      const res = await POST(makeReq({
        action: "log_call",
        recordId: "001000000000001", // Account
        recordType: "Account",
        comments: "Customer call notes",
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.taskId).toBe("task-sf-id-123");

      // Verify Salesforce fetch was called with right parameters
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [, sfCall] = fetchSpy.mock.calls;
      const [url, init] = sfCall;
      expect(url).toContain("/services/data/v67.0/sobjects/Task");
      expect(init.method).toBe("POST");
      
      const payload = JSON.parse(init.body);
      expect(payload.Subject).toBe("Note d'appel");
      expect(payload.Description).toContain("Customer call notes");
      expect(payload.Description).toContain("[via X OS par Jean Dupont]");
      expect(payload.WhatId).toBe("001000000000001");
      expect(payload.WhoId).toBeUndefined();

      // Verify Supabase journal write
      expect(mockFrom).toHaveBeenCalledWith("action_journal");
      expect(mockInsert).toHaveBeenCalledWith({
        actor: "user-123",
        action_type: "log_call",
        changes: { comments: "Customer call notes" },
        targets: [{ id: "001000000000001", type: "Account" }],
        result: { success: true, taskId: "task-sf-id-123" },
      });
    });

    it("creates a Salesforce Task with WhoId for Contact", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // 1. OAuth
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      // 2. SF Task Creation
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-sf-id-456", success: true }), { status: 201 })
      );

      const res = await POST(makeReq({
        action: "log_call",
        recordId: "003000000000001", // Contact
        recordType: "Contact",
        comments: "Spoke with client",
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.taskId).toBe("task-sf-id-456");

      const [, sfCall] = fetchSpy.mock.calls;
      const [, init] = sfCall;
      const payload = JSON.parse(init.body);
      expect(payload.WhoId).toBe("003000000000001");
      expect(payload.WhatId).toBeUndefined();
    });

    it("returns 502 when Salesforce Task creation fails", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // 1. OAuth
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      // 2. SF Task Creation Failure
      fetchSpy.mockResolvedValueOnce(
        new Response("SF Server Error", { status: 500 })
      );

      const res = await POST(makeReq({
        action: "log_call",
        recordId: "001000000000001",
        recordType: "Account",
        comments: "Test comments",
      }));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("sf_task_creation_failed");
    });
  });

  describe("action: create_contact", () => {
    it("returns 400 on missing last name", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "  ", firstName: "Jean" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing_last_name");
    });

    it("returns 400 invalid_first_name when firstName is not a string", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", firstName: { bad: true } }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_first_name");
    });

    it("returns 400 invalid_phone when phone is not a string", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", phone: 12345 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_phone");
    });

    it("returns 400 on invalid email", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", email: "not-an-email" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_email");
    });

    it("returns 400 invalid_email when email is not a string (no coercion)", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", email: 42 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_email");
    });

    it("returns 400 on invalid account ID", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", accountId: "invalidId" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_account_id");
    });

    it("returns 400 invalid_account_id when accountId is not a string (coerced number)", async () => {
      const res = await POST(makeReq({ action: "create_contact", lastName: "Dupont", accountId: 123456789012345 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_account_id");
    });

    it("omits whitespace-only optional fields from SF payload (empty strings trimmed away)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "contact-sf-id-999", success: true }), { status: 201 })
      );

      const res = await POST(makeReq({
        action: "create_contact",
        firstName: "   ",
        lastName: "Dupont",
        email: "   ",
        phone: "\t\n  ",
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const [, sfCall] = fetchSpy.mock.calls;
      const [, init] = sfCall;
      const payload = JSON.parse(init.body);
      expect(payload.LastName).toBe("Dupont");
      expect(payload.FirstName).toBeUndefined();
      expect(payload.Email).toBeUndefined();
      expect(payload.Phone).toBeUndefined();
      expect(payload.AccountId).toBeUndefined();
    });

    it("creates a Salesforce Contact with trimmed strings and logs to database on success", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // 1. OAuth
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      // 2. SF Contact Creation
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "contact-sf-id-789", success: true }), { status: 201 })
      );

      const res = await POST(makeReq({
        action: "create_contact",
        firstName: "  Jean  ",
        lastName: "  Dupont  ",
        email: "  jean.dupont@acme.com  ",
        phone: "  +33612345678  ",
        accountId: "001000000000001",
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.contactId).toBe("contact-sf-id-789");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [, sfCall] = fetchSpy.mock.calls;
      const [url, init] = sfCall;
      expect(url).toContain("/services/data/v67.0/sobjects/Contact");
      expect(init.method).toBe("POST");

      const payload = JSON.parse(init.body);
      expect(payload.FirstName).toBe("Jean");
      expect(payload.LastName).toBe("Dupont");
      expect(payload.Email).toBe("jean.dupont@acme.com");
      expect(payload.Phone).toBe("+33612345678");
      expect(payload.AccountId).toBe("001000000000001");

      // Verify Supabase journal write
      expect(mockFrom).toHaveBeenCalledWith("action_journal");
      expect(mockInsert).toHaveBeenCalledWith({
        actor: "user-123",
        action_type: "create_contact",
        changes: {
          firstName: "  Jean  ",
          lastName: "  Dupont  ",
          email: "  jean.dupont@acme.com  ",
          phone: "  +33612345678  ",
          accountId: "001000000000001",
        },
        targets: [{ id: "contact-sf-id-789", type: "Contact" }],
        result: { success: true, contactId: "contact-sf-id-789" },
      });
    });

    it("returns 502 when Salesforce Contact creation fails", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // 1. OAuth
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sf-access-token" }), { status: 200 })
      );
      // 2. SF Contact Creation Failure
      fetchSpy.mockResolvedValueOnce(
        new Response("SF Contact Creation Error", { status: 400 })
      );

      const res = await POST(makeReq({
        action: "create_contact",
        lastName: "Dupont",
      }));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("sf_contact_creation_failed");
    });
  });
});
