import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyJWT, mockFetchSFToken, mockGetProfile, mockInvalidateProfileCache } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockFetchSFToken: vi.fn(),
  mockGetProfile: vi.fn(),
  mockInvalidateProfileCache: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  respond: (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  verifyJWT: mockVerifyJWT,
}));
vi.mock("./_crm/salesforce.js", () => ({ fetchSFToken: mockFetchSFToken }));
vi.mock("./_calls/profileCache.js", () => ({
  getProfile: mockGetProfile,
  invalidateProfileCache: mockInvalidateProfileCache,
}));

const mockDb = vi.fn();
const chain = {
  then(onFulfilled, onRejected) { return Promise.resolve(mockDb()).then(onFulfilled, onRejected); },
  select() { return this; },
  eq() { return this; },
  order() { return this; },
  upsert() { return this; },
  update() { return this; },
  delete() { return this; },
};
const mockFrom = vi.fn(() => chain);
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mockFrom }) }));

import { GET, POST } from "./status.js";

function request(method, body) {
  return new Request("https://xos.test/api/status", {
    method,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDb.mockReset();
  mockFrom.mockClear();
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
  mockVerifyJWT.mockResolvedValue({ id: "user-1", email: "ada@xos-learning.fr" });
  mockGetProfile.mockResolvedValue({ fullName: "Ada Lovelace", sfUserId: "005xx", role: "manager" });
  mockFetchSFToken.mockResolvedValue({ accessToken: "sf-token" });
  mockDb.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (String(url).includes("/limits")) {
      return Promise.resolve(new Response(JSON.stringify({ DailyApiRequests: { Max: 15000, Remaining: 14900 } }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ version: "history/2026-07-11.json" }), { status: 200 }));
  }));
});

describe("GET /api/status", () => {
  it("returns 401 without a JWT", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    expect((await GET(request("GET"))).status).toBe(401);
  });

  it("returns the authenticated profile, Salesforce limits, cache freshness and deployment version", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "manager",
      profile: { email: "ada@xos-learning.fr", fullName: "Ada Lovelace", sfUserId: "005xx" },
      salesforce: { connected: true, dailyApiRequests: { max: 15000, remaining: 14900 } },
      cache: { cleaner: { version: "history/2026-07-11.json" } },
      version: "abc123",
      capabilities: { manageSettings: true, manageRoles: false },
      settings: [],
      profiles: [],
    });
  });
});

describe("POST /api/status", () => {
  it("refuses settings updates from a commercial", async () => {
    mockGetProfile.mockResolvedValue({ fullName: "Ada", sfUserId: null, role: "commercial" });
    const response = await POST(request("POST", { action: "update_settings", operation: "upsert", key: "cleaner_late_days", value: 14 }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("allows a manager to upsert a setting", async () => {
    mockDb.mockResolvedValue({ data: { id: 1, key: "cleaner_late_days", value: 14 }, error: null });
    const response = await POST(request("POST", { action: "update_settings", operation: "upsert", key: "cleaner_late_days", value: 14 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ setting: { key: "cleaner_late_days", value: 14 } });
  });

  it("allows only admins to set roles and never their own role", async () => {
    const managerResponse = await POST(request("POST", { action: "set_role", profileId: "user-2", role: "commercial" }));
    expect(managerResponse.status).toBe(403);

    mockGetProfile.mockResolvedValue({ fullName: "Admin", sfUserId: null, role: "admin" });
    const selfResponse = await POST(request("POST", { action: "set_role", profileId: "user-1", role: "commercial" }));
    expect(selfResponse.status).toBe(400);
    await expect(selfResponse.json()).resolves.toEqual({ error: "admin_cannot_demote_self" });

    mockDb.mockResolvedValue({ data: { id: "user-2", role: "manager" }, error: null });
    const adminResponse = await POST(request("POST", { action: "set_role", profileId: "user-2", role: "manager" }));
    expect(adminResponse.status).toBe(200);
  });
});
