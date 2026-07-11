import { describe, expect, it } from "vitest";
import {
  canManageRoles,
  canManageSettings,
  canViewTeamPerf,
  roleAtLeast,
  roleFromEmail,
} from "./access.js";

describe("roleFromEmail (XOS bootstrap)", () => {
  it("maps known emails to admin / manager", () => {
    expect(roleFromEmail("theo.savoy@xos-learning.fr")).toBe("admin");
    expect(roleFromEmail("  Jerome.Bosio@XOS-LEARNING.FR ")).toBe("manager");
    expect(roleFromEmail("paul.rathouin@xos-learning.fr")).toBe("manager");
  });

  it("defaults unknown users to commercial", () => {
    expect(roleFromEmail("yanis.agharbi@xos-learning.fr")).toBe("commercial");
    expect(roleFromEmail("")).toBe("commercial");
  });
});

describe("role hierarchy", () => {
  it("admin supersedes manager supersedes commercial", () => {
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("manager", "manager")).toBe(true);
    expect(roleAtLeast("commercial", "manager")).toBe(false);
    expect(canManageSettings("admin")).toBe(true);
    expect(canManageSettings("manager")).toBe(true);
    expect(canManageSettings("commercial")).toBe(false);
    expect(canManageRoles("admin")).toBe(true);
    expect(canManageRoles("manager")).toBe(false);
    expect(canViewTeamPerf("manager")).toBe(true);
    expect(canViewTeamPerf("commercial")).toBe(false);
  });
});
