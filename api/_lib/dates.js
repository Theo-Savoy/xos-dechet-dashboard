/** Dates Paris partagées (miroir serveur de src/lib/dates.ts) — source unique pour éviter les dérives de fuseau. */

const PARIS_TZ = "Europe/Paris";

export function todayParisIso() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: PARIS_TZ }).format(new Date());
}

export function parisDayKey(date, timeZone = PARIS_TZ) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(date);
}

export function addDaysParisIso(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function tomorrowParisIso() {
  return addDaysParisIso(todayParisIso(), 1);
}

export function formatIsoDateFr(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
