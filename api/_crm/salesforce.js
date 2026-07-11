/** Salesforce CRM adapter. All organization-specific API names come from mapping. */
import defaultMapping from "./mapping.js";

export const SOQL_FETCH_CAP = 2000;

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

export function hasRelanceQueryFilters(filters = {}) {
  const followUp = filters.relance || {};
  return (
    followUp.jamais_appele === true
    || positiveInteger(followUp.dernier_appel_avant_jours) !== null
    || positiveInteger(followUp.dernier_appel_dans_jours) !== null
  );
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
 * Builds the Contact SOQL query. Last-call predicates that SOQL cannot express
 * on Task anti/semi-joins are completed in filterTargetContacts.
 */
export function buildTargetQuery(filters = {}, mapping = defaultMapping, sfUserId) {
  const account = mapping.objects.account;
  const contact = mapping.objects.contact;
  const opportunity = mapping.objects.opportunity;
  const enterprise = filters.entreprise || {};
  const contactFilters = filters.contact || {};
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

  if (enterprise.opp_ouverte === true) {
    conditions.push(`${contact.fields.accountId} IN (SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.isClosed} = false)`);
  }
  if (enterprise.opp_ouverte === false) {
    conditions.push(`${contact.fields.accountId} NOT IN (SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.isClosed} = false)`);
  }
  if (enterprise.opp_perdue === true) {
    conditions.push(`${contact.fields.accountId} IN (SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.stageName} = '${escapeSOQL(opportunity.closedLostStage)}')`);
    if (enterprise.opp_ouverte !== false) {
      conditions.push(`${contact.fields.accountId} NOT IN (SELECT ${opportunity.fields.accountId} FROM ${opportunity.name} WHERE ${opportunity.fields.isClosed} = false)`);
    }
  }

  if (contactFilters.a_telephone === true) conditions.push(`${contact.fields.mobilePhone} != null`);
  if (contactFilters.exclure_npa !== false) conditions.push(`${contact.fields.doNotCall} = false`);
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
    taskSubquery(mapping),
  ].join(", ");
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = hasRelanceQueryFilters(filters) ? SOQL_FETCH_CAP : boundedLimit(filters.limit);
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
    const latest = calls[0];

    if (followUp.jamais_appele === true && hasAnyCall(record, mapping)) return false;
    if (beforeDays && calls.some((call) => callInLastNDays(call, beforeDays, now, fields))) return false;
    if (withinDays && !calls.some((call) => callInLastNDays(call, withinDays, now, fields))) return false;

    if (wantedResults.length && (!latest || !wantedResults.includes(latest[fields.result]))) return false;
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

export async function fetchSFToken() {
  const clientId = process.env.SF_CLIENT_ID || "";
  const clientSecret = process.env.SF_CLIENT_SECRET || "";
  const refreshToken = process.env.SF_REFRESH_TOKEN || "";
  const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
  if (!clientId || !clientSecret || !refreshToken) return { error: "sf_missing_credentials" };
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { error: "sf_auth_error" };
  return { accessToken: (await response.json()).access_token };
}

function instanceUrl() {
  return process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com";
}

export async function searchContacts(token, soql) {
  const response = await fetch(`${instanceUrl()}/services/data/v67.0/query?${new URLSearchParams({ q: soql })}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { error: "sf_query_error" };
  return { records: (await response.json()).records || [] };
}

async function createSObject(token, objectName, fields) {
  const response = await fetch(`${instanceUrl()}/services/data/v67.0/sobjects/${objectName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { error: "sf_write_error", message: (await response.text()).slice(0, 500) };
  return { record: await response.json() };
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

/** Live Task history + open/closed opportunities for the runner cockpit. */
export async function fetchContactContext(token, { contactId, accountId }, mapping = defaultMapping) {
  const contact = mapping.objects.contact;
  const account = mapping.objects.account;
  const task = mapping.objects.task;
  const opportunity = mapping.objects.opportunity;
  const tf = task.fields;
  const of = opportunity.fields;

  const taskSoql = [
    `SELECT ${[tf.id, tf.activityDate, tf.result, tf.subject, tf.description].join(", ")}`,
    `FROM ${task.name}`,
    `WHERE ${tf.whoId} = '${escapeSOQL(contactId)}'`,
    `AND ${tf.subtype} = '${escapeSOQL(task.subtypeValue)}'`,
    `ORDER BY ${tf.activityDate} DESC NULLS LAST`,
    `LIMIT 15`,
  ].join(" ");

  const tasksResult = await searchContacts(token, taskSoql);
  if (tasksResult.error) return { error: tasksResult.error };

  let opportunities = [];
  if (accountId) {
    const oppSoql = [
      `SELECT ${[of.id, of.name, of.stageName, of.isClosed, of.isWon, of.amount, of.closeDate].join(", ")}`,
      `FROM ${opportunity.name}`,
      `WHERE ${of.accountId} = '${escapeSOQL(accountId)}'`,
      `ORDER BY ${of.isClosed} ASC, ${of.closeDate} DESC NULLS LAST`,
      `LIMIT 10`,
    ].join(" ");
    const oppResult = await searchContacts(token, oppSoql);
    if (oppResult.error) return { error: oppResult.error };
    opportunities = (oppResult.records || []).map((record) => ({
      id: record[of.id],
      name: record[of.name] || "",
      stage_name: record[of.stageName] || null,
      is_closed: Boolean(record[of.isClosed]),
      is_won: Boolean(record[of.isWon]),
      amount: typeof record[of.amount] === "number" ? record[of.amount] : null,
      close_date: record[of.closeDate] || null,
      record_url: buildLightningUrl(opportunity.name, record[of.id]),
    }));
  }

  return {
    contact_record_url: buildLightningUrl(contact.name, contactId),
    account_record_url: accountId ? buildLightningUrl(account.name, accountId) : null,
    tasks: (tasksResult.records || []).map((record) => ({
      id: record[tf.id],
      activity_date: record[tf.activityDate] || null,
      result: record[tf.result] || null,
      subject: record[tf.subject] || null,
      description: record[tf.description] || null,
      record_url: buildLightningUrl(task.name, record[tf.id]),
    })),
    opportunities,
  };
}

export async function updateContactDoNotCall(token, contactId, value, mapping = defaultMapping) {
  const contact = mapping.objects.contact;
  const response = await fetch(
    `${instanceUrl()}/services/data/v67.0/sobjects/${contact.name}/${encodeURIComponent(contactId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ [contact.fields.doNotCall]: Boolean(value) }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) return { error: "sf_write_error", message: (await response.text()).slice(0, 500) };
  return { ok: true };
}

/** Future-dated Task so the commercial sees the recall in SF. */
export async function createRecallTask(
  token,
  { contactId, accountId, recallAt, ownerId, actorName = "Utilisateur Inconnu" },
  mapping = defaultMapping,
) {
  const task = mapping.objects.task;
  const fields = task.fields;
  const payload = {
    [fields.subtype]: task.subtypeValue,
    [fields.whoId]: contactId,
    [fields.status]: task.statusValue,
    [fields.activityDate]: recallAt,
    [fields.subject]: `Rappel — à rappeler le ${recallAt}`,
    [fields.description]: `Rappel planifié depuis X OS Call Manager.\n\n[via X OS par ${actorName}]`,
  };
  if (accountId) payload[fields.whatId] = accountId;
  if (ownerId) payload[fields.ownerId] = ownerId;
  return createSObject(token, task.name, payload);
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
  for (const invitee of invitees.filter((id) => typeof id === "string" && id)) {
    const relation = await createSObject(token, event.relationName, {
      [fields.eventId]: created.record.id,
      [fields.relationId]: invitee,
    });
    if (relation.error) return { ...created, inviteeError: relation.error };
  }
  return created;
}
