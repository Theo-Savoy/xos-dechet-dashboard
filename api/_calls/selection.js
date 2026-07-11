/** Contact selection helpers for Call Manager list building (mirrors src/apps/calls/selection.ts). */

export function titlePriority(title) {
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

function compareByTitlePriority(a, b) {
  const delta = titlePriority(b.title) - titlePriority(a.title);
  if (delta !== 0) return delta;
  return a.sf_contact_id.localeCompare(b.sf_contact_id);
}

export function accountKey(contact) {
  return contact.sf_account_id || `contact:${contact.sf_contact_id}`;
}

/** @param {Array<{ sf_contact_id: string; sf_account_id: string | null; title?: string | null }>} contacts */
export function buildPreviewContactList(contacts, totalLimit, maxPerCompany) {
  if (!contacts.length) return [];
  if (maxPerCompany === null || maxPerCompany <= 0) {
    return contacts.slice(0, totalLimit);
  }

  const companyOrder = [];
  const seenCompanies = new Set();
  for (const contact of contacts) {
    const key = accountKey(contact);
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key);
      companyOrder.push(key);
    }
  }

  const byAccount = new Map();
  for (const contact of contacts) {
    const key = accountKey(contact);
    const group = byAccount.get(key);
    if (group) group.push(contact);
    else byAccount.set(key, [contact]);
  }

  const rankedByAccount = new Map();
  for (const [key, group] of byAccount) {
    rankedByAccount.set(key, [...group].sort(compareByTitlePriority));
  }

  const result = [];
  for (let round = 0; round < maxPerCompany && result.length < totalLimit; round += 1) {
    for (const key of companyOrder) {
      if (result.length >= totalLimit) break;
      const ranked = rankedByAccount.get(key);
      if (!ranked || round >= ranked.length) continue;
      result.push(ranked[round]);
    }
  }
  return result;
}
