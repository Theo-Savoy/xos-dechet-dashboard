/** Builds "Séance X #2", then "#3", from a parent session name. */
export function nextContinuationName(name: string): string {
  const trimmed = String(name || "").trim() || "Séance";
  const match = trimmed.match(/^(.*?)(?:\s+#(\d+))$/);
  if (match) {
    const base = match[1]!.trim() || "Séance";
    return `${base} #${Number(match[2]) + 1}`;
  }
  return `${trimmed} #2`;
}

/** Suggestion lisible pour le nom pré-rempli de la séance de relance (#2). */
export function suggestFollowUpSessionName(name: string, dateIso: string): string {
  const base = String(name || "").trim() || "Séance";
  const match = /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
    ? new Date(`${dateIso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "";
  return match ? `${base} — Relance ${match}` : `${base} — Relance`;
}
