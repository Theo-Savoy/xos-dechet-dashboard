export type MonthlyIndicative = {
  month: string;
  label: string;
  weight: number;
  raw: number;
  indicative: number;
};

export type Quarter = {
  sf_user_id: string;
  quarter: string;
  signed_to_date: number;
  weighted_open: number;
  forecast: number;
  custom_pipe: number;
  target: number | null;
  signed_n1?: number;
  pace_ratio?: number | null;
  expected_to_date?: number | null;
  monthly_indicative?: MonthlyIndicative[];
};

export type Pace = {
  week_of_quarter: number;
  weeks_in_quarter: number;
  signed_to_date: number;
  forecast: number;
  target: number | null;
  signed_n1: number;
  expected_to_date: number | null;
  run_rate: number;
  pace_ratio: number | null;
  won_count?: number;
  expected_mode?: "seasonal" | "linear";
  monthly_indicative?: MonthlyIndicative[];
};

function roundToMagnitude(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const normalized = value / base;
  let factor = 10;
  if (normalized < 1.5) factor = 1;
  else if (normalized < 3.5) factor = 2.5;
  else if (normalized < 7.5) factor = 5;
  return Math.round(factor * base);
}

export function aggregateMonthlyIndicative(rows: Quarter[]): MonthlyIndicative[] {
  const byMonth = new Map<string, { month: string; label: string; weight: number; raw: number }>();
  for (const row of rows) {
    for (const month of row.monthly_indicative || []) {
      const prev = byMonth.get(month.month);
      if (prev) prev.raw += month.raw;
      else byMonth.set(month.month, { month: month.month, label: month.label, weight: month.weight, raw: month.raw });
    }
  }
  return [...byMonth.values()].map((month) => ({
    ...month,
    indicative: roundToMagnitude(month.raw),
  }));
}

export function scopePace(rows: Quarter[], meta: Pace | null | undefined, fullScope: boolean): Pace | null {
  if (!rows.length) return null;
  const targets = rows.map((row) => row.target).filter((value): value is number => value !== null);
  const signed = rows.reduce((sum, row) => sum + row.signed_to_date, 0);
  const forecast = rows.reduce((sum, row) => sum + row.forecast, 0);
  const signedN1 = rows.reduce((sum, row) => sum + (row.signed_n1 || 0), 0);
  const target = targets.length ? targets.reduce((sum, value) => sum + value, 0) : null;
  const weekOfQuarter = meta?.week_of_quarter || 1;
  const weeksInQuarter = meta?.weeks_in_quarter || weekOfQuarter;
  const expectedFromRows = rows.every((row) => row.expected_to_date != null)
    ? rows.reduce((sum, row) => sum + (row.expected_to_date || 0), 0)
    : null;
  const expectedToDate = expectedFromRows ?? meta?.expected_to_date ?? (target === null ? null : target * (weekOfQuarter / Math.max(weekOfQuarter, weeksInQuarter)));
  return {
    week_of_quarter: weekOfQuarter,
    weeks_in_quarter: Math.max(weekOfQuarter, weeksInQuarter),
    signed_to_date: signed,
    forecast,
    target,
    signed_n1: signedN1,
    expected_to_date: expectedToDate,
    run_rate: signed * (Math.max(weekOfQuarter, weeksInQuarter) / weekOfQuarter),
    pace_ratio: expectedToDate && expectedToDate > 0 ? signed / expectedToDate : null,
    won_count: fullScope ? (meta?.won_count || 0) : undefined,
    expected_mode: meta?.expected_mode || (expectedFromRows !== null ? "seasonal" : "linear"),
    monthly_indicative: aggregateMonthlyIndicative(rows),
  };
}
