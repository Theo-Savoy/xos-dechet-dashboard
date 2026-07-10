/** Helpers for contact selection constraints in Call Manager. */

export type SelectableContact = {
  sf_contact_id: string;
  sf_account_id: string | null;
};

/**
 * Builds a selection set capped at `maxPerCompany` contacts sharing the same
 * account id. Contacts without an account id are each treated as their own group.
 * Order of `contacts` is preserved (first seen wins).
 */
export function selectIdsWithCompanyCap(
  contacts: SelectableContact[],
  maxPerCompany: number | null,
  eligibleIds?: Set<string>,
): Set<string> {
  const selected = new Set<string>();
  if (maxPerCompany === null || maxPerCompany <= 0) {
    for (const contact of contacts) {
      if (!eligibleIds || eligibleIds.has(contact.sf_contact_id)) {
        selected.add(contact.sf_contact_id);
      }
    }
    return selected;
  }

  const counts = new Map<string, number>();
  for (const contact of contacts) {
    if (eligibleIds && !eligibleIds.has(contact.sf_contact_id)) continue;
    const key = contact.sf_account_id || `contact:${contact.sf_contact_id}`;
    const current = counts.get(key) ?? 0;
    if (current >= maxPerCompany) continue;
    counts.set(key, current + 1);
    selected.add(contact.sf_contact_id);
  }
  return selected;
}

/** Returns true if adding `contactId` would stay within the per-company cap. */
export function canSelectContact(
  contacts: SelectableContact[],
  selectedIds: Set<string>,
  contactId: string,
  maxPerCompany: number | null,
): boolean {
  if (maxPerCompany === null || maxPerCompany <= 0) return true;
  if (selectedIds.has(contactId)) return true;
  const target = contacts.find((contact) => contact.sf_contact_id === contactId);
  if (!target) return false;
  const key = target.sf_account_id || `contact:${target.sf_contact_id}`;
  let count = 0;
  for (const contact of contacts) {
    if (!selectedIds.has(contact.sf_contact_id)) continue;
    const otherKey = contact.sf_account_id || `contact:${contact.sf_contact_id}`;
    if (otherKey === key) count += 1;
  }
  return count < maxPerCompany;
}
