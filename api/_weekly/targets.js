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

const INDICATIVE_STEP = 1000;

/**
 * Répartit un objectif trimestriel en objectifs mensuels indicatifs
 * selon les poids saisonniers historiques (month_in_quarter).
 * Arrondi au millier le plus proche + méthode du plus grand reste pour
 * que la somme des indicatifs colle à l'objectif (arrondi au millier).
 */
export function quarterlyToMonthlyIndicative(quarterlyTarget, quarterLabel, seasonality) {
  if (!Number.isFinite(quarterlyTarget) || quarterlyTarget <= 0) return [];
  const match = /Q([1-4])$/.exec(quarterLabel || "");
  if (!match) return [];
  const qKey = `Q${match[1]}`;
  const months = FISCAL_QUARTER_MONTHS[qKey];
  const weights = seasonality?.month_in_quarter?.[qKey];
  if (!months?.length) return [];

  const step = INDICATIVE_STEP;
  const raws = months.map((month) => quarterlyTarget * (weights?.[month] ?? 1 / months.length));
  const target = Math.round(quarterlyTarget / step) * step;
  const floors = raws.map((raw) => Math.floor(raw / step) * step);
  let residual = target - floors.reduce((sum, value) => sum + value, 0);
  const order = raws
    .map((raw, index) => ({ remainder: raw - floors[index], index }))
    .sort((a, b) => b.remainder - a.remainder);
  const indicatives = [...floors];
  let cursor = 0;
  while (residual !== 0 && order.length) {
    const delta = residual > 0 ? step : -step;
    indicatives[order[cursor % order.length].index] += delta;
    residual -= delta;
    cursor += 1;
  }

  return months.map((month, index) => ({
    month,
    label: MONTH_LABELS[month] || month,
    weight: weights?.[month] ?? 1 / months.length,
    raw: raws[index],
    indicative: indicatives[index],
  }));
}
