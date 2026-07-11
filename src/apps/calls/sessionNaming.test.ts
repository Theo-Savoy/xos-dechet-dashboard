import { describe, expect, it } from "vitest";
import { nextContinuationName } from "./sessionNaming";

describe("nextContinuationName", () => {
  it("appends #2 to a plain session name", () => {
    expect(nextContinuationName("Prospection Lyon")).toBe("Prospection Lyon #2");
  });

  it("increments an existing suffix", () => {
    expect(nextContinuationName("Prospection Lyon #2")).toBe("Prospection Lyon #3");
    expect(nextContinuationName("Relance — Acme #9")).toBe("Relance — Acme #10");
  });

  it("falls back when empty", () => {
    expect(nextContinuationName("")).toBe("Séance #2");
  });
});
