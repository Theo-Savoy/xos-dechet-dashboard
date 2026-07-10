import { afterEach, describe, expect, it, vi } from "vitest";
import { logCall } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logCall", () => {
  it("omits duration_sec when the optional UI duration is null", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await logCall("token", 12, 34, "Appel décroché", "Notes", null);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(JSON.parse(String(firstCall?.[1]?.body))).not.toHaveProperty("duration_sec");
  });

  it("preserves a supplied non-negative integer duration", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await logCall("token", 12, 34, "Appel décroché", "Notes", 0);

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(JSON.parse(String(firstCall?.[1]?.body))).toMatchObject({ duration_sec: 0 });
  });

  it("rejects a supplied duration that is not a non-negative integer", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(logCall("token", 12, 34, "Appel décroché", "Notes", 1.5)).rejects.toThrow(
      "durée doit être un entier positif ou nul",
    );
  });
});
