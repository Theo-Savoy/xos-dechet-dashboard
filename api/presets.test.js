import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE, parsePresetId, validatePresetInput } from "./presets.js";

const { mockVerifyJWT } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
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

function makeReq(method, body, url = "http://localhost/api/presets") {
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

describe("GET /api/presets", () => {
  it("returns 401 when unauthorized", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });

  it("returns 500 on DB lookup error", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "db" } });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("preset_lookup_failed");
  });

  it("returns presets list", async () => {
    mockDb.mockResolvedValueOnce({
      data: [{ id: 1, owner: "user-123", name: "Prospects", filters: {}, shared: false, created_at: "2026-01-01" }],
      error: null,
    });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).presets).toHaveLength(1);
  });
});

describe("POST /api/presets", () => {
  it("returns 400 on invalid JSON", async () => {
    const headers = new Headers({ Authorization: "Bearer token", "Content-Type": "application/json" });
    const res = await POST(new Request("http://localhost/api/presets", { method: "POST", headers, body: "{bad" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 400 on invalid filters", async () => {
    const res = await POST(makeReq("POST", { name: "X", filters: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_filters");
  });

  it("creates preset", async () => {
    mockDb.mockResolvedValueOnce({
      data: { id: 2, owner: "user-123", name: "Relance", filters: { relance: {} }, shared: false, created_at: "2026-01-01" },
      error: null,
    });
    const res = await POST(makeReq("POST", { name: "Relance", filters: { relance: {} } }));
    expect(res.status).toBe(200);
    expect((await res.json()).preset.name).toBe("Relance");
  });

  it("returns 500 when creation fails", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "insert failed" } });
    const res = await POST(makeReq("POST", { name: "Relance", filters: {} }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("preset_creation_failed");
  });
});

describe("DELETE /api/presets", () => {
  it("returns 400 for invalid id strings", async () => {
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=1abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_id");
  });

  it("returns 500 when preset lookup fails", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: { message: "db" } });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=3"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("preset_lookup_failed");
  });

  it("returns 404 when preset not owned by user", async () => {
    mockDb.mockResolvedValueOnce({ data: { id: 3, owner: "other-user" }, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=3"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when preset does not exist", async () => {
    mockDb.mockResolvedValueOnce({ data: null, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=3"));
    expect(res.status).toBe(404);
  });

  it("deletes owned preset", async () => {
    mockDb
      .mockResolvedValueOnce({ data: { id: 3, owner: "user-123" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=3"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 500 when delete fails", async () => {
    mockDb
      .mockResolvedValueOnce({ data: { id: 3, owner: "user-123" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "delete failed" } });
    const res = await DELETE(makeReq("DELETE", undefined, "http://localhost/api/presets?id=3"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("preset_delete_failed");
  });
});
