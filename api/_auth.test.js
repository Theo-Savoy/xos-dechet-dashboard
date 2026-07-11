import { beforeEach, describe, expect, it, vi } from "vitest";

function requestFor(token) {
  return new Request("http://localhost", { headers: { authorization: `Bearer ${token}` } });
}

async function loadAuth() {
  vi.resetModules();
  vi.stubEnv("SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  return import("./_auth.js");
}

describe("verifyJWT cache", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns a fresh cached user without a second network request", async () => {
    const { verifyJWT } = await loadAuth();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "user-1" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyJWT(requestFor("token-1"))).resolves.toEqual({ id: "user-1" });
    await expect(verifyJWT(requestFor("token-1"))).resolves.toEqual({ id: "user-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the five-minute TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { verifyJWT } = await loadAuth();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "user-1" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await verifyJWT(requestFor("token-1"));
    await verifyJWT(requestFor("token-1"));
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await verifyJWT(requestFor("token-1"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not cache failed verification responses", async () => {
    const { verifyJWT } = await loadAuth();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyJWT(requestFor("invalid-token"))).resolves.toBeNull();
    await expect(verifyJWT(requestFor("invalid-token"))).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts Vercel Node request headers used by legacy handlers", async () => {
    const { verifyJWT } = await loadAuth();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "user-node" }), { status: 200 }),
    ));

    await expect(verifyJWT({ headers: { authorization: "Bearer node-token" } }))
      .resolves.toEqual({ id: "user-node" });
  });

  it("evicts the oldest token when inserting a 201st entry", async () => {
    const { verifyJWT } = await loadAuth();
    const fetchMock = vi.fn((_, init) => {
      const token = String(init.headers.Authorization).slice(7);
      return Promise.resolve(new Response(JSON.stringify({ id: token }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 201; index += 1) {
      await verifyJWT(requestFor(`token-${index}`));
    }
    await verifyJWT(requestFor("token-200"));
    await verifyJWT(requestFor("token-0"));

    expect(fetchMock).toHaveBeenCalledTimes(202);
  });
});
