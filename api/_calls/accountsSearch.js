/** ABM — action `accounts_search` : SOSL sur Account puis raffinage SOQL + contacts. */
import mapping from "../_crm/mapping.js";
import { escapeSOSL } from "../launcher.js";
import {
  escapeSOQL,
  escapedList,
  fetchOpportunityAccountIdSets,
  fetchSFToken,
  hasOpportunityQueryFilters,
  parisToday,
  searchContacts,
  searchSOSL,
} from "../_crm/salesforce.js";
import { findActiveSessionConflicts } from "./activeSessionConflicts.js";
import { getProfile } from "./profileCache.js";

const MAX_ACCOUNTS = 25;
const MAX_CONTACTS_PER_QUERY = 200;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [];
}

function hasAnyRefineFilter(filters) {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "",
  );
}

export function parseAccountsSearchBody(body) {
  if (!isObject(body)) return { error: "invalid_body" };
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (body.filters !== undefined && !isObject(body.filters)) return { error: "invalid_filters" };
  const filters = body.filters || {};
  if (q.length < 2 && !hasAnyRefineFilter(filters)) return { error: "invalid_query" };
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1)) {
    return { error: "invalid_limit" };
  }
  return {
    q,
    filters,
    limit: Math.min(body.limit ?? MAX_ACCOUNTS, MAX_ACCOUNTS),
  };
}

/** Conditions Account.<field> à partir d'un sous-arbre FilterTree["entreprise"]. */
function accountRefineConditions(filters, account) {
  const conditions = [];
  const sectors = stringList(filters.secteurs);
  if (sectors.length) conditions.push(`${account.fields.industry} IN (${escapedList(sectors)})`);
  const employeeBands = stringList(filters.effectifs);
  if (employeeBands.length) conditions.push(`${account.fields.employeeCount} IN (${escapedList(employeeBands)})`);
  const customerTypes = stringList(filters.type_client);
  if (customerTypes.length) conditions.push(`${account.fields.customerType} IN (${escapedList(customerTypes)})`);
  const tiers = stringList(filters.tiers);
  if (tiers.length) conditions.push(`${account.fields.tier} IN (${escapedList(tiers)})`);
  const owners = stringList(filters.proprietaires);
  if (owners.length) conditions.push(`${account.fields.ownerId} IN (${escapedList(owners)})`);
  if (typeof filters.compte_principal === "string" && filters.compte_principal) {
    conditions.push(`${account.fields.parentId} = '${escapeSOQL(filters.compte_principal)}'`);
  }
  return conditions;
}

function filterByOpenLost(ids, sets, filters) {
  return ids.filter((id) => {
    const hasOpen = sets.open.has(id);
    const hasLost = sets.lost.has(id);
    if (filters.opp_ouverte === true && !hasOpen) return false;
    if (filters.opp_ouverte === false && hasOpen) return false;
    if (filters.opp_perdue === true && !hasLost) return false;
    if (filters.opp_perdue === false && hasLost) return false;
    return true;
  });
}

