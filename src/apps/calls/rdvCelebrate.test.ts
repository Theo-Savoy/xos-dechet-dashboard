import { describe, expect, it } from "vitest";
import { countSessionRdvs, rdvHeatLevel } from "./rdvCelebrate";

describe("rdvCelebrate", () => {
  it("counts RDV in the session", () => {
    expect(
      countSessionRdvs([
        { outcome: "RDV planifié" },
        { outcome: "Appel décroché" },
        { outcome: "RDV planifié" },
      ]),
    ).toBe(2);
  });

  it("escalates heat with count and goal hit", () => {
    expect(rdvHeatLevel(1, false)).toBe(1);
    expect(rdvHeatLevel(3, false)).toBe(2);
    expect(rdvHeatLevel(5, false)).toBe(3);
    expect(rdvHeatLevel(8, false)).toBe(4);
    expect(rdvHeatLevel(2, true)).toBe(5);
  });
});
