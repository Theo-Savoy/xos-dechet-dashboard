import type { SessionContact } from "./types";

/** Which session row should drive CRM context (tasks, opps, SF URLs). */
export function resolveContextContactId(
  contacts: SessionContact[],
  awaitingEventId: number | null | undefined,
  focusedContactId: number | null,
): number | null {
  if (awaitingEventId) return awaitingEventId;
  if (focusedContactId != null) {
    const focused = contacts.find((contact) => contact.id === focusedContactId);
    if (focused) return focusedContactId;
  }
  return contacts.find((contact) => contact.status === "pending")?.id ?? null;
}

/**
 * Prochains pending dans l’ordre de la file (après le contact courant),
 * aligné sur le « Ensuite : » du runner — pour prefetch contexte CRM.
 */
export function pendingContactsAhead(
  contacts: SessionContact[],
  currentId: number | null,
  limit: number,
): SessionContact[] {
  if (limit <= 0) return [];
  const startIndex = currentId == null
    ? -1
    : contacts.findIndex((contact) => contact.id === currentId);
  const slice = startIndex >= 0 ? contacts.slice(startIndex + 1) : contacts;
  return slice.filter((contact) => contact.status === "pending").slice(0, limit);
}
