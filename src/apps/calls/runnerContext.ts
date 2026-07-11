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
