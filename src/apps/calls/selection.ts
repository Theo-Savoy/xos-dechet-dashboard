/** Helpers for contact selection constraints in Call Manager. */

export type SelectableContact = {
  sf_contact_id: string;
  sf_account_id: string | null;
  title?: string | null;
};

/**
 * Higher score = preferred when capping contacts per company.
 * Directeurs / DRH / dirigeants > responsables > adjoints > chargés / chefs de projet.
 */
export function titlePriority(title: string | null | undefined): number {
  if (!title) return 0;
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  if (/\b(pdg|ceo|president|gerant|fondateur|fondatrice|chief executive)\b/.test(normalized)) {
    return 100;
  }
  if (/\b(directeur|directrice|drh|df\b|dg\b|vp\b|vice[- ]president)\b/.test(normalized)) {
    return 90;
  }
  if (/\b(head of|responsable)\b/.test(normalized) && !/\badjoint/.test(normalized)) {
    return 70;
  }
  if (/\b(manager|lead)\b/.test(normalized) && !/\b(project|projet)\b/.test(normalized)) {
    return 65;
  }
  if (/\badjoint/.test(normalized)) {
    return 55;
  }
  if (/\b(charge|chef de projet|coordinateur|coordinatrice|gestionnaire)\b/.test(normalized)) {
    return 30;
  }
  return 20;
}

function compareByTitlePriority(a: SelectableContact, b: SelectableContact): number {
  const delta = titlePriority(b.title) - titlePriority(a.title);
  if (delta !== 0) return delta;
  return a.sf_contact_id.localeCompare(b.sf_contact_id);
}

export function accountKey(contact: SelectableContact): string {
  return contact.sf_account_id || `contact:${contact.sf_contact_id}`;
}

/**
 * Builds a preview list of up to `totalLimit` contacts while respecting
 * `maxPerCompany` per account. Within each company, higher-priority titles are
 * preferred; across companies, contacts are taken round-robin in CRM order.
 */
export function buildPreviewContactList<T extends SelectableContact>(
  contacts: T[],
  totalLimit: number,
  maxPerCompany: number | null,
): T[] {
  if (contacts.length === 0) return [];
  if (maxPerCompany === null || maxPerCompany <= 0) {
    return contacts.slice(0, totalLimit);
  }

  const companyOrder: string[] = [];
  const seenCompanies = new Set<string>();
  for (const contact of contacts) {
    const key = accountKey(contact);
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key);
      companyOrder.push(key);
    }
  }

  const byAccount = new Map<string, T[]>();
  for (const contact of contacts) {
    const key = accountKey(contact);
    const group = byAccount.get(key);
    if (group) group.push(contact);
    else byAccount.set(key, [contact]);
  }

  const rankedByAccount = new Map<string, T[]>();
  for (const [key, group] of byAccount) {
    rankedByAccount.set(key, [...group].sort(compareByTitlePriority));
  }

  const result: T[] = [];
  for (let round = 0; round < maxPerCompany && result.length < totalLimit; round += 1) {
    for (const key of companyOrder) {
      if (result.length >= totalLimit) break;
      const ranked = rankedByAccount.get(key);
      if (!ranked || round >= ranked.length) continue;
      result.push(ranked[round]!);
    }
  }
  return result;
}

/**
 * Builds a selection set capped at `maxPerCompany` contacts sharing the same
 * account id. Within each company, higher-priority titles (directeur /
 * responsable…) are preferred. Contacts without an account id are each their
 * own group.
 */
export function selectIdsWithCompanyCap(
  contacts: SelectableContact[],
  maxPerCompany: number | null,
  eligibleIds?: Set<string>,
): Set<string> {
  const selected = new Set<string>();
  const eligible = contacts.filter(
    (contact) => !eligibleIds || eligibleIds.has(contact.sf_contact_id),
  );

  if (maxPerCompany === null || maxPerCompany <= 0) {
    for (const contact of eligible) selected.add(contact.sf_contact_id);
    return selected;
  }

  const byAccount = new Map<string, SelectableContact[]>();
  for (const contact of eligible) {
    const key = contact.sf_account_id || `contact:${contact.sf_contact_id}`;
    const group = byAccount.get(key);
    if (group) group.push(contact);
    else byAccount.set(key, [contact]);
  }

  for (const group of byAccount.values()) {
    const ranked = [...group].sort(compareByTitlePriority);
    for (const contact of ranked.slice(0, maxPerCompany)) {
      selected.add(contact.sf_contact_id);
    }
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
