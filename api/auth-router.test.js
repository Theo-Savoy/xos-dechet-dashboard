import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "./auth.js";

const { mockVerifyJWT, mockStartSalesforceOAuth, mockCompleteSalesforceOAuth, mockStoreSalesforceRefreshToken, mockGetServiceClient } = vi.hoisted(() => ({
  mockVerifyJWT: vi.fn(),
  mockStartSalesforceOAuth: vi.fn(),
  mockCompleteSalesforceOAuth: vi.fn(),
  mockStoreSalesforceRefreshToken: vi.fn(),
  mockGetServiceClient: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  verifyJWT: mockVerifyJWT,
  respond: (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }),
}));
vi.mock("./_calls/http.js", () => ({ getServiceClient: mockGetServiceClient }));
vi.mock("./_crm/salesforceOAuth.js", () => ({
  startSalesforceOAuth: mockStartSalesforceOAuth,
  completeSalesforceOAuth: mockCompleteSalesforceOAuth,
  storeSalesforceRefreshToken: mockStoreSalesforceRefreshToken,
}));

describe("GET /api/auth", () => {
  it("redirects Salesforce flow to the login screen with sf_coming_soon until OAuth is wired", async () => {
    const response = await GET(new Request("https://xos.hellotheo.fr/api/auth?flow=salesforce"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://xos.hellotheo.fr/?auth_error=sf_coming_soon",
    );
  });

  it("rejects unrecognized flows", async () => {
    const response = await GET(new Request("https://xos.hellotheo.fr/api/auth"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_flow" });
  });

  it("completes the dedicated Salesforce link callback", async () => {
    mockGetServiceClient.mockReturnValue({ from: vi.fn() });
    mockCompleteSalesforceOAuth.mockResolvedValue({ ok: true });
    const response = await GET(new Request(
      "https://xos.hellotheo.fr/api/auth?flow=salesforce-callback&code=code&state=state",
    ));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://xos.hellotheo.fr/?sf_link=success");
  });
});

describe("POST /api/auth", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_PASSWORD", "legacy-password");
    mockVerifyJWT.mockResolvedValue({ id: "user-1" });
    mockGetServiceClient.mockReturnValue({ from: vi.fn() });
    mockStartSalesforceOAuth.mockResolvedValue({ authorizationUrl: "https://login.salesforce.test/authorize" });
    mockStoreSalesforceRefreshToken.mockResolvedValue({ ok: true });
  });

  it("sets the legacy cookie after JWT verification", async () => {
    const response = await POST(new Request("https://xos.hellotheo.fr/api/auth", { method: "POST" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toBe(
      "xos_auth=legacy-password; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000",
    );
  });

  it("preserves the unauthorized response", async () => {
    mockVerifyJWT.mockResolvedValue(null);
    const response = await POST(new Request("https://xos.hellotheo.fr/api/auth", { method: "POST" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("starts account linking only for an authenticated X OS user", async () => {
    const response = await POST(new Request(
      "https://xos.hellotheo.fr/api/auth?flow=salesforce-link",
      { method: "POST", headers: { Authorization: "Bearer jwt" } },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorization_url: "https://login.salesforce.test/authorize" });
    expect(mockStartSalesforceOAuth).toHaveBeenCalledWith(expect.objectContaining({
      user: { id: "user-1" },
      origin: "https://xos.hellotheo.fr",
    }));
  });

  it("automatically stores the Salesforce provider refresh token during the session bridge", async () => {
    const response = await POST(new Request("https://xos.hellotheo.fr/api/auth", {
      method: "POST",
      headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ salesforce_refresh_token: "provider-refresh" }),
    }));
    expect(response.status).toBe(204);
    expect(mockStoreSalesforceRefreshToken).toHaveBeenCalledWith(expect.objectContaining({
      user: { id: "user-1" },
      refreshToken: "provider-refresh",
    }));
  });
});

describe("OPTIONS /api/auth", () => {
  it("advertises GET and POST", async () => {
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });
});
