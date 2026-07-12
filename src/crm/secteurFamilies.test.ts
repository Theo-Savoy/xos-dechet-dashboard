import { describe, expect, it } from "vitest";
import { SECTEUR_VALUES } from "./secteurValues";
import { SECTEUR_FAMILIES, secteurFamilyByValue } from "./secteurFamilies";

describe("secteurFamilies", () => {
  it("covers every secteur exactly once", () => {
    const flat = SECTEUR_FAMILIES.flatMap((family) => family.secteurs);
    expect(flat).toHaveLength(SECTEUR_VALUES.length);
    expect(new Set(flat).size).toBe(SECTEUR_VALUES.length);
    for (const secteur of SECTEUR_VALUES) {
      expect(flat).toContain(secteur);
      expect(secteurFamilyByValue(secteur)?.secteurs).toContain(secteur);
    }
  });
});
