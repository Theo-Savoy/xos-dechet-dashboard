import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./calls.js";
import { parsePresetId, validatePresetInput } from "./_calls/presets.js";

const { mockVerifyJWT } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
}));

vi.mock("./_crm/salesforce.js", () => ({
  fetchSFToken: vi.fn(),
  logCall: vi.fn(),
  createEvent: vi.fn(),
  updateContactDoNotCall: vi.fn(),
  fetchContactContext: vi.fn(),
  buildLightningUrl: (objectType, recordId) =>
    recordId ? `https://example.salesforce.com/lightning/r/${objectType}/${recordId}/view` : null,
}));

const mockDb = vi.fn();
const mockChain = {
  then(onFulfilled, onRejected) {
    return Promise.resolve(mockDb()).then(onFulfilled, onRejected);
  },
  select() { return this; },
  insert() { return this; },
  delete() { return this; },
  eq() { return this; },
  or() { return this; },
  order() { return this; },
  single() { return mockDb(); },
  maybeSingle() { return mockDb(); },
};
const mockFrom = vi.fn(() => mockChain);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function makeReq(method, body, url = "http://localhost/api/calls?resource=presets") {
  const headers = new Headers({
    Authorization: "Bearer token",
    "Content-Type": "application/json",
  });
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDb.mockReset();
  mockFrom.mockClear();
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mockVerifyJWT.mockResolvedValue({ id: "user-123" });
  mockDb.mockResolvedValue({ data: null, error: null });
});

describe("parsePresetId", () => {
  it("accepts safe positive integers", () => {
    expect(parsePresetId(5)).toBe(5);
    expect(parsePresetId("42")).toBe(42);
    expect(parsePresetId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects partial, unsafe or non-integer values", () => {
    expect(parsePresetId("1abc")).toBeNull();
    expect(parsePresetId("1.5")).toBeNull();
    expect(parsePresetId("1e3")).toBeNull();
    expect(parsePresetId("0")).toBeNull();
    expect(parsePresetId("-3")).toBeNull();
    expect(parsePresetId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(parsePresetId(String(Number.MAX_SAFE_INTEGER) + "0")).toBeNull();
  });
});

describe("validatePresetInput", () => {
  it("rejects invalid body and filters families", () => {
    expect(validatePresetInput(null).error).toBe("invalid_body");
    expect(validatePresetInput({ name: "", filters: {} }).error).toBe("invalid_name");
    expect(validatePresetInput({ name: "X", filters: { relance: [] } }).error).toBe("invalid_filters");
    expect(validatePresetInput({ name: "X", filters: {}, shared: "yes" }).error).toBe("invalid_shared");
  });
});

describe("GET /api/calls?resource=presets", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });

  it("returns presets for owner or shared", async () => {
    mockDb.mockResolvedValue({
      data: [{ id: 1, owner: "user-123", name: "Mine", filters: {}, shared: false, created_at: "2026-07-10" }],
      error: null,
    });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toHaveLength(1);
  });
});

describe("POST /api/calls action=save_preset", () => {
  it("returns 400 for invalid JSON", async () => {
    const headers = new Headers({ Authorization: "Bearer token", "Content-Type": "application/json" });
    const res = await POST(new Request("http://localhost/api/calls", { method: "POST", headers, body: "{bad" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("creates a preset", async () => {
    mockDb.mockResolvedValue({
      data: { id: 9, owner: "user-123", name: "Finance", filters: { contact: {} }, shared: false, created_at: "2026-07-10" },
      error: null,
    });
    const res = await POST(makeReq("POST", {
      action: "save_preset",
      name: "Finance",
      filters: { contact: {} },
      shared: false,
    }, "http://localhost/api/calls"));
    expect(res.status).toBe(200);
    expect((await res.json()).preset.name).toBe("Finance");
  });
});

describe("DELETE /api/calls?resource=presets", () => {
  it("returns 400 for invalid id", async () => {
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/calls?resource=presets&id=1abc"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when preset missing", async () => {
    mockDb.mockResolvedValue({ data: null, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/calls?resource=presets&id=3"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when preset owned by someone else", async () => {
    mockDb.mockResolvedValue({ data: { id: 3, owner: "other" }, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/calls?resource=presets&id=3"));
    expect(res.status).toBe(404);
  });

  it("deletes owned preset", async () => {
    mockDb
      .mockResolvedValueOnce({ data: { id: 3, owner: "user-123" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/calls?resource=presets&id=3"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
