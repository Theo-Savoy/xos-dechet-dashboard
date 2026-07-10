import { describe, expect, it } from "vitest";
import { canSelectContact, selectIdsWithCompanyCap } from "./selection";

const contacts = [
  { sf_contact_id: "c1", sf_account_id: "a1" },
  { sf_contact_id: "c2", sf_account_id: "a1" },
  { sf_contact_id: "c3", sf_account_id: "a1" },
  { sf_contact_id: "c4", sf_account_id: "a2" },
  { sf_contact_id: "c5", sf_account_id: null },
];

describe("selectIdsWithCompanyCap", () => {
  it("selects everyone when there is no cap", () => {
    expect([...selectIdsWithCompanyCap(contacts, null)].sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("keeps the first N contacts per account", () => {
    expect([...selectIdsWithCompanyCap(contacts, 1)].sort()).toEqual(["c1", "c4", "c5"]);
    expect([...selectIdsWithCompanyCap(contacts, 2)].sort()).toEqual(["c1", "c2", "c4", "c5"]);
  });

  it("respects an eligibility set (dedup exclude)", () => {
    const eligible = new Set(["c2", "c3", "c4"]);
    expect([...selectIdsWithCompanyCap(contacts, 1, eligible)].sort()).toEqual(["c2", "c4"]);
  });
});

describe("canSelectContact", () => {
  it("allows selection under the cap and blocks beyond it", () => {
    const selected = new Set(["c1"]);
    expect(canSelectContact(contacts, selected, "c2", 1)).toBe(false);
    expect(canSelectContact(contacts, selected, "c4", 1)).toBe(true);
    expect(canSelectContact(contacts, selected, "c2", 2)).toBe(true);
  });

  it("always allows deselecting an already selected contact", () => {
    const selected = new Set(["c1", "c2"]);
    expect(canSelectContact(contacts, selected, "c1", 1)).toBe(true);
  });
});
