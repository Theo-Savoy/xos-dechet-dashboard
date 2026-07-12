import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GET,
  POST,
  computeHubKpis,
  filterContactsForFollowUp,
  getFollowUpOutcomes,
  isNotFoundError,
  isValidEventStart,
  isValidScheduledFor,
  isValidSessionType,
} from "./calls.js";
import mapping from "./_crm/mapping.js";
import { __resetProfileCache } from "./_calls/profileCache.js";

const { mockVerifyJWT, mockFetchSFToken, mockLogCall, mockCreateEvent, mockFetchContactBasicsByIds, mockUpdateContactDoNotCall } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockFetchSFToken: vi.fn(),
  mockLogCall: vi.fn(),
  mockCreateEvent: vi.fn(),
  mockFetchContactBasicsByIds: vi.fn(),
  mockUpdateContactDoNotCall: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
  respond: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("./_crm/salesforce.js", () => ({
  fetchSFToken: mockFetchSFToken,
  logCall: mockLogCall,
  createEvent: mockCreateEvent,
  updateContactDoNotCall: mockUpdateContactDoNotCall,
  fetchContactBasicsByIds: mockFetchContactBasicsByIds,
  fetchContactContext: vi.fn().mockResolvedValue({
    contact_record_url: "https://example.salesforce.com/lightning/r/Contact/003/view",
    account_record_url: null,
    email: null,
    title: null,
    npa: false,
    tasks: [],
    opportunities: [],
  }),
  buildLightningUrl: (objectType, recordId) =>
    recordId ? `https://example.salesforce.com/lightning/r/${objectType}/${recordId}/view` : null,
}));

const mockDb = vi.fn();

const mockChain = {
  then(onFulfilled, onRejected) {
    return Promise.resolve(mockDb()).then(onFulfilled, onRejected);
  },
  select() { return this; },
  insert: vi.fn(function insert() { return this; }),
  update() { return this; },
  delete() { return this; },
  eq() { return this; },
  in() { return this; },
  not() { return this; },
  order() { return this; },
  single() { return mockDb(); },
  maybeSingle() { return mockDb(); },
};

const mockFrom = vi.fn(() => mockChain);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

const RESULTS = mapping.objects.task.results;
const SEMANTIC = mapping.objects.task.resultSemantic;
const PGRST116 = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };

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
  __resetProfileCache();
  vi.restoreAllMocks();
  mockDb.mockReset();
  mockFrom.mockClear();
  mockChain.insert.mockClear();
  mockFetchSFToken.mockReset();
  mockLogCall.mockReset();
  mockCreateEvent.mockReset();
  mockUpdateContactDoNotCall.mockReset();

  vi.stubEnv("SUPABASE_URL", "https://test-supabase-url.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

  mockVerifyJWT.mockResolvedValue(defaultUser);
  mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
  mockUpdateContactDoNotCall.mockResolvedValue({ ok: true });
  mockDb.mockResolvedValue({ data: null, error: null });
});

