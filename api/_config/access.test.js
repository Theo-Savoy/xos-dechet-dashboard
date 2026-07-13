import { describe, expect, it } from "vitest";
import {
  canManageRoles,
  canManageSettings,
  canViewTeamPerf,
  canViewWeeklyTeam,
  isWeeklyOwnerExcluded,
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

describe("weekly owner exclusions", () => {
  it("always excludes Théo even by email or name", () => {
    expect(isWeeklyOwnerExcluded({ Name: "Théo Savoy", IsActive: true })).toBe(true);
    expect(isWeeklyOwnerExcluded({ Name: "Theo Savoy", Email: "other@xos-learning.fr", IsActive: true })).toBe(true);
    expect(isWeeklyOwnerExcluded({ Name: "Someone", Email: "theo.savoy@xos-learning.fr", IsActive: true })).toBe(true);
    expect(isWeeklyOwnerExcluded(null, "Théo Savoy", "")).toBe(true);
    expect(isWeeklyOwnerExcluded({ Name: "Ada Lovelace", Email: "ada@xos-learning.fr", IsActive: true })).toBe(false);
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
    expect(canViewWeeklyTeam("commercial")).toBe(true);
    expect(canViewWeeklyTeam("manager")).toBe(true);
  });
});