/** Returns { accounts, truncated } or { error, status }. */
export async function searchAccounts(client, userId, body) {
  const parsed = parseAccountsSearchBody(body);
  if (parsed.error) return { error: parsed.error, status: 400 };

  const profile = await getProfile(client, userId);
  if (profile.error) return { error: profile.error, status: 500 };

  const tokenResult = await fetchSFToken({ client, userId });
  if (tokenResult.error) return { error: tokenResult.error, status: 502 };
  const token = tokenResult.accessToken;

  const account = mapping.objects.account;
  const af = account.fields;
  const selectFields = `${af.id}, ${af.name}, ${af.industry}, Owner.Name, ${af.customerType}, ${af.tier}, ${af.employeeCount}`;

  let accountRecords;
  let alreadyRefined = false;
  if (parsed.q.length === 0) {
    // Recherche filtres seuls : pas de FIND SOSL (plante sur une chaîne vide), on va direct en SOQL.
    const conditions = accountRefineConditions(parsed.filters, account);
    const soql = `SELECT ${selectFields} FROM ${account.name} WHERE ${conditions.join(" AND ")} LIMIT ${parsed.limit}`;
    const soqlResult = await searchContacts(token, soql);
    if (soqlResult.error) return { error: soqlResult.error, status: 502 };
    accountRecords = soqlResult.records || [];
    alreadyRefined = true;
  } else {
    const sosl = `FIND {${escapeSOSL(parsed.q)}} IN NAME FIELDS RETURNING ${account.name}(${selectFields} LIMIT ${parsed.limit})`;
    const soslResult = await searchSOSL(token, sosl);
    if (soslResult.error) return { error: soslResult.error, status: 502 };
    accountRecords = soslResult.records || [];
  }
  if (!accountRecords.length) return { accounts: [], truncated: false };
  const soslCapped = accountRecords.length >= parsed.limit;

  if (!alreadyRefined && hasAnyRefineFilter(parsed.filters)) {
    const accountIds = accountRecords.map((record) => record[af.id]);
    const conditions = [`${af.id} IN (${escapedList(accountIds)})`, ...accountRefineConditions(parsed.filters, account)];
    const refineSoql = `SELECT ${af.id} FROM ${account.name} WHERE ${conditions.join(" AND ")}`;
    const refineResult = await searchContacts(token, refineSoql);
    if (refineResult.error) return { error: refineResult.error, status: 502 };
    const allowed = new Set(refineResult.records.map((record) => record[af.id]));
    accountRecords = accountRecords.filter((record) => allowed.has(record[af.id]));
  }

  if (hasOpportunityQueryFilters({ entreprise: parsed.filters })) {
    const oppSets = await fetchOpportunityAccountIdSets(token, mapping, { entreprise: parsed.filters });
    if (oppSets.error) return { error: oppSets.error, status: 502 };
    const allowedIds = filterByOpenLost(accountRecords.map((record) => record[af.id]), oppSets, parsed.filters);
    const allowed = new Set(allowedIds);
    accountRecords = accountRecords.filter((record) => allowed.has(record[af.id]));
  }
  if (!accountRecords.length) return { accounts: [], truncated: false };

  const contact = mapping.objects.contact;
  const cf = contact.fields;
  const accountIds = accountRecords.map((record) => record[af.id]);
  const contactsSoql = [
    `SELECT ${[cf.id, cf.name, cf.title, cf.phone, cf.mobilePhone, cf.email, cf.decisionLevel, cf.accountId].join(", ")}`,
    `FROM ${contact.name}`,
    `WHERE ${cf.accountId} IN (${escapedList(accountIds)}) AND ${cf.doNotCall} = false AND ${cf.inactive} = false`,
    `ORDER BY ${cf.decisionLevel} DESC`,
    `LIMIT ${MAX_CONTACTS_PER_QUERY}`,
  ].join(" ");
  const contactsResult = await searchContacts(token, contactsSoql);
  if (contactsResult.error) return { error: contactsResult.error, status: 502 };

  const contactsByAccount = new Map();
  for (const record of contactsResult.records) {
    const accId = record[cf.accountId];
    if (!accId) continue;
    if (!contactsByAccount.has(accId)) contactsByAccount.set(accId, []);
    contactsByAccount.get(accId).push({
      sf_contact_id: record[cf.id],
      contact_name: record[cf.name] || "",
      title: record[cf.title] ?? null,
      phone: record[cf.phone] ?? null,
      mobile_phone: record[cf.mobilePhone] ?? null,
      email: record[cf.email] ?? null,
      decision_level: record[cf.decisionLevel] ?? null,
    });
  }

  const accounts = accountRecords.map((record) => ({
    id: record[af.id],
    name: record[af.name] || "",
    industry: record[af.industry] ?? null,
    owner_name: record.Owner?.Name ?? null,
    type_client: record[af.customerType] ?? null,
    tier: record[af.tier] ?? null,
    effectif: record[af.employeeCount] ?? null,
    contacts: contactsByAccount.get(record[af.id]) || [],
  }));

  // Exclusion stricte : les contacts déjà dans une séance active sont défiltrés
  // du résultat, sans opt-in. Un compte qui perd tous ses contacts est gardé
  // avec contacts: [] plutôt que supprimé.
  const allContactIds = accounts.flatMap((acc) => acc.contacts.map((c) => c.sf_contact_id));
  const conflicts = await findActiveSessionConflicts(client, allContactIds, parisToday());
  const excludedIds = new Set(conflicts.map((entry) => entry.sf_contact_id));
  const finalAccounts = excludedIds.size
    ? accounts.map((acc) => ({
      ...acc,
      contacts: acc.contacts.filter((c) => !excludedIds.has(c.sf_contact_id)),
    }))
    : accounts;

  return {
    accounts: finalAccounts,
    excluded_count: conflicts.length,
    truncated: soslCapped || contactsResult.records.length >= MAX_CONTACTS_PER_QUERY,
  };
}
