/** FY XOS juillet→juin — aligné sur api/perf.js */
export const FISCAL_QUARTER_MONTHS = {
  Q1: ["07", "08", "09"],
  Q2: ["10", "11", "12"],
  Q3: ["01", "02", "03"],
  Q4: ["04", "05", "06"],
};

const MONTH_LABELS = {
  "01": "Janv.",
  "02": "Fév.",
  "03": "Mars",
  "04": "Avr.",
  "05": "Mai",
  "06": "Juin",
  "07": "Juil.",
  "08": "Août",
  "09": "Sept.",
  "10": "Oct.",
  "11": "Nov.",
  "12": "Déc.",
};

/** Arrondi « ordre de grandeur » : 1, 2,5 ou 5 × 10^n */
export function roundToMagnitude(value) {
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

/**
 * Répartit un objectif trimestriel en objectifs mensuels indicatifs
 * selon les poids saisonniers historiques (month_in_quarter).
 */
export function quarterlyToMonthlyIndicative(quarterlyTarget, quarterLabel, seasonality) {
  if (!Number.isFinite(quarterlyTarget) || quarterlyTarget <= 0) return [];
  const match = /Q([1-4])$/.exec(quarterLabel || "");
  if (!match) return [];
  const qKey = `Q${match[1]}`;
  const months = FISCAL_QUARTER_MONTHS[qKey];
  const weights = seasonality?.month_in_quarter?.[qKey];
  if (!months?.length) return [];

  return months.map((month) => {
    const weight = weights?.[month] ?? 1 / months.length;
    const raw = quarterlyTarget * weight;
    return {
      month,
      label: MONTH_LABELS[month] || month,
      weight,
      raw,
      indicative: roundToMagnitude(raw),
    };
  });
}
