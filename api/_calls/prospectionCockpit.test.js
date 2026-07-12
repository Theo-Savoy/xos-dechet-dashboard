import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../calls.js";
import { __resetProfileCache } from "./profileCache.js";

const { mockVerifyJWT } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
}));

vi.mock("../_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
  respond: (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("../_crm/salesforce.js", () => ({
  fetchSFToken: vi.fn(),
  logCall: vi.fn(),
  createEvent: vi.fn(),
  updateContactDoNotCall: vi.fn(),
  fetchContactBasicsByIds: vi.fn(),
  fetchContactContext: vi.fn(),
  buildLightningUrl: () => null,
}));

const mockDb = vi.fn();
const mockChain = {
  then(onFulfilled, onRejected) {
    return Promise.resolve(mockDb()).then(onFulfilled, onRejected);
  },
  select() { return this; },
  insert() { return this; },
  update() { return this; },
  delete() { return this; },
  eq() { return this; },
  in() { return this; },
  not() { return this; },
  order() { return this; },
  limit() { return this; },
  single() { return mockDb(); },
  maybeSingle() { return mockDb(); },
};
const mockFrom = vi.fn(() => mockChain);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function makeReq(url) {
  const headers = new Headers();
  headers.set("Authorization", "Bearer token");
  return new Request(url, { method: "GET", headers });
}

describe("prospection_cockpit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetProfileCache();
    mockVerifyJWT.mockResolvedValue({ id: "mgr-1", email: "paul@xos-learning.fr" });
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("returns 403 for commercial role", async () => {
    mockDb.mockResolvedValueOnce({
      data: { sf_user_id: "005A", full_name: "Yanis", role: "commercial" },
      error: null,
    });

    const res = await GET(makeReq("http://localhost/api/calls?resource=prospection_cockpit"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("aggregates team funnel and RDV attribution for managers", async () => {
    const now = Date.now();
    const calledAt = new Date(now - 60 * 60 * 1000).toISOString();

    mockDb
      // getProfile
      .mockResolvedValueOnce({
        data: { sf_user_id: "005P", full_name: "Paul", role: "manager" },
        error: null,
      })
      // profiles roster
      .mockResolvedValueOnce({
        data: [
          { id: "sdr-1", full_name: "Yanis", email: "yanis@xos-learning.fr", sf_user_id: "005S", role: "commercial" },
          { id: "ae-1", full_name: "Christophe", email: "chris@xos-learning.fr", sf_user_id: "005C", role: "commercial" },
        ],
        error: null,
      })
      // sf_user_map
      .mockResolvedValueOnce({ data: [], error: null })
      // sessions
      .mockResolvedValueOnce({
        data: [
          {
            id: 10,
            owner: "sdr-1",
            name: "Prospection SDR",
            status: "active",
            created_at: calledAt,
            scheduled_for: "2026-07-12",
            session_type: "prospection",
            completed_at: null,
          },
        ],
        error: null,
      })
      // contacts
      .mockResolvedValueOnce({
        data: [
          {
            id: 101,
            session_id: 10,
            contact_name: "Alice",
            account_name: "Acme",
            status: "called",
            outcome: "RDV planifié",
            called_at: calledAt,
            marked_npa: false,
            sf_event_id: "00U1",
            rdv_owner_sf_user_id: "005C",
          },
          {
            id: 102,
            session_id: 10,
            contact_name: "Bob",
            account_name: "Beta",
            status: "called",
            outcome: "Appel décroché",
            called_at: calledAt,
            marked_npa: false,
            sf_event_id: null,
            rdv_owner_sf_user_id: null,
          },
        ],
        error: null,
      });

    const res = await GET(makeReq("http://localhost/api/calls?resource=prospection_cockpit&period=week"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.view).toBe("team");
    expect(body.team_kpis.calls).toBe(2);
    expect(body.team_kpis.rdv).toBe(1);
    expect(body.by_caller[0].label).toBe("Yanis");
    expect(body.by_rdv_owner[0]).toMatchObject({ label: "Christophe", rdv: 1, from_sdr: 1 });
    expect(body.rdv_attributions).toHaveLength(1);
    expect(body.rdv_attributions[0]).toMatchObject({
      contact_name: "Alice",
      caller: expect.objectContaining({ label: "Yanis" }),
      rdv_owner_label: "Christophe",
    });
  });
});
