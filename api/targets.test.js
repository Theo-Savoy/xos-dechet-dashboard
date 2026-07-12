import { describe, expect, it } from "vitest";
import { quarterlyToMonthlyIndicative, roundToMagnitude } from "./_weekly/targets.js";

const seasonality = {
  month_in_quarter: {
    Q1: { "07": 0.2, "08": 0.3, "09": 0.5 },
  },
};

describe("weekly targets helpers", () => {
  it("rounds to order of magnitude", () => {
    expect(roundToMagnitude(12300)).toBe(10000);
    expect(roundToMagnitude(28000)).toBe(25000);
    expect(roundToMagnitude(48000)).toBe(50000);
    expect(roundToMagnitude(0)).toBe(0);
  });

  it("splits quarterly target into monthly indicative weights", () => {
    const months = quarterlyToMonthlyIndicative(60000, "FY27-Q1", seasonality);
    expect(months).toHaveLength(3);
    expect(months[0]).toMatchObject({ month: "07", raw: 12000, indicative: 10000 });
    expect(months[1]).toMatchObject({ month: "08", raw: 18000, indicative: 25000 });
    expect(months[2]).toMatchObject({ month: "09", raw: 30000, indicative: 25000 });
  });

  it("returns empty when no target", () => {
    expect(quarterlyToMonthlyIndicative(0, "FY27-Q1", seasonality)).toEqual([]);
  });
});
