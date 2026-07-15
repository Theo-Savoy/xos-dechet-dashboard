import { describe, expect, it } from "vitest";
import { packAccountsIntoSessions, type PackableAccount } from "./audienceBinPacking";

function account(id: string, name: string, contactCount: number): PackableAccount<{ id: string }> {
  return {
    id,
    name,
    contacts: Array.from({ length: contactCount }, (_, i) => ({ id: `${id}-c${i}` })),
  };
}

describe("packAccountsIntoSessions", () => {
  it("never splits a single account across sessions, even past the target size", () => {
    const groups = packAccountsIntoSessions([account("a1", "Big Corp", 200)], 50, 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalContacts).toBe(200);
    expect(groups[0].accountIds).toEqual(["a1"]);
  });

  it("groups the biggest accounts first and stays under the 20% tolerance", () => {
    const accounts = [account("a1", "ACME Corp", 40), account("a2", "ACME Subsidiary", 25), account("a3", "Globex", 38), account("a4", "Wayne", 22)];
    const groups = packAccountsIntoSessions(accounts, 50, 5);
    for (const group of groups) {
      expect(group.totalContacts).toBeLessThanOrEqual(50 * 1.2);
    }
    const totalPacked = groups.reduce((sum, g) => sum + g.totalContacts, 0);
    expect(totalPacked).toBe(40 + 25 + 38 + 22);
  });

  it("caps at maxSessions and drops accounts that no longer fit", () => {
    const accounts = [account("a1", "One", 60), account("a2", "Two", 60), account("a3", "Three", 60)];
    const groups = packAccountsIntoSessions(accounts, 50, 2);
    expect(groups.length).toBeLessThanOrEqual(2);
  });

  it("ignores accounts with zero contacts and returns no groups when nothing is eligible", () => {
    const accounts = [account("a1", "Empty", 0), account("a2", "Also empty", 0)];
    expect(packAccountsIntoSessions(accounts, 50, 5)).toEqual([]);
  });

  it("returns groups ordered from biggest to smallest", () => {
    const accounts = [account("a1", "Small", 5), account("a2", "Large", 45)];
    const groups = packAccountsIntoSessions(accounts, 50, 5);
    expect(groups.length).toBeGreaterThan(0);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].totalContacts).toBeGreaterThanOrEqual(groups[i].totalContacts);
    }
  });
});
