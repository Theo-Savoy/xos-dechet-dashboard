/** Salesforce CRM adapter. All organization-specific API names come from mapping. */
import defaultMapping from "./mapping.js";
import { decryptRefreshToken } from "./tokenEncryption.js";

export const SOQL_FETCH_CAP = 2000;
const SF_TOKEN_TTL_MS = 30 * 60_000;
let sfTokenCache = { accessToken: null, fetchedAt: 0 };
const sfUserTokenCache = new Map();
const sfUserTokenContexts = new Map();

function invalidateSFTokenCache() {
  sfTokenCache = { accessToken: null, fetchedAt: 0 };
}

/** Test-only hook to isolate module-scope token cache state. */
export function __resetSFTokenCache() {
  invalidateSFTokenCache();
  sfUserTokenCache.clear();
  sfUserTokenContexts.clear();
}

export function escapeSOQL(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapedList(values) {
  return values.map((value) => `'${escapeSOQL(value)}'`).join(", ");
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [];
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function boundedLimit(value) {
  if (!Number.isInteger(value)) return 200;
  return Math.max(1, Math.min(value, SOQL_FETCH_CAP));
}

/** Filtres appliqués en post-traitement JS ⇒ fetch au cap puis troncature. */
export function hasRelanceQueryFilters(filters = {}) {
  const followUp = filters.relance || {};
  const excluded = followUp.exclure_si_plus_de || {};
  return (
    followUp.jamais_appele === true
    || positiveInteger(followUp.dernier_appel_avant_jours) !== null
    || positiveInteger(followUp.dernier_appel_dans_jours) !== null
    || stringList(followUp.dernier_resultat).length > 0
    || (positiveInteger(excluded.appels) !== null && positiveInteger(excluded.sur_jours) !== null)
  );
}

/** Opportunity account predicates are applied in JS (see filterByOpportunityAccounts). */
export function hasOpportunityQueryFilters(filters = {}) {
  const enterprise = filters.entreprise || {};
  return (
    enterprise.opp_ouverte === true
    || enterprise.opp_ouverte === false
    || enterprise.opp_perdue === true
    || enterprise.opp_perdue === false
  );
}

function needsWideContactFetch(filters = {}) {
  return hasRelanceQueryFilters(filters) || hasOpportunityQueryFilters(filters);
}

function taskSubquery(mapping) {
  const task = mapping.objects.task;
  const fields = task.fields;
  return `(SELECT ${[fields.id, fields.activityDate, fields.result, fields.duration].join(", ")} FROM ${task.childRelationship} WHERE ${fields.subtype} = '${escapeSOQL(task.subtypeValue)}' ORDER BY ${fields.activityDate} DESC)`;
}

function fonctionPresetClause(preset, titleField) {
  const parts = [];
  for (const like of preset.likes || []) {
    parts.push(`${titleField} LIKE '${escapeSOQL(like)}'`);
  }
  const exacts = (preset.exacts || []).filter((value) => typeof value === "string" && value);
  if (exacts.length) {
    parts.push(`${titleField} IN (${escapedList(exacts)})`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

function buildFonctionConditions(fonctionIds, mapping) {
  const presets = mapping.objects.contact.fonctionPresets || [];
  const titleField = mapping.objects.contact.fields.title;
  const clauses = fonctionIds
    .map((id) => presets.find((preset) => preset.id === id))
    .filter(Boolean)
    .map((preset) => fonctionPresetClause(preset, titleField))
    .filter(Boolean);
  return clauses.length ? [`(${clauses.join(" OR ")})`] : [];
}

/**
 * Builds the Contact SOQL query. Relance and opportunity predicates that SOQL
 * cannot express reliably are completed in filterTargetContacts / filterByOpportunityAccounts.
 */
export function buildTargetQuery(filters = {}, mapping = defaultMapping, sfUserId, options = {}) {
  const account = mapping.objects.account;
  const contact = mapping.objects.contact;
  const enterprise = filters.entreprise || {};
  const contactFilters = filters.contact || {};
  const includeTasks = options.includeTasks !== false;
  const conditions = [];

  const sectors = stringList(enterprise.secteurs);
  if (sectors.length) conditions.push(`Account.${account.fields.industry} IN (${escapedList(sectors)})`);
  const employeeBands = stringList(enterprise.effectifs);
  if (employeeBands.length) conditions.push(`Account.${account.fields.employeeCount} IN (${escapedList(employeeBands)})`);
  const customerTypes = stringList(enterprise.type_client);
  if (customerTypes.length) conditions.push(`Account.${account.fields.customerType} IN (${escapedList(customerTypes)})`);
  const tiers = stringList(enterprise.tiers);
  if (tiers.length) conditions.push(`Account.${account.fields.tier} IN (${escapedList(tiers)})`);
  if (typeof enterprise.compte_principal === "string" && enterprise.compte_principal) {
    conditions.push(`Account.${account.fields.parentId} = '${escapeSOQL(enterprise.compte_principal)}'`);
  }

  if (contactFilters.a_telephone === true) conditions.push(`${contact.fields.mobilePhone} != null`);
  if (contactFilters.exclure_npa !== false) conditions.push(`${contact.fields.doNotCall} = false`);
  // Contacts inactifs = inutilisables pour le Call Manager
  if (contact.fields.inactive) conditions.push(`${contact.fields.inactive} = false`);
  const decisionLevels = stringList(contactFilters.niveau_decision);
  if (decisionLevels.length) conditions.push(`${contact.fields.decisionLevel} IN (${escapedList(decisionLevels)})`);
  conditions.push(...buildFonctionConditions(stringList(contactFilters.fonctions), mapping));
  if (filters.ownerOnly === true && typeof sfUserId === "string" && sfUserId) {
    conditions.push(`Account.${account.fields.ownerId} = '${escapeSOQL(sfUserId)}'`);
  }

  const select = [
    contact.fields.id,
    contact.fields.name,
    contact.fields.phone,
    contact.fields.title,
    contact.fields.linkedin,
    contact.fields.email,
    contact.fields.mobilePhone,
    `${contact.fields.accountId}`,
    `Account.${account.fields.id}`,
    `Account.${account.fields.name}`,
    ...(includeTasks ? [taskSubquery(mapping)] : []),
  ].join(", ");
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = needsWideContactFetch(filters) ? SOQL_FETCH_CAP : boundedLimit(filters.limit);
  return `SELECT ${select} FROM ${contact.name}${where} LIMIT ${limit}`;
}

function dateAgeDays(dateValue, now) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : (now.getTime() - date.getTime()) / 86_400_000;
}

function callTasks(record, mapping) {
  const tasks = record?.[mapping.objects.task.childRelationship];
  if (!tasks) return [];
  return Array.isArray(tasks.records) ? tasks.records : [];
}

function hasAnyCall(record, mapping) {
  const tasks = record?.[mapping.objects.task.childRelationship];
  if (!tasks) return false;
  if (typeof tasks.totalSize === "number" && tasks.totalSize > 0) return true;
  return callTasks(record, mapping).length > 0;
}

function callInLastNDays(call, days, now, fields) {
  const age = dateAgeDays(call[fields.activityDate], now);
  return age !== null && age >= 0 && age <= days;
}

function accountIdFromContactRecord(record, mapping) {
  const contact = mapping.objects.contact.fields;
  const account = mapping.objects.account.fields;
  return record?.Account?.[account.id] ?? record?.[contact.accountId] ?? null;
}

function accountIdsFromOpportunityRecords(records, accountField) {
  const ids = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const accountId = record?.[accountField];
    if (typeof accountId === "string" && accountId) ids.add(accountId);
  }
  return ids;
}

const OPP_ACCOUNT_CACHE_TTL_MS = 60_000;
const oppAccountIdCache = {
  open: { ids: null, fetchedAt: 0 },
  lost: { ids: null, fetchedAt: 0 },
};

/** Test-only hook to isolate module-scope opportunity account cache. */
export function __resetOpportunityAccountCache() {
  oppAccountIdCache.open = { ids: null, fetchedAt: 0 };
  oppAccountIdCache.lost = { ids: null, fetchedAt: 0 };
}

/** Which Opportunity account-id sets are required for the active tri-state filters. */
export function opportunityAccountSetNeeds(filters = {}) {
  const enterprise = filters.entreprise || {};
  const needOpen =
    enterprise.opp_ouverte === true
    || enterprise.opp_ouverte === false
    || (enterprise.opp_perdue === true && enterprise.opp_ouverte !== true);
  const needLost = enterprise.opp_perdue === true || enterprise.opp_perdue === false;
  return { needOpen, needLost };
}

async function fetchOpportunityAccountIds(token, mapping, kind) {
  const opportunity = mapping.objects.opportunity;
  const cache = kind === "lost" ? oppAccountIdCache.lost : oppAccountIdCache.open;
  if (cache.ids && Date.now() - cache.fetchedAt < OPP_ACCOUNT_CACHE_TTL_MS) {
    return { ids: cache.ids };
  }

  const soql = kind === "lost"
    ? `SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.stageName} = '${escapeSOQL(opportunity.closedLostStage)}' LIMIT ${SOQL_FETCH_CAP}`
    : `SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.isClosed} = false LIMIT ${SOQL_FETCH_CAP}`;

  const result = await searchContacts(token, soql);
  if (result.error) return result;

  const ids = accountIdsFromOpportunityRecords(result.records, opportunity.fields.accountId);
  cache.ids = ids;
  cache.fetchedAt = Date.now();
  return { ids };
}

/** Fetch account IDs with open / lost opportunities (no Contact semi-joins). */
export async function fetchOpportunityAccountIdSets(token, mapping = defaultMapping, filters = {}) {
  const { needOpen, needLost } = opportunityAccountSetNeeds(filters);
  if (!needOpen && !needLost) {
    return { open: new Set(), lost: new Set() };
  }

  const [openResult, lostResult] = await Promise.all([
    needOpen ? fetchOpportunityAccountIds(token, mapping, "open") : Promise.resolve({ ids: new Set() }),
    needLost ? fetchOpportunityAccountIds(token, mapping, "lost") : Promise.resolve({ ids: new Set() }),
  ]);
  if (openResult.error) return openResult;
  if (lostResult.error) return lostResult;

  return {
    open: openResult.ids,
    lost: lostResult.ids,
  };
}

/** Mirrors the v2 spec previously encoded in buildTargetQuery SOQL semi-joins. */
export function filterByOpportunityAccounts(records, filters = {}, mapping = defaultMapping, sets) {
  if (!sets || !hasOpportunityQueryFilters(filters)) {
    return Array.isArray(records) ? records : [];
  }

  const enterprise = filters.entreprise || {};
  const { open, lost } = sets;

  return (Array.isArray(records) ? records : []).filter((record) => {
    const accountId = accountIdFromContactRecord(record, mapping);
    if (!accountId) return false;

    const hasOpen = open.has(accountId);
    const hasLost = lost.has(accountId);

    if (enterprise.opp_ouverte === true && !hasOpen) return false;
    if (enterprise.opp_ouverte === false && hasOpen) return false;

    if (enterprise.opp_perdue === true) {
      if (!hasLost) return false;
      if (enterprise.opp_ouverte !== true && hasOpen) return false;
    }
    if (enterprise.opp_perdue === false && hasLost) return false;

    return true;
  });
}

/** Apply predicates that depend on Task child records returned by SOQL. */
export function filterTargetContacts(records, filters = {}, mapping, now = new Date()) {
  const followUp = filters.relance || {};
  const fields = mapping.objects.task.fields;
  const excluded = followUp.exclure_si_plus_de || {};
  const maxCalls = positiveInteger(excluded.appels);
  const recentDays = positiveInteger(excluded.sur_jours);
  const wantedResults = stringList(followUp.dernier_resultat);
  const beforeDays = positiveInteger(followUp.dernier_appel_avant_jours);
  const withinDays = positiveInteger(followUp.dernier_appel_dans_jours);

  return (Array.isArray(records) ? records : []).filter((record) => {
    const calls = callTasks(record, mapping);
    const latestWithResult = calls.find((call) => call[fields.result] != null && call[fields.result] !== "");

    if (followUp.jamais_appele === true && hasAnyCall(record, mapping)) return false;
    if (beforeDays && calls.some((call) => callInLastNDays(call, beforeDays, now, fields))) return false;
    if (withinDays && !calls.some((call) => callInLastNDays(call, withinDays, now, fields))) return false;

    if (wantedResults.length && (!latestWithResult || !wantedResults.includes(latestWithResult[fields.result]))) return false;
    if (maxCalls && recentDays) {
      const recentCalls = calls.filter((call) => {
        const age = dateAgeDays(call[fields.activityDate], now);
        return age !== null && age >= 0 && age <= recentDays;
      });
      if (recentCalls.length > maxCalls) return false;
    }
    return true;
  });
}

async function exchangeRefreshToken(refreshToken) {
  const clientId = process.env.SF_CLIENT_ID || "";
  const clientSecret = process.env.SF_CLIENT_SECRET || "";
  const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
  if (!clientId || !clientSecret || !refreshToken) return { error: "sf_missing_credentials" };
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { error: "sf_auth_error" };
  const accessToken = (await response.json()).access_token;
  return accessToken ? { accessToken } : { error: "sf_auth_error" };
}

async function fetchUserSFToken({ client, userId, forceRefresh = false }) {
  const cached = sfUserTokenCache.get(userId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < SF_TOKEN_TTL_MS) {
    sfUserTokenContexts.set(cached.accessToken, { client, userId });
    return { accessToken: cached.accessToken, credential: "user" };
  }
  if (cached) sfUserTokenCache.delete(userId);

  let data;
  let error;
  try {
    ({ data, error } = await client
      .from("profiles")
      .select("sf_refresh_token_encrypted")
      .eq("id", userId)
      .maybeSingle());
  } catch {
    return null;
  }
  if (error || !data?.sf_refresh_token_encrypted) return null;

  try {
    const refreshToken = await decryptRefreshToken(data.sf_refresh_token_encrypted);
    const result = await exchangeRefreshToken(refreshToken);
    if (result.error) return null;
    sfUserTokenCache.set(userId, { accessToken: result.accessToken, fetchedAt: Date.now() });
    sfUserTokenContexts.set(result.accessToken, { client, userId });
    return { accessToken: result.accessToken, credential: "user" };
  } catch {
    return null;
  }
}

export async function fetchSFToken(options = {}) {
  if (options.client && options.userId) {
    const userToken = await fetchUserSFToken(options);
    if (userToken) return userToken;
    // Product path is user-OAuth only — do not silently fall back to SF_REFRESH_TOKEN.
    if (options.allowOrgFallback !== true) {
      return { error: "sf_auth_error" };
    }
  }
  if (!options.forceRefresh && sfTokenCache.accessToken && Date.now() - sfTokenCache.fetchedAt < SF_TOKEN_TTL_MS) {
    return { accessToken: sfTokenCache.accessToken };
  }
  const clientId = process.env.SF_CLIENT_ID || "";
  const clientSecret = process.env.SF_CLIENT_SECRET || "";
  const refreshToken = process.env.SF_REFRESH_TOKEN || "";
  if (!clientId || !clientSecret || !refreshToken) {
    invalidateSFTokenCache();
    return { error: "sf_missing_credentials" };
  }
  try {
    const result = await exchangeRefreshToken(refreshToken);
    if (result.error) {
      invalidateSFTokenCache();
      return result;
    }
    sfTokenCache = { accessToken: result.accessToken, fetchedAt: Date.now() };
    return { accessToken: result.accessToken };
  } catch (error) {
    invalidateSFTokenCache();
    throw error;
  }
}

function instanceUrl() {
  return process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com";
}

async function sfFetchWithRetry(token, makeRequest) {
  let response = await makeRequest(token);
  if (response.status !== 401) return { response, token };

  const userContext = sfUserTokenContexts.get(token);
  if (!userContext) invalidateSFTokenCache();
  const refreshed = await fetchSFToken(userContext
    ? { ...userContext, forceRefresh: true }
    : { forceRefresh: true });
  if (refreshed.error) return { error: "sf_auth_error" };

  response = await makeRequest(refreshed.accessToken);
  return { response, token: refreshed.accessToken };
}

export async function searchContacts(token, soql, options = {}) {
  const request = (requestToken) => fetch(`${instanceUrl()}/services/data/v67.0/query?${new URLSearchParams({ q: soql })}`, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await sfFetchWithRetry(token, request);
  if (result.error) return result;
  const { response } = result;
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    return { error: "sf_query_error", message };
  }
  let page = await response.json();
  let currentToken = result.token;
  const records = [...(page.records || [])];
  while (
    page.done === false
    && page.nextRecordsUrl
    && records.length < SOQL_FETCH_CAP
    && !(typeof options.stopWhen === "function" && options.stopWhen(records))
  ) {
    const nextRequest = (requestToken) => fetch(`${instanceUrl()}${page.nextRecordsUrl}`, {
      headers: { Authorization: `Bearer ${requestToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const nextResult = await sfFetchWithRetry(currentToken, nextRequest);
    if (nextResult.error) return nextResult;
    if (!nextResult.response.ok) {
      return { error: "sf_query_error", message: (await nextResult.response.text()).slice(0, 500) };
    }
    page = await nextResult.response.json();
    currentToken = nextResult.token;
    records.push(...(page.records || []));
  }
  return { records: records.slice(0, SOQL_FETCH_CAP) };
}

async function createSObject(token, objectName, fields) {
  const request = (requestToken) => fetch(`${instanceUrl()}/services/data/v67.0/sobjects/${objectName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await sfFetchWithRetry(token, request);
  if (result.error) return result;
  const { response } = result;
  if (!response.ok) return { error: "sf_write_error", message: (await response.text()).slice(0, 500) };
  return { record: await response.json() };
}

export function createRecord(token, objectName, fields) {
  return createSObject(token, objectName, fields);
}

export async function updateSObjects(token, objectName, records) {
  const request = (requestToken) => fetch(`${instanceUrl()}/services/data/v67.0/composite/sobjects`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      allOrNone: false,
      records: records.map((record) => ({ attributes: { type: objectName }, ...record })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await sfFetchWithRetry(token, request);
  if (result.error) return result;
  if (!result.response.ok) return { error: "sf_write_error", message: (await result.response.text()).slice(0, 500) };
  return { records: await result.response.json() };
}

/** YYYY-MM-DD in Europe/Paris — required for Tasks to show in SF activity timelines. */
export function parisToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

export async function logCall(token, { contactId, accountId, resultat, comments = "", durationSec = 0, ownerId, actorName = "Utilisateur Inconnu" }, mapping = defaultMapping) {
  const task = mapping.objects.task;
  const fields = task.fields;
  const call = {
    [fields.subtype]: task.subtypeValue,
    [fields.result]: resultat,
    [fields.whoId]: contactId,
    [fields.status]: task.statusValue,
    [fields.activityDate]: parisToday(),
    [fields.subject]: `Appel — ${resultat}`,
    [fields.description]: `${comments}\n\n[via X OS par ${actorName}]`,
    Priority: "Normal",
  };
  // Duration is optional / unused in the cockpit — omit zero to avoid noisy SF fields.
  if (Number.isFinite(durationSec) && durationSec > 0) {
    call[fields.duration] = durationSec;
  }
  if (accountId) call[fields.whatId] = accountId;
  if (ownerId) call[fields.ownerId] = ownerId;
  return createSObject(token, task.name, call);
}

export function buildLightningUrl(objectType, recordId) {
  if (!objectType || !recordId) return null;
  return `${instanceUrl()}/lightning/r/${objectType}/${recordId}/view`;
}

/** Batch-fetch email/title for session contact hydration. */
export async function fetchContactBasicsByIds(token, contactIds, mapping = defaultMapping) {
  const cf = mapping.objects.contact.fields;
  const ids = [...new Set((contactIds || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return { byId: new Map() };

  const soql = [
    `SELECT ${cf.id}, ${cf.email}, ${cf.title}`,
    `FROM ${mapping.objects.contact.name}`,
    `WHERE ${cf.id} IN (${ids.map((id) => `'${escapeSOQL(id)}'`).join(", ")})`,
  ].join(" ");

  const search = await searchContacts(token, soql);
  if (search.error) return { error: search.error };

  const byId = new Map();
  for (const record of search.records || []) {
    const id = record[cf.id];
    if (!id) continue;
    byId.set(id, {
      email: record[cf.email] ?? null,
      title: record[cf.title] ?? null,
    });
  }
  return { byId };
}

/** Live Task history + open/closed opportunities + NPA for the runner cockpit.
 *  options.lite = prefetch path (moins de SOQL / pas de peers).
 */
export async function fetchContactContext(
  token,
  { contactId, accountId },
  mapping = defaultMapping,
  options = {},
) {
  const lite = options.lite === true;
  const contact = mapping.objects.contact;
  const account = mapping.objects.account;
  const task = mapping.objects.task;
  const opportunity = mapping.objects.opportunity;
  const tf = task.fields;
  const cf = contact.fields;
  const af = account.fields;
  const of = opportunity.fields;

  // Contact + Account en un seul SOQL (évite 2 round-trips).
  const contactAccountSoql = [
    `SELECT ${cf.doNotCall}, ${cf.email}, ${cf.title}`,
    accountId
      ? `, Account.${af.id}, Account.${af.name}, Account.${af.industry}, Account.${af.customerType}, Account.${af.ownerId}`
      : "",
    `FROM ${contact.name}`,
    `WHERE ${cf.id} = '${escapeSOQL(contactId)}'`,
    `LIMIT 1`,
  ].filter(Boolean).join(" ");

  const taskLimit = lite ? 8 : 12;
  const taskSoql = [
    `SELECT ${[tf.id, tf.activityDate, tf.result, tf.subject, tf.description].join(", ")}`,
    `FROM ${task.name}`,
    `WHERE ${tf.whoId} = '${escapeSOQL(contactId)}'`,
    `AND ${tf.subtype} = '${escapeSOQL(task.subtypeValue)}'`,
    `ORDER BY ${tf.activityDate} DESC NULLS LAST`,
    `LIMIT ${taskLimit}`,
  ].join(" ");

  const oppSoql = accountId
    ? [
        `SELECT ${[of.id, of.name, of.stageName, of.isClosed, of.isWon, of.amount, of.closeDate].join(", ")}`,
        `FROM ${opportunity.name}`,
        `WHERE ${of.accountId} = '${escapeSOQL(accountId)}'`,
        `ORDER BY ${of.isClosed} ASC, ${of.closeDate} DESC NULLS LAST`,
        `LIMIT ${lite ? 6 : 10}`,
      ].join(" ")
    : null;

  const event = mapping.objects.event;
  const ef = event.fields;
  const eventSoql = accountId
    ? [
        `SELECT Id, ${ef.subject}, ${ef.startDateTime}, ${ef.whoId}, ${ef.whatId}`,
        `FROM ${event.name}`,
        `WHERE ${ef.whatId} = '${escapeSOQL(accountId)}'`,
        `ORDER BY ${ef.startDateTime} DESC NULLS LAST`,
        `LIMIT ${lite ? 6 : 10}`,
      ].join(" ")
    : [
        `SELECT Id, ${ef.subject}, ${ef.startDateTime}, ${ef.whoId}, ${ef.whatId}`,
        `FROM ${event.name}`,
        `WHERE ${ef.whoId} = '${escapeSOQL(contactId)}'`,
        `ORDER BY ${ef.startDateTime} DESC NULLS LAST`,
        `LIMIT ${lite ? 6 : 10}`,
      ].join(" ");

  const ocrSoql = lite
    ? null
    : [
        `SELECT OpportunityId`,
        `FROM OpportunityContactRole`,
        `WHERE ContactId = '${escapeSOQL(contactId)}'`,
        `LIMIT 50`,
      ].join(" ");

  const [contactResult, tasksResult, oppResult, ocrResult, eventResult] = await Promise.all([
    searchContacts(token, contactAccountSoql),
    searchContacts(token, taskSoql),
    oppSoql ? searchContacts(token, oppSoql) : Promise.resolve({ records: [] }),
    ocrSoql ? searchContacts(token, ocrSoql) : Promise.resolve({ records: [] }),
    searchContacts(token, eventSoql),
  ]);

  if (contactResult.error) return { error: contactResult.error };
  if (tasksResult.error) return { error: tasksResult.error };
  if (oppResult.error) return { error: oppResult.error };
  // Events best-effort : si inaccessible, on continue sans historique RDV.
  const events = (eventResult.error ? [] : eventResult.records || []).map((record) => ({
    id: record.Id,
    subject: record[ef.subject] || null,
    start_date_time: record[ef.startDateTime] || null,
    record_url: buildLightningUrl(event.name, record.Id),
    linked_to_contact: record[ef.whoId] === contactId,
  }));
  // OCR = OpportunityContactRole (association Contact ↔ Opportunity dans Salesforce).
  const linkedOppIds = new Set(
    (ocrResult.error ? [] : ocrResult.records || [])
      .map((row) => row.OpportunityId)
      .filter(Boolean),
  );

  const contactRow = contactResult.records?.[0];
  const accountRow = contactRow?.Account || null;
  const npa = Boolean(contactRow?.[cf.doNotCall]);
  const industry = accountRow?.[af.industry] || null;

  // Peers : uniquement hors lite (prefetch) — 2ᵉ round-trip volontairement évité au warm-up.
  let peerClients = [];
  if (!lite && industry) {
    const peersSoql = [
      `SELECT ${af.id}, ${af.name}, ${af.industry}`,
      `FROM ${account.name}`,
      `WHERE ${af.industry} = '${escapeSOQL(industry)}'`,
      `AND ${af.customerType} = 'Client'`,
      accountId ? `AND ${af.id} != '${escapeSOQL(accountId)}'` : null,
      `ORDER BY ${af.name} ASC`,
      `LIMIT 3`,
    ].filter(Boolean).join(" ");
    const peersResult = await searchContacts(token, peersSoql);
    if (!peersResult.error) {
      peerClients = (peersResult.records || []).map((record) => ({
        id: record[af.id],
        name: record[af.name] || "",
        industry: record[af.industry] || null,
        record_url: buildLightningUrl(account.name, record[af.id]),
      }));
    }
  }

  const opportunities = (oppResult.records || []).map((record) => ({
    id: record[of.id],
    name: record[of.name] || "",
    stage_name: record[of.stageName] || null,
    is_closed: Boolean(record[of.isClosed]),
    is_won: Boolean(record[of.isWon]),
    amount: typeof record[of.amount] === "number" ? record[of.amount] : null,
    close_date: record[of.closeDate] || null,
    record_url: buildLightningUrl(opportunity.name, record[of.id]),
    linked_to_contact: linkedOppIds.has(record[of.id]),
  }));

  return {
    contact_record_url: buildLightningUrl(contact.name, contactId),
    account_record_url: accountId ? buildLightningUrl(account.name, accountId) : null,
    email: contactRow?.[cf.email] ?? null,
    title: contactRow?.[cf.title] ?? null,
    account_name: accountRow?.[af.name] ?? null,
    account_owner_sf_user_id: accountRow?.[af.ownerId] || null,
    industry,
    peer_clients: peerClients,
    npa,
    tasks: (tasksResult.records || []).map((record) => ({
      id: record[tf.id],
      activity_date: record[tf.activityDate] || null,
      result: record[tf.result] || null,
      subject: record[tf.subject] || null,
      description: record[tf.description] || null,
      record_url: buildLightningUrl(task.name, record[tf.id]),
    })),
    opportunities,
    events,
  };
}

export async function updateContactDoNotCall(token, contactId, value, mapping = defaultMapping) {
  const contact = mapping.objects.contact;
  const request = (requestToken) => fetch(
    `${instanceUrl()}/services/data/v67.0/sobjects/${contact.name}/${encodeURIComponent(contactId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ [contact.fields.doNotCall]: Boolean(value) }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const result = await sfFetchWithRetry(token, request);
  if (result.error) return result;
  const { response } = result;
  if (!response.ok) return { error: "sf_write_error", message: (await response.text()).slice(0, 500) };
  return { ok: true };
}

export async function createEvent(token, { subject, startDateTime, durationMin, whoId, whatId, ownerId, invitees = [] }, mapping = defaultMapping) {
  const event = mapping.objects.event;
  const fields = event.fields;
  const start = new Date(startDateTime);
  const duration = Number(durationMin);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(duration) || duration <= 0) return { error: "invalid_event" };
  const payload = {
    [fields.subject]: subject,
    [fields.startDateTime]: start.toISOString(),
    [fields.endDateTime]: new Date(start.getTime() + duration * 60_000).toISOString(),
  };
  if (whoId) payload[fields.whoId] = whoId;
  if (whatId) payload[fields.whatId] = whatId;
  if (ownerId) payload[fields.ownerId] = ownerId;
  const created = await createSObject(token, event.name, payload);
  if (created.error || !Array.isArray(invitees)) return created;
  const relations = await Promise.all(invitees
    .filter((id) => typeof id === "string" && id)
    .map((invitee) => createSObject(token, event.relationName, {
      [fields.eventId]: created.record.id,
      [fields.relationId]: invitee,
    })));
  const failedRelation = relations.find((relation) => relation.error);
  if (failedRelation) return { ...created, inviteeError: failedRelation.error };
  return created;
}
