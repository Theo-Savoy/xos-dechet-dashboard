import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptRefreshToken } from "./tokenEncryption.js";
import { completeSalesforceOAuth, startSalesforceOAuth, storeSalesforceRefreshToken } from "./salesforceOAuth.js";

function dbClient(profile = null) {
  const updates = [];
  const from = vi.fn(() => ({
    update(value) {
      updates.push(value);
      return {
        eq() { return this; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
    },
    select() {
      return {
        eq() { return this; },
        gt() { return this; },
        maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
      };
    },
  }));
  return { client: { from }, updates };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("Salesforce OAuth account linking", () => {
  beforeEach(() => {
    vi.stubEnv("SF_CLIENT_ID", "client-id");
    vi.stubEnv("SF_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SF_INSTANCE_URL", "https://db0000000d7rdeay.my.salesforce.com");
    vi.stubEnv("SF_LOGIN_URL", "https://login.salesforce.test");
    vi.stubEnv("SF_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  });

  it("creates an authenticated authorization request without persisting the raw state", async () => {
    const { client, updates } = dbClient();
    const result = await startSalesforceOAuth({
      client,
      user: { id: "profile-1" },
      origin: "https://xos.hellotheo.fr",
    });

    const authorization = new URL(result.authorizationUrl);
    expect(authorization.origin).toBe("https://db0000000d7rdeay.my.salesforce.com");
    expect(authorization.pathname).toBe("/services/oauth2/authorize");
    expect(authorization.searchParams.get("client_id")).toBe("client-id");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://xos.hellotheo.fr/api/auth?flow=salesforce-callback",
    );
    expect(authorization.searchParams.get("scope")).toContain("refresh_token");
    expect(authorization.searchParams.get("state")).toBeTruthy();
    expect(updates[0].sf_oauth_state_hash).not.toBe(authorization.searchParams.get("state"));
  });

  it("exchanges the code, verifies the Salesforce identity and stores an encrypted refresh token", async () => {
    const profile = {
      id: "profile-1",
      email: "ada@xos-learning.fr",
      sf_user_id: "005ADA",
    };
    const { client, updates } = dbClient(profile);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        access_token: "access-token",
        refresh_token: "refresh-token",
        instance_url: "https://org.my.salesforce.com",
      }))
      .mockResolvedValueOnce(response({ user_id: "005ADA", email: "ADA@xos-learning.fr" })));

    await expect(completeSalesforceOAuth({
      client,
      url: new URL("https://xos.hellotheo.fr/api/auth?flow=salesforce-callback&code=code-1&state=state-1"),
    })).resolves.toEqual({ ok: true });

    const stored = updates.find((value) => value.sf_refresh_token_encrypted);
    expect(stored.sf_refresh_token_encrypted).not.toContain("refresh-token");
    await expect(decryptRefreshToken(stored.sf_refresh_token_encrypted)).resolves.toBe("refresh-token");
    expect(stored.sf_auth_connected_at).toBeTruthy();
  });

  it("rejects a Salesforce identity that does not match the mapped profile", async () => {
    const { client, updates } = dbClient({
      id: "profile-1",
      email: "ada@xos-learning.fr",
      sf_user_id: "005ADA",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        access_token: "access-token",
        refresh_token: "refresh-token",
        instance_url: "https://org.my.salesforce.com",
      }))
      .mockResolvedValueOnce(response({ user_id: "005OTHER", email: "ada@xos-learning.fr" })));

    await expect(completeSalesforceOAuth({
      client,
      url: new URL("https://xos.hellotheo.fr/api/auth?flow=salesforce-callback&code=code-1&state=state-1"),
    })).resolves.toEqual({ error: "sf_identity_mismatch" });
    expect(updates.some((value) => value.sf_refresh_token_encrypted)).toBe(false);
  });

  it("validates and stores a provider refresh token received after Salesforce login", async () => {
    const { client, updates } = dbClient({
      id: "profile-1",
      email: "ada@xos-learning.fr",
      sf_user_id: "005ADA",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", instance_url: "https://org.my.salesforce.com" }))
      .mockResolvedValueOnce(response({ user_id: "005ADA", email: "ada@xos-learning.fr" })));

    await expect(storeSalesforceRefreshToken({
      client,
      user: { id: "profile-1" },
      refreshToken: "provider-refresh",
    })).resolves.toEqual({ ok: true });

    const stored = updates.find((value) => value.sf_refresh_token_encrypted);
    await expect(decryptRefreshToken(stored.sf_refresh_token_encrypted)).resolves.toBe("provider-refresh");
  });
});
