import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSFTokenCache,
  fetchSFToken,
  logCall,
  updateSObjects,
} from "./salesforce.js";
import {
  decryptRefreshToken,
  encryptRefreshToken,
} from "./tokenEncryption.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function profileClient(profile) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ select })) }, select, eq, maybeSingle };
}

describe("Salesforce per-user credentials", () => {
  beforeEach(() => {
    vi.stubEnv("SF_CLIENT_ID", "client");
    vi.stubEnv("SF_CLIENT_SECRET", "secret");
    vi.stubEnv("SF_REFRESH_TOKEN", "integration-refresh");
    vi.stubEnv("SF_LOGIN_URL", "https://login.example.test");
    vi.stubEnv("SF_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    __resetSFTokenCache();
  });

  it("encrypts refresh tokens with authenticated encryption", async () => {
    const encrypted = await encryptRefreshToken("user-refresh-token");

    expect(encrypted).not.toContain("user-refresh-token");
    await expect(decryptRefreshToken(encrypted)).resolves.toBe("user-refresh-token");
    const parts = encrypted.split(".");
    parts[2] = `${parts[2].slice(0, 3)}x${parts[2].slice(4)}`;
    await expect(decryptRefreshToken(parts.join("."))).rejects.toThrow();
  });

  it("uses and caches the linked user's refresh token", async () => {
    const ciphertext = await encryptRefreshToken("ada-refresh");
    const { client, maybeSingle } = profileClient({ sf_refresh_token_encrypted: ciphertext });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "ada-access" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSFToken({ client, userId: "user-ada" })).resolves.toMatchObject({
      accessToken: "ada-access",
      credential: "user",
    });
    await expect(fetchSFToken({ client, userId: "user-ada" })).resolves.toMatchObject({
      accessToken: "ada-access",
      credential: "user",
    });

    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("refresh_token=ada-refresh");
  });

  it("falls back to the integration refresh token when the user is not linked", async () => {
    const { client } = profileClient({ sf_refresh_token_encrypted: null });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "integration-access" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSFToken({ client, userId: "user-unlinked" })).resolves.toEqual({ accessToken: "integration-access" });
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("refresh_token=integration-refresh");
  });

  it("retries a rejected write with a freshly minted token for the same user", async () => {
    const ciphertext = await encryptRefreshToken("ada-refresh");
    const { client, maybeSingle } = profileClient({ sf_refresh_token_encrypted: ciphertext });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "ada-stale" }))
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "ada-fresh" }))
      .mockResolvedValueOnce(jsonResponse({ id: "00TADA" }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await fetchSFToken({ client, userId: "user-ada" });
    await expect(logCall(token.accessToken, { contactId: "003", resultat: "Appel décroché" }))
      .resolves.toEqual({ record: { id: "00TADA" } });

    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer ada-fresh");
  });

  it("uses the same per-user retry path for composite updates", async () => {
    const ciphertext = await encryptRefreshToken("ada-refresh");
    const { client } = profileClient({ sf_refresh_token_encrypted: ciphertext });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "ada-access" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "006", success: true, errors: [] }]));
    vi.stubGlobal("fetch", fetchMock);

    const token = await fetchSFToken({ client, userId: "user-ada" });
    await expect(updateSObjects(token.accessToken, "Opportunity", [{ id: "006", StageName: "Gagnée" }]))
      .resolves.toEqual({ records: [{ id: "006", success: true, errors: [] }] });
    expect(fetchMock.mock.calls[1][0]).toContain("/composite/sobjects");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer ada-access");
  });
});
