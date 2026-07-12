import type { CockpitHeatmapDay } from "./pilotageApi";

export type HeatmapMonthMarker = {
  col: number;
  /** Weekday row 0=Lu..4=Ve — offsets label within the week column */
  row: number;
  label: string;
};

export type WeekdayHeatmapGrid = {
  columns: number;
  /** rows[weekdayIndex 0=Lu..4=Ve][weekColumn] */
  rows: Array<Array<CockpitHeatmapDay | null>>;
  monthMarkers: HeatmapMonthMarker[];
};

const WEEKDAY_LABELS = ["Lu", "Ma", "Me", "Je", "Ve"] as const;

export { WEEKDAY_LABELS };

function parseUtcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0 = Monday … 4 = Friday */
function isoWeekdayIndex(date: Date): number {
  const dow = date.getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
}

/** GitHub-style grid: 5 weekday rows × week columns (Mon–Fri only). */
export function buildWeekdayHeatmapGrid(days: CockpitHeatmapDay[]): WeekdayHeatmapGrid {
  if (days.length === 0) {
    return { columns: 0, rows: [], monthMarkers: [] };
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const rangeStart = days[0].date;
  const rangeEnd = days[days.length - 1].date;
  const first = parseUtcDate(rangeStart);
  const last = parseUtcDate(rangeEnd);

  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - isoWeekdayIndex(first));

  const numWeeks =
    Math.floor((last.getTime() - gridStart.getTime()) / (7 * 86_400_000)) + 1;

  const rows: Array<Array<CockpitHeatmapDay | null>> = Array.from({ length: 5 }, () =>
    Array.from({ length: numWeeks }, () => null),
  );

  for (let col = 0; col < numWeeks; col++) {
    const weekMonday = new Date(gridStart);
    weekMonday.setUTCDate(weekMonday.getUTCDate() + col * 7);

    for (let row = 0; row < 5; row++) {
      const cellDate = new Date(weekMonday);
      cellDate.setUTCDate(cellDate.getUTCDate() + row);
      const key = formatUtcDate(cellDate);

      if (key < rangeStart || key > rangeEnd) continue;

      rows[row][col] =
        byDate.get(key) ??
        ({
          date: key,
          label: key,
          calls: 0,
          rdv: 0,
        } satisfies CockpitHeatmapDay);
    }
  }

  const monthMarkers: HeatmapMonthMarker[] = [];
  const labeledMonths = new Set<string>();
  for (let col = 0; col < numWeeks; col++) {
    for (let row = 0; row < 5; row++) {
      const cell = rows[row][col];
      if (!cell) continue;
      const monthKey = cell.date.slice(0, 7);
      if (labeledMonths.has(monthKey)) continue;
      monthMarkers.push({ col, row, label: monthLabel(parseUtcDate(cell.date)) });
      labeledMonths.add(monthKey);
    }
  }

  return { columns: numWeeks, rows, monthMarkers };
}
