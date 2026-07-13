import { describe, expect, it } from "vitest";
import { emptyFilterTree, normalizeFilterTree, RELANCE_DEFAULT_RESULTATS, RESULTAT_CALL_VALUES } from "./index";

describe("emptyFilterTree", () => {
  it("excludes NPA contacts by default", () => {
    expect(emptyFilterTree().contact.exclure_npa).toBe(true);
  });

  it("requires a mobile number by default", () => {
    expect(emptyFilterTree().contact.a_telephone).toBe(true);
  });

  it("has no active OU-lists by default", () => {
    const tree = emptyFilterTree();
    expect(tree.entreprise.secteurs).toEqual([]);
    expect(tree.entreprise.effectifs).toEqual([]);
    expect(tree.entreprise.tiers).toEqual([]);
    expect(tree.entreprise.proprietaires).toEqual([]);
    expect(tree.contact.fonctions).toEqual([]);
    expect(tree.relance.dernier_resultat).toEqual([]);
  });

  it("round-trips through JSON (as sent to /api/calls list_contacts)", () => {
    const tree = emptyFilterTree();
    tree.entreprise.secteurs = ["Banque / finance", "Transports"];
    tree.relance.exclure_si_plus_de = { appels: 3, sur_jours: 30 };
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});

describe("normalizeFilterTree", () => {
  it("fills missing v2.1 keys from a v2.0 preset and drops obsolete duration fields", () => {
    const normalized = normalizeFilterTree({
      entreprise: { secteurs: ["Banque / finance"] },
      contact: { a_telephone: true, exclure_npa: true },
      relance: {
        jamais_appele: true,
        duree_min_sec: 30,
        duree_max_sec: 120,
      },
    });

    expect(normalized.contact.fonctions).toEqual([]);
    expect(normalized.entreprise.tiers).toEqual([]);
    expect(normalized.entreprise.secteurs).toEqual(["Banque / finance"]);
    expect(normalized.relance.jamais_appele).toBe(true);
    expect(normalized.relance).not.toHaveProperty("duree_min_sec");
    expect(normalized.relance).not.toHaveProperty("duree_max_sec");
  });

  it("preserves free-text sectors from legacy presets", () => {
    const normalized = normalizeFilterTree({
      entreprise: { secteurs: ["Finance", "Secteur inventé"] },
    });
    expect(normalized.entreprise.secteurs).toEqual(["Finance", "Secteur inventé"]);
  });

  it("preserves tier filter values", () => {
    const normalized = normalizeFilterTree({
      entreprise: { tiers: ["A", "C"] },
    });
    expect(normalized.entreprise.tiers).toEqual(["A", "C"]);
  });

  it("preserves account owner filters", () => {
    const normalized = normalizeFilterTree({
      entreprise: { proprietaires: ["005A", "005B"] },
    });
    expect(normalized.entreprise.proprietaires).toEqual(["005A", "005B"]);
  });
});

describe("RELANCE_DEFAULT_RESULTATS", () => {
  it("only contains values from RESULTAT_CALL_VALUES", () => {
    for (const r of RELANCE_DEFAULT_RESULTATS) {
      expect(RESULTAT_CALL_VALUES).toContain(r);
    }
  });
});
