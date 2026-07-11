// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isAuthBridge, isProtected, isPublic } from "./middleware.js";

describe("middleware route classifiers", () => {
  it("treats /api/auth as the public JWT bridge (ex sso-bridge)", () => {
    expect(isAuthBridge("/api/auth")).toBe(true);
    expect(isAuthBridge("/api/sso-bridge")).toBe(true);
    expect(isAuthBridge("/api/calls")).toBe(false);
  });

  it("keeps SPA root public and APIs protected by default", () => {
    expect(isPublic("/")).toBe(true);
    expect(isPublic("/assets/index.js")).toBe(true);
    expect(isProtected("/api/calls")).toBe(true);
    expect(isProtected("/dashboard.html")).toBe(true);
  });
});
