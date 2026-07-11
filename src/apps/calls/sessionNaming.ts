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
