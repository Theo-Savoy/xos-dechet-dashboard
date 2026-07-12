// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  digitFromKeyboardCode,
  filterComboActions,
  isTypingTarget,
  resultatFromDigit,
} from "./comboKeyboard";

describe("comboKeyboard", () => {
  it("maps digits to resultats", () => {
    expect(resultatFromDigit("1")).toBe("Appel non décroché");
    expect(resultatFromDigit("5")).toBe("RDV planifié");
    expect(resultatFromDigit("9")).toBeNull();
  });

  it("maps physical Digit1–5 codes (AZERTY-safe)", () => {
    expect(digitFromKeyboardCode("Digit1")).toBe("1");
    expect(digitFromKeyboardCode("Digit3")).toBe("3");
    expect(digitFromKeyboardCode("Digit9")).toBeNull();
    expect(digitFromKeyboardCode("KeyA")).toBeNull();
  });
  it("filters command bar actions by query", () => {
    const hits = filterComboActions("npa");
    expect(hits.some((action) => action.id === "toggle-npa")).toBe(true);
    expect(filterComboActions("zzzz").length).toBe(0);
  });

  it("detects typing targets", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });
});
