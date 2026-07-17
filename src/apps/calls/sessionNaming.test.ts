import { describe, expect, it } from "vitest";
import { nextContinuationName, suggestFollowUpSessionName } from "./sessionNaming";

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

describe("suggestFollowUpSessionName", () => {
  it("builds a readable suggestion with the session name and date", () => {
    expect(suggestFollowUpSessionName("Prospection Lyon", "2026-07-18")).toBe(
      "Prospection Lyon — Relance 18 juil.",
    );
  });

  it("falls back to a generic base name when empty", () => {
    expect(suggestFollowUpSessionName("", "2026-07-18")).toBe("Séance — Relance 18 juil.");
  });

  it("drops the date suffix when the date is not a valid ISO date", () => {
    expect(suggestFollowUpSessionName("Prospection Lyon", "invalid")).toBe("Prospection Lyon — Relance");
  });
});
