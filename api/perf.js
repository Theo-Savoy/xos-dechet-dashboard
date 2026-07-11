import { createClient } from "@supabase/supabase-js";
import { verifyJWT } from "./_auth.js";
import { getProfile } from "./_calls/profileCache.js";
import { canViewTeamPerf } from "./_config/access.js";
import mapping from "./_crm/mapping.js";
import { escapeSOQL, fetchSFToken, searchContacts } from "./_crm/salesforce.js";

const CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=60";
const TIMEZONE = "Europe/Paris";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL } });
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function dateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

function dateKey(value = new Date()) {
  const { year, month, day } = dateParts(value instanceof Date ? value : new Date(value));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(key, days) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayFor(key) {
  const date = new Date(`${key}T12:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(key, -offset);
}

function isoWeek(key) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 4 - ((date.getUTCDay() + 6) % 7));
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekWindow(weeks) {
  const currentMonday = mondayFor(dateKey());
  const starts = Array.from({ length: weeks }, (_, index) => addDays(currentMonday, (index - weeks + 1) * 7));
  return { starts, from: starts[0], to: addDays(currentMonday, 6), toExclusive: addDays(currentMonday, 7) };
}

function query(object, fields, where = "", order = "") {
  return `SELECT ${fields.join(", ")} FROM ${object}${where ? ` WHERE ${where}` : ""}${order ? ` ORDER BY ${order}` : ""}`;
}

async function crmRecords(token, soql) {
  const result = await searchContacts(token, soql);
  if (result.error) throw new Error(result.error);
  return result.records || [];
}

async function teamProfiles(client) {
  const { data, error } = await client.from("profiles").select("email, full_name, sf_user_id, role");
  return error ? null : data || [];
}

function ownerMeta(profiles, sfUserId, fallback = {}) {
  const profile = profiles.find((entry) => entry.sf_user_id === sfUserId);
  return {
    sf_user_id: sfUserId,
    name: profile?.full_name || fallback.name || sfUserId,
    email: profile?.email || null,
    role: profile?.role || fallback.role || null,
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export async function GET(request) {
  const user = await verifyJWT(request);
  if (!user) return json(401, { error: "unauthorized" });
  const rawWeeks = new URL(request.url).searchParams.get("weeks");
  const weeks = rawWeeks === null ? 8 : Number(rawWeeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 16) return json(400, { error: "invalid_weeks" });

  const client = serviceClient();
  if (!client) return json(500, { error: "service_unavailable" });
  const profile = await getProfile(client, user.id);
  if (profile.error) return json(500, { error: profile.error });
  const teamView = canViewTeamPerf(profile.role);
  const window = weekWindow(weeks);
  const empty = { weeks, timezone: TIMEZONE, range: { from: window.from, to: window.to }, view: teamView ? "team" : "self", owners: [], pulse: [], pipeline: [], effort: [] };
  if (!teamView && !profile.sfUserId) return json(200, { ...empty, warning: "sf_user_unmapped" });

  const tokenResult = await fetchSFToken();
  if (tokenResult.error || !tokenResult.accessToken) return json(502, { error: tokenResult.error || "sf_auth_error" });
  const { task, event, opportunity, opportunityHistory } = mapping.objects;
  // SOQL : les littéraux date (YYYY-MM-DD) et datetime (ISO Z) ne se quotent PAS —
  // quotés, Salesforce répond MALFORMED_QUERY (vérifié live sur l'org).
  const fromDate = window.from;
  const toDate = window.toExclusive;
  const fromDateTime = `${window.from}T00:00:00Z`;
  const toDateTime = `${window.toExclusive}T00:00:00Z`;
  try {
    const [tasks, events, histories, generated, won, openOpps, profiles] = await Promise.all([
      crmRecords(tokenResult.accessToken, query(task.name, [task.fields.ownerId, task.fields.activityDate, task.fields.subtype], `${task.fields.subtype} = '${task.subtypeValue}' AND ${task.fields.activityDate} >= ${fromDate} AND ${task.fields.activityDate} < ${toDate}`)),
      crmRecords(tokenResult.accessToken, query(event.name, [event.fields.ownerId, event.fields.activityDate], `${event.fields.activityDate} >= ${fromDate} AND ${event.fields.activityDate} < ${toDate}`)),
      // Borné à la fenêtre : l'org compte 17k+ lignes d'historique, le cap SOQL en tronquerait un sous-ensemble arbitraire.
      crmRecords(tokenResult.accessToken, query(opportunityHistory.name, [opportunityHistory.fields.opportunityId, opportunityHistory.fields.stageName, opportunityHistory.fields.createdDate, opportunityHistory.fields.createdById], `${opportunityHistory.fields.createdDate} >= ${fromDateTime} AND ${opportunityHistory.fields.createdDate} < ${toDateTime}`, `${opportunityHistory.fields.opportunityId}, ${opportunityHistory.fields.createdDate}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.createdDate, opportunity.fields.amount], `${opportunity.fields.createdDate} >= ${fromDateTime} AND ${opportunity.fields.createdDate} < ${toDateTime}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${fromDate} AND ${opportunity.fields.closeDate} < ${toDate}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.isClosed, opportunity.fields.stageName], `${opportunity.fields.isClosed} = false AND ${opportunity.fields.stageName} != '${opportunityHistory.stages.stalledSuspect}'`)),
      teamView ? teamProfiles(client) : Promise.resolve([]),
    ]);
    if (profiles === null) return json(500, { error: "team_lookup_failed" });

    // Étape de départ des opps vues dans la fenêtre : dernière ligne d'historique
    // pré-fenêtre par opp, sinon la première transition de la fenêtre serait ignorée.
    const windowOppIds = [...new Set(histories.map((record) => record[opportunityHistory.fields.opportunityId]).filter(Boolean))];
    const baselineStages = new Map();
    for (let index = 0; index < windowOppIds.length; index += 200) {
      const chunk = windowOppIds.slice(index, index + 200);
      const rows = await crmRecords(tokenResult.accessToken, query(
        opportunityHistory.name,
        [opportunityHistory.fields.opportunityId, opportunityHistory.fields.stageName],
        `${opportunityHistory.fields.opportunityId} IN (${chunk.map((id) => `'${escapeSOQL(id)}'`).join(", ")}) AND ${opportunityHistory.fields.createdDate} < ${fromDateTime}`,
        `${opportunityHistory.fields.opportunityId}, ${opportunityHistory.fields.createdDate}`,
      ));
      for (const row of rows) baselineStages.set(row[opportunityHistory.fields.opportunityId], row[opportunityHistory.fields.stageName]);
    }
    const owners = new Set(teamView ? [] : [profile.sfUserId]);
    const addOwners = (records, field) => records.forEach((record) => { if (record[field]) owners.add(record[field]); });
    addOwners(tasks, task.fields.ownerId);
    addOwners(events, event.fields.ownerId);
    addOwners(histories, opportunityHistory.fields.createdById);
    addOwners(generated, opportunity.fields.ownerId);
    addOwners(won, opportunity.fields.ownerId);
    addOwners(openOpps, opportunity.fields.ownerId);
    if (!teamView) owners.clear(), owners.add(profile.sfUserId);
    const allowed = (id) => owners.has(id);
    const ownerIds = [...owners];
    const openByOwner = new Map();
    for (const record of openOpps) {
      if (allowed(record[opportunity.fields.ownerId]) && !record[opportunity.fields.isClosed] && record[opportunity.fields.stageName] !== opportunityHistory.stages.stalledSuspect) {
        openByOwner.set(record[opportunity.fields.ownerId], (openByOwner.get(record[opportunity.fields.ownerId]) || 0) + 1);
      }
    }
    const data = new Map();
    const row = (owner, start) => {
      const key = `${owner}:${start}`;
      if (!data.has(key)) data.set(key, { sf_user_id: owner, week: isoWeek(start), week_start: start, calls: 0, meetings: 0, proposals: 0, generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0, progressions: 0 });
      return data.get(key);
    };
    for (const owner of ownerIds) for (const start of window.starts) row(owner, start);
    const inWindow = (record, ownerField, dateField, callback) => {
      const owner = record[ownerField]; const start = mondayFor(dateKey(record[dateField]));
      if (allowed(owner) && window.starts.includes(start)) callback(row(owner, start));
    };
    for (const record of tasks) if (record[task.fields.subtype] === task.subtypeValue) inWindow(record, task.fields.ownerId, task.fields.activityDate, (target) => { target.calls += 1; });
    for (const record of events) inWindow(record, event.fields.ownerId, event.fields.activityDate, (target) => { target.meetings += 1; });
    for (const record of histories) if (record[opportunityHistory.fields.stageName] === opportunityHistory.stages.proposalSent) inWindow(record, opportunityHistory.fields.createdById, opportunityHistory.fields.createdDate, (target) => { target.proposals += 1; });
    for (const record of generated) inWindow(record, opportunity.fields.ownerId, opportunity.fields.createdDate, (target) => { target.generated_count += 1; target.generated_amount += number(record[opportunity.fields.amount]); });
    for (const record of won) inWindow(record, opportunity.fields.ownerId, opportunity.fields.closeDate, (target) => { target.won_count += 1; target.won_amount += number(record[opportunity.fields.amount]); });
    const previousStages = new Map(baselineStages); const progressed = new Set();
    for (const record of histories) {
      const opportunityId = record[opportunityHistory.fields.opportunityId]; const stage = record[opportunityHistory.fields.stageName];
      const previous = previousStages.get(opportunityId); previousStages.set(opportunityId, stage);
      const start = mondayFor(dateKey(record[opportunityHistory.fields.createdDate])); const progressionKey = `${opportunityId}:${start}`;
      if (previous && opportunityHistory.stageOrder[stage] > opportunityHistory.stageOrder[previous] && !progressed.has(progressionKey)) {
        inWindow(record, opportunityHistory.fields.createdById, opportunityHistory.fields.createdDate, (target) => { target.progressions += 1; });
        progressed.add(progressionKey);
      }
    }
    const rows = [...data.values()];
    return json(200, {
      ...empty,
      owners: ownerIds.map((id) => ownerMeta(profiles, id, id === profile.sfUserId ? { name: profile.fullName, role: profile.role } : {})),
      pulse: rows.map(({ sf_user_id, week, week_start, calls, meetings, proposals }) => ({ sf_user_id, week, week_start, calls, meetings, proposals })),
      pipeline: rows.map((entry) => ({ ...((({ sf_user_id, week, week_start, generated_count, generated_amount, won_count, won_amount }) => ({ sf_user_id, week, week_start, generated_count, generated_amount, won_count, won_amount }))(entry)), closing_rate_count: entry.generated_count ? entry.won_count / entry.generated_count : null, closing_rate_amount: entry.generated_amount ? entry.won_amount / entry.generated_amount : null })),
      effort: rows.map((entry) => { const open = openByOwner.get(entry.sf_user_id) || 0; return { sf_user_id: entry.sf_user_id, week: entry.week, week_start: entry.week_start, progressions: entry.progressions, open_opps_at_start: open, effort_rate: open ? entry.progressions / open : null }; }),
    });
  } catch (error) {
    return json(502, { error: error.message || "sf_query_error" });
  }
}
