import { describe, expect, it } from "vitest";
import { quarterlyToMonthlyIndicative } from "./_weekly/targets.js";

const seasonality = {
  month_in_quarter: {
    Q1: { "07": 0.2, "08": 0.3, "09": 0.5 },
  },
};

describe("weekly targets helpers", () => {
  it("splits quarterly target into monthly indicative weights (sum = target)", () => {
    const months = quarterlyToMonthlyIndicative(60000, "FY27-Q1", seasonality);
    expect(months).toHaveLength(3);
    expect(months[0]).toMatchObject({ month: "07", raw: 12000, indicative: 12000 });
    expect(months[1]).toMatchObject({ month: "08", raw: 18000, indicative: 18000 });
    expect(months[2]).toMatchObject({ month: "09", raw: 30000, indicative: 30000 });
    expect(months.reduce((sum, m) => sum + m.indicative, 0)).toBe(60000);
  });

  it("rounds to nearest thousand and keeps sum equal to target (80k case)", () => {
    const months = quarterlyToMonthlyIndicative(80000, "FY27-Q1", seasonality);
    expect(months).toHaveLength(3);
    // 80k × 0.2/0.3/0.5 = 16k/24k/40k — exact, no residual
    expect(months.map((m) => m.indicative)).toEqual([16000, 24000, 40000]);
    expect(months.reduce((sum, m) => sum + m.indicative, 0)).toBe(80000);
  });

  it("distributes residual via largest remainder (equal thirds)", () => {
    const equalSeasonality = {
      month_in_quarter: { Q1: { "07": 1 / 3, "08": 1 / 3, "09": 1 / 3 } },
    };
    const months = quarterlyToMonthlyIndicative(80000, "FY27-Q1", equalSeasonality);
    // raw = 26666.67 each → floors 26000 each = 78000, residual 2000
    // → two months get +1000 → 27000/27000/26000
    expect(months.reduce((sum, m) => sum + m.indicative, 0)).toBe(80000);
    expect(months.every((m) => m.indicative % 1000 === 0)).toBe(true);
  });

  it("returns empty when no target", () => {
    expect(quarterlyToMonthlyIndicative(0, "FY27-Q1", seasonality)).toEqual([]);
  });
});
