import { describe, expect, it } from "vitest";
import { buildPreviewContactList, canSelectContact, selectIdsWithCompanyCap, titlePriority } from "./selection";

const contacts = [
  { sf_contact_id: "c1", sf_account_id: "a1", title: "Chargé de formation" },
  { sf_contact_id: "c2", sf_account_id: "a1", title: "Directeur formation" },
  { sf_contact_id: "c3", sf_account_id: "a1", title: "Responsable RH" },
  { sf_contact_id: "c4", sf_account_id: "a2", title: null },
  { sf_contact_id: "c5", sf_account_id: null, title: "CEO" },
];

describe("titlePriority", () => {
  it("ranks dirigeants and directeurs above chargés", () => {
    expect(titlePriority("Directeur formation")).toBeGreaterThan(titlePriority("Responsable formation"));
    expect(titlePriority("Responsable RH")).toBeGreaterThan(titlePriority("Chargé de formation"));
    expect(titlePriority("DRH adjoint")).toBeGreaterThan(titlePriority("Chef de projet"));
    expect(titlePriority(null)).toBe(0);
  });
});

describe("buildPreviewContactList", () => {
  it("returns up to totalLimit without a per-company cap", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      sf_contact_id: `c${index}`,
      sf_account_id: `a${index}`,
      title: null,
    }));
    expect(buildPreviewContactList(many, 5, null)).toHaveLength(5);
  });

  it("fills totalLimit across companies with max per company, not fewer contacts", () => {
    const contacts = [];
    for (let company = 0; company < 40; company += 1) {
      for (let slot = 0; slot < 5; slot += 1) {
        contacts.push({
          sf_contact_id: `c-${company}-${slot}`,
          sf_account_id: `a-${company}`,
          title: slot === 0 ? "Directeur" : `Chargé ${slot}`,
        });
      }
    }

    const preview = buildPreviewContactList(contacts, 100, 3);
    expect(preview).toHaveLength(100);

    const perCompany = new Map<string, number>();
    for (const contact of preview) {
      const key = contact.sf_account_id!;
      perCompany.set(key, (perCompany.get(key) ?? 0) + 1);
    }
    for (const count of perCompany.values()) {
      expect(count).toBeLessThanOrEqual(3);
    }
    expect(perCompany.size).toBeGreaterThan(30);
  });

  it("prefers directeurs within each company when capping", () => {
    const contacts = [
      { sf_contact_id: "c1", sf_account_id: "a1", title: "Chargé de formation" },
      { sf_contact_id: "c2", sf_account_id: "a1", title: "Directeur formation" },
      { sf_contact_id: "c3", sf_account_id: "a2", title: null },
    ];
    expect(buildPreviewContactList(contacts, 10, 1).map((c) => c.sf_contact_id).sort()).toEqual(["c2", "c3"]);
  });
});

describe("selectIdsWithCompanyCap", () => {
  it("selects everyone when there is no cap", () => {
    expect([...selectIdsWithCompanyCap(contacts, null)].sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("prefers directeurs / responsables when capping to 1 per company", () => {
    expect([...selectIdsWithCompanyCap(contacts, 1)].sort()).toEqual(["c2", "c4", "c5"]);
  });

  it("prefers the two highest titles when capping to 2", () => {
    expect([...selectIdsWithCompanyCap(contacts, 2)].sort()).toEqual(["c2", "c3", "c4", "c5"]);
  });

  it("respects an eligibility set (dedup exclude)", () => {
    const eligible = new Set(["c1", "c3", "c4"]);
    // c2 (directeur) excluded → responsable c3 wins for a1
    expect([...selectIdsWithCompanyCap(contacts, 1, eligible)].sort()).toEqual(["c3", "c4"]);
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
