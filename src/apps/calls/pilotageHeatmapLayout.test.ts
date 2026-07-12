import { describe, expect, it } from "vitest";
import { buildWeekdayHeatmapGrid } from "./pilotageHeatmapLayout";
import type { CockpitHeatmapDay } from "./pilotageApi";

function day(date: string, calls = 0, rdv = 0): CockpitHeatmapDay {
  return { date, label: date, calls, rdv };
}

describe("buildWeekdayHeatmapGrid", () => {
  it("builds 5 weekday rows without weekend columns", () => {
    const days = [
      day("2026-07-06"), // Mon
      day("2026-07-07"),
      day("2026-07-08"),
      day("2026-07-09"),
      day("2026-07-10"), // Fri
      day("2026-07-13"), // Mon next week
    ];
    const grid = buildWeekdayHeatmapGrid(days);

    expect(grid.rows).toHaveLength(5);
    expect(grid.columns).toBe(2);
    expect(grid.rows[0][0]?.date).toBe("2026-07-06");
    expect(grid.rows[4][0]?.date).toBe("2026-07-10");
    expect(grid.rows[0][1]?.date).toBe("2026-07-13");
    expect(grid.rows[4][1]).toBeNull();
  });

  it("emits month markers when weeks span months", () => {
    const days = [day("2026-06-30"), day("2026-07-01"), day("2026-07-02")];
    const grid = buildWeekdayHeatmapGrid(days);

    expect(grid.monthMarkers.length).toBeGreaterThanOrEqual(2);
    expect(grid.monthMarkers.some((m) => m.label.includes("juin"))).toBe(true);
    expect(grid.monthMarkers.some((m) => m.label.includes("juil"))).toBe(true);
  });
});