describe("helpers", () => {
  it("isNotFoundError recognizes PGRST116", () => {
    expect(isNotFoundError(PGRST116)).toBe(true);
    expect(isNotFoundError({ code: "XX000" })).toBe(false);
  });

  it("getFollowUpOutcomes reads semantic mapping keys", () => {
    expect(getFollowUpOutcomes()).toEqual([
      SEMANTIC.followUpNoAnswer,
      SEMANTIC.followUpVoicemail,
    ]);
  });

  it("filterContactsForFollowUp keeps relance outcomes, skipped and pending contacts", () => {
    const contacts = [
      { outcome: SEMANTIC.followUpNoAnswer, status: "called" },
      { outcome: SEMANTIC.followUpVoicemail, status: "called" },
      { outcome: "Appel décroché", status: "called" },
      { outcome: SEMANTIC.rdv, status: "called" },
      { outcome: null, status: "skipped" },
      { outcome: null, status: "pending" },
    ];
    expect(filterContactsForFollowUp(contacts)).toHaveLength(4);
  });

  it("computeHubKpis derives rates and NPA", () => {
    const kpis = computeHubKpis([
      { status: "called", outcome: "Appel décroché", marked_npa: false },
      { status: "called", outcome: "Appel argumenté", marked_npa: false },
      { status: "called", outcome: "RDV planifié", marked_npa: false },
      { status: "called", outcome: "Appel non décroché", marked_npa: true },
      { status: "skipped", outcome: null, marked_npa: false },
    ]);
    expect(kpis.calls).toBe(4);
    expect(kpis.decroche).toBe(3);
    expect(kpis.argumente).toBe(2);
    expect(kpis.rdv).toBe(1);
    expect(kpis.npa).toBe(1);
    expect(kpis.rate_decroche).toBe(75);
    expect(kpis.rate_argumente).toBe(50);
    expect(kpis.rate_rdv_per_decroche).toBeCloseTo(33.3, 1);
    expect(kpis.rate_rdv_per_argumente).toBe(50);
  });

  it("isValidSessionType accepts known kinds", () => {
    expect(isValidSessionType("prospection")).toBe(true);
    expect(isValidSessionType("relance")).toBe(true);
    expect(isValidSessionType("autre")).toBe(false);
  });

  it("isValidScheduledFor accepts strict YYYY-MM-DD dates", () => {
    expect(isValidScheduledFor("2026-07-10")).toBe(true);
    expect(isValidScheduledFor("2026-02-30")).toBe(false);
    expect(isValidScheduledFor("10-07-2026")).toBe(false);
  });

  it("isValidEventStart accepts ISO with minutes or seconds and timezone", () => {
    expect(isValidEventStart("2026-07-10T14:30Z")).toBe(true);
    expect(isValidEventStart("2026-07-10T14:30:00Z")).toBe(true);
    expect(isValidEventStart("2026-07-10T14:30:00+02:00")).toBe(true);
  });

  it("isValidEventStart rejects impossible dates and invalid offsets", () => {
    expect(isValidEventStart("2026-02-30T10:00:00Z")).toBe(false);
    expect(isValidEventStart("2026-07-10T25:00:00Z")).toBe(false);
    expect(isValidEventStart("2026-07-10T10:60:00Z")).toBe(false);
    expect(isValidEventStart("2026-07-10T10:00:00+25:00")).toBe(false);
    expect(isValidEventStart("")).toBe(false);
    expect(isValidEventStart("not-a-date")).toBe(false);
  });
});

