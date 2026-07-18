import { addDaysParisIso, todayParisIso as sharedTodayParisIso } from "../../lib/dates";

export function formatIsoDateFr(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Date courte FR pour listes (historique, etc.). */
export function formatActivityDateFr(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(value);
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Date métier Call Manager (alignée API / SF) — Europe/Paris. */
export const todayParisIso = sharedTodayParisIso;

/** Lendemain (Europe/Paris), ex. suggestion de date pour une séance de relance. */
export function tomorrowParisIso(): string {
  return addDaysParisIso(todayParisIso(), 1);
}
