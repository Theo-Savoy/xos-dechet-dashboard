import { describe, expect, it } from "vitest";
import {
  SF_MAX_OPPORTUNITY_SEMI_JOINS,
  countOpportunitySemiJoins,
  getOpportunityFilterGuidance,
} from "./opportunityFilters";

describe("opportunityFilters", () => {
  it("never exceeds the Salesforce semi-join budget for any tri-state combo", () => {
    for (const opp_ouverte of [null, true, false] as const) {
      for (const opp_perdue of [null, true, false] as const) {
        expect(countOpportunitySemiJoins({ opp_ouverte, opp_perdue })).toBeLessThanOrEqual(
          SF_MAX_OPPORTUNITY_SEMI_JOINS,
        );
      }
    }
  });

  it("counts the open+lost combination as 2 semi-joins", () => {
    expect(countOpportunitySemiJoins({ opp_ouverte: true, opp_perdue: true })).toBe(2);
  });

  it("explains the open+lost workaround in the UI guidance", () => {
    const guidance = getOpportunityFilterGuidance({ opp_ouverte: true, opp_perdue: true });
    expect(guidance.hint).toContain("ouverte");
    expect(guidance.note).toContain("Limite Salesforce");
    expect(guidance.disabled.opp_perdue).toContain(false);
  });
});
