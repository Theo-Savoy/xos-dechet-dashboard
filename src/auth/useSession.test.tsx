// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSession = {
  user: { email: "theo@xos-learning.fr" },
  access_token: "test-token-abc",
  provider_refresh_token: "sf-provider-refresh",
};

type MockSession = typeof mockSession;

let getSessionResolver: ((value: { data: { session: MockSession | null } }) => void) | null =
  null;
let getSessionRejecter: ((reason: unknown) => void) | null = null;
let bridgeResolver: ((value: Response) => void) | null = null;
let bridgeRejecter: ((reason: unknown) => void) | null = null;
let capturedAuthCallback: ((event: string, session: MockSession | null) => void) | null = null;

const { getSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(
    () =>
      new Promise<{ data: { session: MockSession | null } }>((resolve, reject) => {
        getSessionResolver = resolve;
        getSessionRejecter = reject;
      }),
  ),
  onAuthStateChange: vi.fn(
    (cb: (event: string, session: MockSession | null) => void) => {
      capturedAuthCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  ),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getSession, onAuthStateChange },
  },
}));

import { useSession } from "./useSession";

describe("useSession — auth bridge", () => {
  beforeEach(() => {
    getSessionResolver = null;
    getSessionRejecter = null;
    bridgeResolver = null;
    bridgeRejecter = null;
    capturedAuthCallback = null;
    getSession.mockClear();
    onAuthStateChange.mockClear();

    vi.stubGlobal("fetch", vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          bridgeResolver = resolve;
          bridgeRejecter = reject;
        }),
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps loading=true and session=null while bridge is pending", async () => {
    const { result } = renderHook(() => useSession());

    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.bridgeError).toBe(false);

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/auth", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer test-token-abc",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ salesforce_refresh_token: "sf-provider-refresh" }),
    }));

    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.bridgeError).toBe(false);
  });

  it("exposes session and sets loading=false after bridge responds ok", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      bridgeResolver!(new Response(null, { status: 204 }));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBe(mockSession);
      expect(result.current.bridgeError).toBe(false);
    });
  });

  it("sets bridgeError=true when bridge returns non-ok", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });

    await act(async () => {
      bridgeResolver!(new Response(null, { status: 401 }));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBeNull();
      expect(result.current.bridgeError).toBe(true);
    });
  });

  it("sets bridgeError=true when bridge fetch rejects", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });

    await act(async () => {
      bridgeRejecter!(new TypeError("Network error"));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBeNull();
      expect(result.current.bridgeError).toBe(true);
    });
  });

  it("exposes session directly when no session exists (no bridge needed)", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: null } });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBeNull();
      expect(result.current.bridgeError).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("deduplicates bridge when onAuthStateChange fires alongside getSession", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
      capturedAuthCallback!("SIGNED_IN", mockSession);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      bridgeResolver!(new Response(null, { status: 204 }));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBe(mockSession);
    });
  });

  it("updates session in place on TOKEN_REFRESHED without clearing it", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });
    await act(async () => {
      bridgeResolver!(new Response(null, { status: 204 }));
    });
    await waitFor(() => {
      expect(result.current.session).toBe(mockSession);
    });

    const refreshed = {
      ...mockSession,
      access_token: "refreshed-token",
    };

    await act(async () => {
      capturedAuthCallback!("TOKEN_REFRESHED", refreshed);
    });

    expect(result.current.session).toBe(refreshed);
    expect(result.current.loading).toBe(false);
    expect(result.current.bridgeError).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps session null after logout even if a stale bridge resolves ok", async () => {
    const { result } = renderHook(() => useSession());

    // Start bridge
    await act(async () => {
      getSessionResolver!({ data: { session: mockSession } });
    });

    expect(result.current.loading).toBe(true);

    // User logs out while bridge is still pending
    await act(async () => {
      capturedAuthCallback!("SIGNED_OUT", null);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.bridgeError).toBe(false);

    // Stale bridge resolves ok — must NOT resurrect the session
    await act(async () => {
      bridgeResolver!(new Response(null, { status: 204 }));
    });

    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.bridgeError).toBe(false);
  });

  it("sets bridgeError when getSession rejects", async () => {
    const { result } = renderHook(() => useSession());

    await act(async () => {
      getSessionRejecter!(new Error("Supabase unavailable"));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.session).toBeNull();
      expect(result.current.bridgeError).toBe(true);
    });
  });
});