describe("GET /api/calls", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(401);
  });

  it("returns Salesforce-enabled team members with display labels", async () => {
    mockDb.mockResolvedValueOnce({
      data: [
        { id: "user-1", full_name: "Alice Martin", email: "alice@example.com", sf_user_id: "005000000000001" },
        { id: "user-2", full_name: null, email: "bob@example.com", sf_user_id: "005000000000002" },
        { id: "user-3", full_name: "Sans Salesforce", email: "none@example.com", sf_user_id: null },
      ],
      error: null,
    });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?resource=team"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      team: [
        { user_id: "user-1", label: "Alice Martin", sf_user_id: "005000000000001" },
        { user_id: "user-2", label: "bob@example.com", sf_user_id: "005000000000002" },
      ],
    });
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("returns 500 when the team lookup fails", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "profiles failed" } });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?resource=team"));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("team_lookup_failed");
  });

  it("returns empty sessions list on successful empty query", async () => {
    mockDb.mockResolvedValueOnce({ data: [], error: null });
    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("returns 500 when sessions list query fails", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("sessions_lookup_failed");
  });

  it("returns sessions with aggregated counts", async () => {
    mockDb
      .mockResolvedValueOnce({
        data: [{ id: 1, name: "Prospection", status: "active", created_at: "2026-01-01" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { session_id: 1, status: "called" },
          { session_id: 1, status: "pending" },
        ],
        error: null,
      });

    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions[0]).toMatchObject({ id: 1, total: 2, called: 1, pending: 1 });
  });

  it("returns 500 when contacts aggregation fails", async () => {
    mockDb
      .mockResolvedValueOnce({ data: [{ id: 1, name: "X", status: "active", created_at: "2026-01-01" }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "contacts failed" } });

    const res = await GET(makeReq("GET", undefined));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("contacts_lookup_failed");
  });

  it("returns 400 for invalid session_id", async () => {
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=abc"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when session absent (PGRST116)", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: PGRST116 });
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when session owned by another user", async () => {
    mockDb.mockResolvedValueOnce({
      data: { id: 1, owner: "other-user", name: "Test", status: "active", created_at: "2026-01-01" },
      error: null,
    });
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for another owner even when the parallel contacts lookup has completed", async () => {
    mockDb
      .mockResolvedValueOnce({ data: { id: 1, owner: "other-user", name: "Test", status: "active" }, error: null })
      .mockResolvedValueOnce({ data: [{ id: 101, session_id: 1 }], error: null });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(404);
    expect(mockDb).toHaveBeenCalledTimes(2);
  });

  it("returns session detail with contacts", async () => {
    mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
    mockFetchContactBasicsByIds.mockResolvedValue({ byId: new Map() });
    mockDb
      .mockResolvedValueOnce({
        data: { id: 1, owner: "user-123", name: "Prospection", status: "active", created_at: "2026-01-01" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: 101, position: 0, sf_contact_id: "003000000000001", contact_name: "Marie", status: "pending", email: "marie@acme.fr", title: "DRH" }],
        error: null,
      });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.name).toBe("Prospection");
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].email).toBe("marie@acme.fr");
  });

  it("hydrates missing email from CRM when opening a session", async () => {
    mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
    mockFetchContactBasicsByIds.mockResolvedValue({
      byId: new Map([["003000000000001", { email: "marie@acme.fr", title: "DRH" }]]),
    });
    mockDb
      .mockResolvedValueOnce({
        data: { id: 1, owner: "user-123", name: "Prospection", status: "active", created_at: "2026-01-01" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          id: 101,
          position: 0,
          sf_contact_id: "003000000000001",
          contact_name: "Marie",
          status: "pending",
          email: null,
          title: null,
        }],
        error: null,
      })
      .mockResolvedValue({ data: null, error: null });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts[0].email).toBe("marie@acme.fr");
    expect(body.contacts[0].title).toBe("DRH");
    expect(mockFetchContactBasicsByIds).toHaveBeenCalled();
  });

  it("returns 500 when detail contacts lookup fails", async () => {
    mockDb
      .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "X", status: "active", created_at: "2026-01-01" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "contacts failed" } });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?session_id=1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("contacts_lookup_failed");
  });

  it("returns stats on success", async () => {
    mockDb
      .mockResolvedValueOnce({ data: [{ id: 1, status: "active" }, { id: 2, status: "completed" }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            status: "called",
            outcome: "RDV planifié",
            called_at: new Date().toISOString(),
            marked_npa: false,
          },
        ],
        error: null,
      });

    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?stats=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.sessions_active).toBe(1);
    expect(body.stats.sessions_completed).toBe(1);
    expect(body.stats.calls_today).toBeGreaterThanOrEqual(1);
    expect(body.stats.week.calls).toBeGreaterThanOrEqual(1);
    expect(body.stats.month.rdv).toBeGreaterThanOrEqual(1);
  });

  it("returns 500 when stats sessions lookup fails", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "stats failed" } });
    const res = await GET(makeReq("GET", undefined, "http://localhost/api/calls?stats=1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("sessions_lookup_failed");
  });
});

