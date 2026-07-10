import { describe, expect, it } from "vitest";
import { GET } from "./salesforce.js";

describe("GET /api/auth/salesforce (Phase 8.1 stub)", () => {
  it("redirects to the login screen with sf_coming_soon until OAuth is wired", async () => {
    const response = await GET(new Request("https://xos.hellotheo.fr/api/auth/salesforce"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://xos.hellotheo.fr/?auth_error=sf_coming_soon",
    );
  });
});
