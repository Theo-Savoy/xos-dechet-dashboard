import { describe, expect, it } from "vitest";
import { emptyFilterTree, RELANCE_DEFAULT_RESULTATS, RESULTAT_CALL_VALUES } from "./index";

describe("emptyFilterTree", () => {
  it("excludes NPA contacts by default", () => {
    expect(emptyFilterTree().contact.exclure_npa).toBe(true);
  });

  it("requires a telephone number by default", () => {
    expect(emptyFilterTree().contact.a_telephone).toBe(true);
  });

  it("has no active OU-lists by default", () => {
    const tree = emptyFilterTree();
    expect(tree.entreprise.secteurs).toEqual([]);
    expect(tree.entreprise.effectifs).toEqual([]);
    expect(tree.relance.dernier_resultat).toEqual([]);
  });

  it("round-trips through JSON (as sent to /api/calls-list)", () => {
    const tree = emptyFilterTree();
    tree.entreprise.secteurs = ["Finance", "Transports"];
    tree.relance.exclure_si_plus_de = { appels: 3, sur_jours: 30 };
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});

describe("RELANCE_DEFAULT_RESULTATS", () => {
  it("only contains values from RESULTAT_CALL_VALUES", () => {
    for (const r of RELANCE_DEFAULT_RESULTATS) {
      expect(RESULTAT_CALL_VALUES).toContain(r);
    }
  });
});