describe("POST /api/calls", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await POST(makeReq("POST", { action: "create_session" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeRawReq("POST", "{invalid"));
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

  it("returns 400 on missing action", async () => {
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_action");
  });

  it("returns 400 on invalid action", async () => {
    const res = await POST(makeReq("POST", { action: "nonexistent" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_action");
  });

  describe("create_session", () => {
    it("returns 400 when name is missing", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie" }] }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_name");
    });

    it("returns 400 when contacts is empty", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", name: "Test", contacts: [] }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_contacts");
    });

    it("returns 400 for invalid sf_contact_id", async () => {
      const res = await POST(makeReq("POST", { action: "create_session", name: "Test", contacts: [{ sf_contact_id: "bad", contact_name: "Marie" }] }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_sf_contact_id");
    });

    it("creates session and contacts successfully", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 12, name: "Prospection Lyon", status: "active", created_at: "2026-01-01T00:00:00Z" }, error: null })
        .mockResolvedValueOnce({
          data: [{ id: 201, position: 0, sf_contact_id: "003000000000001", contact_name: "Marie Dupont", status: "pending" }],
          error: null,
        });

      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Prospection Lyon",
        contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie Dupont" }],
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.session.id).toBe(12);
    });

    it("returns 500 and compensates when contact insert fails", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 12, name: "Prospection", status: "active", created_at: "2026-01-01T00:00:00Z" }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "insert failed" } })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Prospection",
        contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie" }],
      }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("session_contacts_insert_failed");
    });

    it("returns 400 for invalid scheduled_for", async () => {
      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Test",
        scheduled_for: "2026-02-30",
        contacts: [{ sf_contact_id: "003000000000001", contact_name: "Marie" }],
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_scheduled_for");
    });

    it("persists title, email and linkedin_url on session contacts", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 12, name: "Prospection Lyon", status: "active", created_at: "2026-01-01T00:00:00Z", scheduled_for: "2026-07-10" }, error: null })
        .mockResolvedValueOnce({
          data: [{
            id: 201,
            position: 0,
            sf_contact_id: "003000000000001",
            contact_name: "Marie Dupont",
            title: "RF",
            email: "marie@acme.fr",
            linkedin_url: "https://linkedin.com/in/marie",
            status: "pending",
          }],
          error: null,
        });

      const res = await POST(makeReq("POST", {
        action: "create_session",
        name: "Prospection Lyon",
        scheduled_for: "2026-07-10",
        contacts: [{
          sf_contact_id: "003000000000001",
          contact_name: "Marie Dupont",
          title: "RF",
          email: "marie@acme.fr",
          linkedin_url: "https://linkedin.com/in/marie",
        }],
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.contacts[0].title).toBe("RF");
      expect(body.contacts[0].email).toBe("marie@acme.fr");
      expect(body.contacts[0].linkedin_url).toBe("https://linkedin.com/in/marie");
    });
  });

  describe("log_call", () => {
    const sessionRow = { id: 1, owner: "user-123", name: "Test", status: "active" };
    const contactRow = { id: 101, session_id: 1, sf_contact_id: "003000000000001", sf_account_id: "001000000000001", status: "pending" };

    it("returns 400 for invalid session_id", async () => {
      const res = await POST(makeReq("POST", { action: "log_call", session_id: "abc", contact_id: 1, resultat: RESULTS[0] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid resultat", async () => {
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, resultat: "bad" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_resultat");
    });

    it("returns 400 for invalid duration_sec", async () => {
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, resultat: RESULTS[0], duration_sec: -1 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_duration_sec");
    });

    it("returns 404 when session absent (PGRST116)", async () => {
      mockDb.mockResolvedValueOnce({ data: null, error: PGRST116 });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, resultat: RESULTS[2] }));
      expect(res.status).toBe(404);
    });

    it("returns 404 when session owned by other user", async () => {
      mockDb.mockResolvedValueOnce({ data: { ...sessionRow, owner: "other-user" }, error: null });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, resultat: RESULTS[2] }));
      expect(res.status).toBe(404);
    });

    it("returns 404 when contact belongs to another session", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: { ...contactRow, session_id: 99 }, error: null });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 101, resultat: RESULTS[2] }));
      expect(res.status).toBe(404);
    });

    it("rejects a previously processed contact before writing Salesforce", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: { ...contactRow, status: "called" }, error: null });

      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 101, resultat: RESULTS[2] }));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "contact_already_processed" });
      expect(mockLogCall).not.toHaveBeenCalled();
    });

    it("allows a queued recall from the recalls view to be logged again", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: { ...contactRow, status: "called", recall_at: "2026-07-20" }, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });
      mockLogCall.mockResolvedValue({ record: { id: "00T789" } });

      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 101, resultat: RESULTS[2] }));

      expect(res.status).toBe(200);
      expect(mockLogCall).toHaveBeenCalledOnce();
    });

    it("returns 500 on real session lookup DB error", async () => {
      mockDb.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "db down" } });
      const res = await POST(makeReq("POST", { action: "log_call", session_id: 1, contact_id: 1, resultat: RESULTS[2] }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("session_lookup_failed");
    });

    it("logs call via adapter and returns needs_event for RDV", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      mockLogCall.mockResolvedValue({ record: { id: "00T123" } });

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        resultat: SEMANTIC.rdv,
        comments: "RDV fixé",
        duration_sec: 120,
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.needs_event).toBe(true);
      expect(body.sf_task_id).toBe("00T123");
    });

    it("stores recall_at without creating a Salesforce recall task", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      mockLogCall.mockResolvedValue({ record: { id: "00T456" } });

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        resultat: SEMANTIC.followUpNoAnswer,
        recall_at: "2026-07-20",
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, sf_task_id: "00T456" });
      expect(mockLogCall).toHaveBeenCalledTimes(1);
    });

    it("returns npa_failed while retaining the local call log when Salesforce rejects NPA", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });
      mockLogCall.mockResolvedValue({ record: { id: "00T456" } });
      mockUpdateContactDoNotCall.mockResolvedValue({ error: "sf_write_error" });

      const res = await POST(makeReq("POST", {
        action: "log_call", session_id: 1, contact_id: 101, resultat: RESULTS[0], do_not_call: true,
      }));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, npa_failed: true });
      expect(mockFrom).toHaveBeenCalledWith("action_journal");
      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        result: expect.objectContaining({ npa_failed: true }),
      }));
    });

    it("returns 500 when local persistence fails after SF success", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "update failed" } });

      mockLogCall.mockResolvedValue({ record: { id: "00T123" } });

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        resultat: RESULTS[2],
      }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("contact_update_failed");
    });

    it("returns 502 when Salesforce refuses logCall", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null });

      mockLogCall.mockResolvedValue({ error: "sf_write_error", message: "OWNER_ID invalid" });

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        resultat: RESULTS[0],
      }));
      expect(res.status).toBe(502);
    });

    it("returns 502 on SF auth error", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null });

      mockFetchSFToken.mockResolvedValue({ error: "sf_auth_error" });

      const res = await POST(makeReq("POST", {
        action: "log_call",
        session_id: 1,
        contact_id: 101,
        resultat: RESULTS[0],
      }));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("sf_auth_error");
    });
  });

  describe("log_event", () => {
    const sessionRow = { id: 1, owner: "user-123", name: "Test", status: "active" };
    const contactRow = { id: 101, session_id: 1, sf_contact_id: "003000000000001", sf_account_id: "001000000000001", contact_name: "Marie Dupont" };

    it("returns 400 for invalid start datetime", async () => {
      const res = await POST(makeReq("POST", {
        action: "log_event",
        session_id: 1,
        contact_id: 101,
        start: "2026-02-30T10:00:00Z",
        duration_min: 30,
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_start");
    });

    it("returns 400 for invalid duration_min", async () => {
      const res = await POST(makeReq("POST", {
        action: "log_event",
        session_id: 1,
        contact_id: 101,
        start: "2026-07-15T10:00Z",
        duration_min: 0,
      }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_duration_min");
    });

    it("returns 404 when session owned by other user", async () => {
      mockDb.mockResolvedValueOnce({ data: { ...sessionRow, owner: "other" }, error: null });
      const res = await POST(makeReq("POST", {
        action: "log_event",
        session_id: 1,
        contact_id: 101,
        start: "2026-07-15T10:00Z",
        duration_min: 30,
      }));
      expect(res.status).toBe(404);
    });

    it("creates event and persists sf_event_id", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      mockCreateEvent.mockResolvedValue({ record: { id: "00U456" } });

      const res = await POST(makeReq("POST", {
        action: "log_event",
        session_id: 1,
        contact_id: 101,
        start: "2026-07-15T10:00Z",
        duration_min: 45,
      }));

      expect(res.status).toBe(200);
      expect((await res.json()).sf_event_id).toBe("00U456");
    });

    it("returns 502 with sf_event_id on partial invitee failure", async () => {
      mockDb
        .mockResolvedValueOnce({ data: sessionRow, error: null })
        .mockResolvedValueOnce({ data: contactRow, error: null })
        .mockResolvedValueOnce({ data: { sf_user_id: "005000000000001AAA", full_name: "Jean Dupont" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      mockCreateEvent.mockResolvedValue({ record: { id: "00U456" }, inviteeError: "sf_write_error" });

      const res = await POST(makeReq("POST", {
        action: "log_event",
        session_id: 1,
        contact_id: 101,
        start: "2026-07-15T10:00Z",
        duration_min: 30,
      }));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("event_invitee_failed");
      expect(body.sf_event_id).toBe("00U456");
    });
  });

  describe("create_follow_up_session", () => {
    it("returns 400 when no relance contacts", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Base", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: [{ outcome: "Appel décroché" }], error: null });

      const res = await POST(makeReq("POST", { action: "create_follow_up_session", session_id: 1 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("no_follow_up_contacts");
    });

    it("creates relance session from follow-up outcomes", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Base", status: "active" }, error: null })
        .mockResolvedValueOnce({
          data: [{ sf_contact_id: "003000000000001", contact_name: "Alice", outcome: SEMANTIC.followUpNoAnswer }],
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 20, name: "Base #2", status: "active", created_at: "2026-01-01T00:00:00Z" }, error: null })
        .mockResolvedValueOnce({ data: [{ id: 301, sf_contact_id: "003000000000001", contact_name: "Alice", status: "pending" }], error: null });

      const res = await POST(makeReq("POST", { action: "create_follow_up_session", session_id: 1 }));
      expect(res.status).toBe(200);
      expect((await res.json()).session.name).toBe("Base #2");
    });

    it("returns 500 when follow-up contact lookup fails", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Base", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "lookup failed" } });

      const res = await POST(makeReq("POST", { action: "create_follow_up_session", session_id: 1 }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("session_contacts_lookup_failed");
    });
  });

  describe("skip_contact", () => {
    it("returns 400 invalid_session_id when session_id not a number", async () => {
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: "abc", contact_id: 1 }));
      expect(res.status).toBe(400);
    });

    it("returns 404 when session owned by other user", async () => {
      mockDb.mockResolvedValueOnce({ data: { id: 1, owner: "other-user" }, error: null });
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 1 }));
      expect(res.status).toBe(404);
    });

    it("returns 404 when contact belongs to another session", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 99 }, error: null });
      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(404);
    });

    it("rejects a previously processed contact", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, status: "skipped" }, error: null });

      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 101 }));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "contact_already_processed" });
    });

    it("skips contact successfully", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1 }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });

    it("returns 500 when skip update fails", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1 }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "update failed" } });

      const res = await POST(makeReq("POST", { action: "skip_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("contact_update_failed");
    });
  });

  describe("remove_contact", () => {
    it("deletes a pending contact from the session", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, status: "pending" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeReq("POST", { action: "remove_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("rejects a called contact", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, status: "called", recall_at: "2026-07-20" }, error: null });

      const res = await POST(makeReq("POST", { action: "remove_contact", session_id: 1, contact_id: 101 }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "contact_not_removable" });
    });
  });

  describe("update_recall", () => {
    it("reschedules a recall date", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({
          data: { id: 101, session_id: 1, status: "called", recall_at: "2026-07-12" },
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(
        makeReq("POST", { action: "update_recall", session_id: 1, contact_id: 101, recall_at: "2026-07-20" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, recall_at: "2026-07-20" });
    });

    it("clears a recall from the queue", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({
          data: { id: 101, session_id: 1, status: "called", recall_at: "2026-07-12" },
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(
        makeReq("POST", { action: "update_recall", session_id: 1, contact_id: 101, recall_at: null }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, recall_at: null });
    });

    it("rejects update on a pending contact", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123" }, error: null })
        .mockResolvedValueOnce({ data: { id: 101, session_id: 1, status: "pending" }, error: null });

      const res = await POST(
        makeReq("POST", { action: "update_recall", session_id: 1, contact_id: 101, recall_at: "2026-07-20" }),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "contact_not_called" });
    });
  });

  describe("update_session / delete_session", () => {
    it("updates session metadata", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Old", status: "active" }, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 1,
            name: "New",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            scheduled_for: "2026-07-12",
            session_type: "suivi_clients",
          },
          error: null,
        });

      const res = await POST(
        makeReq("POST", {
          action: "update_session",
          session_id: 1,
          name: "New",
          scheduled_for: "2026-07-12",
          session_type: "suivi_clients",
        }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).session.name).toBe("New");
    });

    it("deletes a session", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "X", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeReq("POST", { action: "delete_session", session_id: 1 }));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });
  });

  describe("defer_contacts", () => {
    it("creates a relance session when no target is provided", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Base", status: "active" }, error: null })
        .mockResolvedValueOnce({
          data: [{
            id: 101,
            sf_contact_id: "003000000000001",
            contact_name: "Alice",
            status: "pending",
            attempt_count: 0,
          }],
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 20,
            name: "Base #2",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            scheduled_for: "2026-07-15",
            session_type: "relance",
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ id: 301, sf_contact_id: "003000000000001", contact_name: "Alice", status: "pending", attempt_count: 0 }],
          error: null,
        });

      const res = await POST(
        makeReq("POST", {
          action: "defer_contacts",
          session_id: 1,
          contact_ids: [101],
          scheduled_for: "2026-07-15",
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.target_session.session_type).toBe("relance");
      expect(body.target_session.name).toBe("Base #2");
    });

    it("uses an explicit continuation name when provided", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", name: "Base", status: "active" }, error: null })
        .mockResolvedValueOnce({
          data: [{
            id: 101,
            sf_contact_id: "003000000000001",
            contact_name: "Alice",
            status: "pending",
            attempt_count: 0,
          }],
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 21,
            name: "Prospection Lyon #2",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            scheduled_for: "2026-07-11",
            session_type: "relance",
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ id: 302, sf_contact_id: "003000000000001", contact_name: "Alice", status: "pending", attempt_count: 0 }],
          error: null,
        });

      const res = await POST(
        makeReq("POST", {
          action: "defer_contacts",
          session_id: 1,
          contact_ids: [101],
          scheduled_for: "2026-07-11",
          name: "Prospection Lyon #2",
        }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).target_session.name).toBe("Prospection Lyon #2");
    });
  });

  describe("complete_session", () => {
    it("returns 400 when session already completed", async () => {
      mockDb.mockResolvedValueOnce({ data: { id: 1, owner: "user-123", status: "completed" }, error: null });
      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("already_completed");
    });

    it("completes session successfully", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });

    it("returns 500 when complete update fails", async () => {
      mockDb
        .mockResolvedValueOnce({ data: { id: 1, owner: "user-123", status: "active" }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "update failed" } });

      const res = await POST(makeReq("POST", { action: "complete_session", session_id: 1 }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("session_update_failed");
    });
  });
});
