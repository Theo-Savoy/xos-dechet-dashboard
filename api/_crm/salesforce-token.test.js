import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSFTokenCache,
  fetchSFToken,
  logCall,
  searchContacts,
  updateContactDoNotCall,
} from "./salesforce.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("Salesforce token cache and paginated queries", () => {
  beforeEach(() => {
    process.env.SF_CLIENT_ID = "client";
    process.env.SF_CLIENT_SECRET = "secret";
    process.env.SF_REFRESH_TOKEN = "refresh";
    process.env.SF_LOGIN_URL = "https://login.example.test";
    process.env.SF_INSTANCE_URL = "https://instance.example.test";
    __resetSFTokenCache();
  });

  afterEach(() => {
    __resetSFTokenCache();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns a cached token on the second successful call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "cached-token" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSFToken()).resolves.toEqual({ accessToken: "cached-token" });
    await expect(fetchSFToken()).resolves.toEqual({ accessToken: "cached-token" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes the token when forceRefresh is requested or the TTL expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "first-token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "second-token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "third-token" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSFToken();
    await expect(fetchSFToken({ forceRefresh: true })).resolves.toEqual({ accessToken: "second-token" });
    vi.advanceTimersByTime(30 * 60_000 + 1);
    await expect(fetchSFToken()).resolves.toEqual({ accessToken: "third-token" });
  });

  it("follows query pages and truncates records at the fetch cap", async () => {
    const firstPage = Array.from({ length: 1_999 }, (_, index) => ({ Id: String(index) }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ records: firstPage, done: false, nextRecordsUrl: "/next" }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ Id: "last" }, { Id: "truncated" }], done: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchContacts("token", "SELECT Id FROM Contact");

    expect(result).toEqual({ records: [...firstPage, { Id: "last" }], truncated: true });
    expect(fetchMock.mock.calls[1][0]).toBe("https://instance.example.test/next");
  });

  it("retries a query once with a refreshed token after a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ Id: "003" }], done: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchContacts("stale-token", "SELECT Id FROM Contact")).resolves.toEqual({ records: [{ Id: "003" }], truncated: false });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh-token");
  });

  it("returns the query error after a second 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ message: "still expired" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchContacts("stale-token", "SELECT Id FROM Contact")).resolves.toEqual({
      error: "sf_query_error",
      message: '{"message":"still expired"}',
    });
  });

  it("retries Salesforce writes with a refreshed token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "00T" }))
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token-2" }))
      .mockResolvedValueOnce(jsonResponse({}, 204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logCall("stale-token", { contactId: "003", resultat: "Appel décroché" })).resolves.toEqual({ record: { id: "00T" } });
    await expect(updateContactDoNotCall("stale-token", "003", true)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh-token");
    expect(fetchMock.mock.calls[5][1].headers.Authorization).toBe("Bearer fresh-token-2");
  });
});
