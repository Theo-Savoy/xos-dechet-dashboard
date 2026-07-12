import { verifyJWT } from "./_auth.js";
import { getServiceClient } from "./_calls/http.js";
import { getProfile } from "./_calls/profileCache.js";
import { canViewTeamPerf, isWeeklyOwnerExcluded, sfIdKey, trackingModeFor } from "./_config/access.js";
import mapping from "./_crm/mapping.js";
import { escapeSOQL, fetchSFToken, searchContacts, buildLightningUrl } from "./_crm/salesforce.js";
import { quarterlyToMonthlyIndicative } from "./_weekly/targets.js";

const CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=120";
const TIMEZONE = "Europe/Paris";
const MAX_WEEKS = 16;

function json(status, body, extraHeaders = {}) {
  const timingMs = body?.context?.timing_ms;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL,
      ...(Number.isFinite(timingMs) ? { "Server-Timing": `perf;dur=${Math.round(timingMs)}` } : {}),
      ...extraHeaders,
    },
  });
}

function ownerInClause(field, ownerIds) {
  if (!ownerIds?.length) return "";
  return ` AND ${field} IN (${ownerIds.map((id) => `'${escapeSOQL(id)}'`).join(", ")})`;
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
  return { starts, from: starts[0], to: addDays(currentMonday, 6), toExclusive: addDays(currentMonday, 7), period: "weeks" };
}

function weekWindowAnchored(anchorMonday, weeks = 2) {
  const monday = mondayFor(anchorMonday);
  const starts = Array.from({ length: weeks }, (_, index) => addDays(monday, (index - weeks + 1) * 7));
  return { starts, from: starts[0], to: addDays(monday, 6), toExclusive: addDays(monday, 7), period: "week" };
}

/** Semaines ISO du trimestre fiscal en cours (lundi ≥ début TQ → dernier lundi du TQ). */
export function quarterWeekWindow(today = dateKey()) {
  const quarter = fiscalQuarter(today);
  const currentMonday = mondayFor(today);
  let start = mondayFor(quarter.from);
  if (start < quarter.from) start = addDays(start, 7);
  const lastDay = addDays(quarter.toExclusive, -1);
  const end = mondayFor(lastDay);
  const starts = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) starts.push(cursor);
  if (!starts.length) starts.push(currentMonday);
  const clipped = starts.slice(0, MAX_WEEKS);
  return {
    starts: clipped,
    from: clipped[0],
    // Plage de données « as of » = semaine courante (les semaines futures du TQ restent vides).
    to: addDays(currentMonday, 6),
    toExclusive: addDays(currentMonday, 7),
    period: "quarter",
    quarter,
  };
}

export function fiscalQuarter(key) {
  const [year, month] = key.split("-").map(Number);
  const fiscalStartYear = month >= 7 ? year : year - 1;
  const quarterNumber = Math.floor(((month - 7 + 12) % 12) / 3) + 1;
  const start = new Date(Date.UTC(fiscalStartYear, 6 + (quarterNumber - 1) * 3, 1));
  const end = new Date(Date.UTC(fiscalStartYear, 6 + quarterNumber * 3, 1));
  return {
    from: start.toISOString().slice(0, 10),
    toExclusive: end.toISOString().slice(0, 10),
    label: `FY${String(fiscalStartYear + 1).slice(-2)}-Q${quarterNumber}`,
  };
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

async function settingsValue(client, key) {
  const { data, error } = await client.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`${key}_lookup_failed`);
  return data?.value && typeof data.value === "object" ? data.value : {};
}

function findBySfId(entries, sfUserId) {
  const key = sfIdKey(sfUserId);
  return (entries || []).find((entry) => sfIdKey(entry.sf_user_id || entry.Id || entry.id) === key) || null;
}

function ownerMeta(profiles, sfUsers, sfUserId, fallback = {}, trackingOverrides = {}) {
  const profile = findBySfId(profiles, sfUserId);
  const sfUser = findBySfId(sfUsers, sfUserId);
  const name = profile?.full_name || sfUser?.Name || fallback.name || profile?.email?.split("@")[0] || sfUserId;
  return {
    sf_user_id: sfUserId,
    name,
    email: profile?.email || sfUser?.Email || null,
    role: profile?.role || fallback.role || null,
    tracking: trackingModeFor(sfUserId, trackingOverrides),
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function quarterForecast(signedToDate, records, fields) {
  const weightedOpen = records.reduce((sum, record) => sum + number(record[fields.amount]) * number(record[fields.probability]) / 100, 0);
  return { weightedOpen, forecast: number(signedToDate) + weightedOpen };
}

function expectedRevenue(record, fields) {
  if (record[fields.expectedRevenue] !== null && record[fields.expectedRevenue] !== undefined) return number(record[fields.expectedRevenue]);
  return number(record[fields.amount]) * number(record[fields.probability]) / 100;
}

function monthKey(value) {
  return dateKey(value).slice(0, 7);
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(Date.UTC(year, month - 1, 15)));
}

/** Ventilation mensuelle du pipe sur-mesure (CloseDate ∈ [today, +180 j]), Amount + ExpectedRevenue. */
export function buildCustomPipe(records, fields, today = dateKey(), ownerIds = null, horizonDays = 180) {
  const toExclusive = addDays(today, horizonDays + 1);
  const months = Array.from({ length: 6 }, (_, index) => {
    const anchor = new Date(`${today}T12:00:00.000Z`);
    anchor.setUTCMonth(anchor.getUTCMonth() + index, 1);
    const key = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
    return { month: key, label: monthLabel(key), amount: 0, expected: 0, count: 0, by_owner: {} };
  });
  const monthIndex = new Map(months.map((entry, index) => [entry.month, index]));
  const byOwner = new Map();
  const opps = [];
  for (const record of records) {
    const owner = record[fields.ownerId];
    if (ownerIds && ![...ownerIds].some((id) => sfIdKey(id) === sfIdKey(owner))) continue;
    const close = dateKey(record[fields.closeDate]);
    if (close < today || close >= toExclusive) continue;
    const key = monthKey(close);
    const amount = number(record[fields.amount]);
    const expected = expectedRevenue(record, fields);
    const bucket = monthIndex.has(key) ? months[monthIndex.get(key)] : null;
    if (bucket) {
      bucket.amount += amount;
      bucket.expected += expected;
      bucket.count += 1;
      const ownerBucket = bucket.by_owner[owner] || { amount: 0, expected: 0, count: 0 };
      ownerBucket.amount += amount;
      ownerBucket.expected += expected;
      ownerBucket.count += 1;
      bucket.by_owner[owner] = ownerBucket;
    }
    const ownerRow = byOwner.get(owner) || { sf_user_id: owner, amount: 0, expected: 0, count: 0 };
    ownerRow.amount += amount;
    ownerRow.expected += expected;
    ownerRow.count += 1;
    byOwner.set(owner, ownerRow);
    opps.push({
      id: record.Id || record[fields.id] || null,
      name: record.Name || record[fields.name] || "Opportunité",
      sf_user_id: owner,
      amount,
      expected,
      probability: number(record[fields.probability]),
      close_date: close,
      month: key,
      url: buildLightningUrl("Opportunity", record.Id || record[fields.id]),
    });
  }
  opps.sort((a, b) => b.expected - a.expected || b.amount - a.amount);
  const total_amount = months.reduce((sum, entry) => sum + entry.amount, 0);
  const total_expected = months.reduce((sum, entry) => sum + entry.expected, 0);
  return {
    horizon_days: horizonDays,
    total_amount,
    total_expected,
    count: opps.length,
    months,
    by_owner: [...byOwner.values()],
    opps: opps.slice(0, 8),
  };
}

/** Cumul signé à la fin de chaque semaine (CloseDate ≤ dimanche de la semaine). */
export function signedSeries(starts, quarterWon, ownerField, amountField, closeDateField, ownerId) {
  return starts.map((start) => {
    const endInclusive = addDays(start, 6);
    return quarterWon
      .filter((record) => sfIdKey(record[ownerField]) === sfIdKey(ownerId) && dateKey(record[closeDateField]) <= endInclusive)
      .reduce((sum, record) => sum + number(record[amountField]), 0);
  });
}

export function priorFiscalQuarter(today = dateKey()) {
  const current = fiscalQuarter(today);
  const [year, month, day] = current.from.split("-").map(Number);
  return fiscalQuarter(`${year - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

/** Semaines ISO d’un trimestre fiscal donné (fenêtre complète). */
export function fiscalQuarterWeekStarts(quarter) {
  let start = mondayFor(quarter.from);
  if (start < quarter.from) start = addDays(start, 7);
  const end = mondayFor(addDays(quarter.toExclusive, -1));
  const starts = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) starts.push(cursor);
  return starts.slice(0, MAX_WEEKS);
}

export function weekOfQuarterIndex(starts, today = dateKey()) {
  const currentMonday = mondayFor(today);
  const exact = starts.findIndex((start) => start === currentMonday);
  if (exact >= 0) return exact;
  const elapsed = starts.filter((start) => start <= currentMonday);
  return Math.max(0, elapsed.length - 1);
}

const DEFAULT_STAGNATION_DAYS = {
  "Projet identifié": 30,
  "XOS recommandé": 30,
  "Projet qualifié / AO reçu": 60,
  "Proposition envoyée": 45,
  "XOS short-listé": 60,
  "Nego technique engagée": 90,
  "Négo financière engagée": 60,
  "OK de principe": 30,
};
const NO_ACTIVITY_DAYS = 21;

function daysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return null;
  return Math.max(0, Math.round((Date.parse(`${toKey}T12:00:00.000Z`) - Date.parse(`${fromKey}T12:00:00.000Z`)) / 86400000));
}

/** Opps ouvertes du TQ, classées par CA attendu (montant × proba). */
export function buildFollowUpOpps(records, fields, ownerIds, limit = 40) {
  const allowed = new Set([...ownerIds].map((id) => sfIdKey(id)));
  return records
    .filter((record) => allowed.has(sfIdKey(record[fields.ownerId])))
    .map((record) => ({
      id: record[fields.id] || null,
      name: record[fields.name] || "Sans nom",
      account: record.Account?.Name || record["Account.Name"] || null,
      sf_user_id: record[fields.ownerId],
      stage: record[fields.stageName] || "",
      amount: number(record[fields.amount]),
      probability: number(record[fields.probability]),
      expected: expectedRevenue(record, fields),
      close_date: record[fields.closeDate] ? dateKey(record[fields.closeDate]) : null,
      url: buildLightningUrl("Opportunity", record[fields.id]),
    }))
    .filter((row) => row.expected > 0)
    .sort((a, b) => b.expected - a.expected || b.amount - a.amount)
    .slice(0, limit);
}

/** Opps stagnantes : durée d’étape au-delà du seuil et/ou silence d’activité. */
export function buildStagnantOpps(records, fields, ownerIds, today = dateKey(), stalledSuspect = "Suspect enlisé", options = {}) {
  const stagnation = options.stagnationDays || DEFAULT_STAGNATION_DAYS;
  const silentDays = options.noActivityDays ?? NO_ACTIVITY_DAYS;
  const limit = options.limit ?? 40;
  const quarterFrom = options.quarterFrom || null;
  const quarterToExclusive = options.quarterToExclusive || null;
  const allowed = new Set([...ownerIds].map((id) => sfIdKey(id)));
  const rows = [];
  for (const record of records) {
    if (!allowed.has(sfIdKey(record[fields.ownerId]))) continue;
    if (record[fields.isClosed]) continue;
    const stage = record[fields.stageName] || "";
    if (stage === stalledSuspect) continue;
    const close = record[fields.closeDate] ? dateKey(record[fields.closeDate]) : null;
    if (quarterFrom && quarterToExclusive && (!close || close < quarterFrom || close >= quarterToExclusive)) continue;
    const amount = number(record[fields.amount]);
    if (amount <= 0) continue;
    const stageAnchor = record[fields.lastStageChangeDate] || record[fields.createdDate];
    const daysInStage = daysBetween(stageAnchor ? dateKey(stageAnchor) : null, today);
    const activityAnchor = record[fields.lastActivityDate];
    const daysSinceActivity = activityAnchor ? daysBetween(dateKey(activityAnchor), today) : null;
    const threshold = stagnation[stage];
    const reasons = [];
    if (threshold && daysInStage !== null && daysInStage >= threshold) reasons.push("stage");
    if (daysSinceActivity === null || daysSinceActivity >= silentDays) reasons.push("silence");
    if (!reasons.length) continue;
    rows.push({
      id: record[fields.id] || null,
      name: record[fields.name] || "Sans nom",
      account: record.Account?.Name || record["Account.Name"] || null,
      sf_user_id: record[fields.ownerId],
      stage,
      amount,
      probability: number(record[fields.probability]),
      expected: expectedRevenue(record, fields),
      close_date: close,
      days_in_stage: daysInStage,
      days_since_activity: daysSinceActivity,
      reasons,
      url: buildLightningUrl("Opportunity", record[fields.id]),
    });
  }
  return rows
    .sort((a, b) => {
      const weight = (row) => row.reasons.length * 1e9 + row.expected;
      return weight(b) - weight(a);
    })
    .slice(0, limit);
}

export function buildPace({ signed, forecast, target, signedN1, weekOfQuarter, weeksInQuarter, wonCount = 0, expectedToDate = null }) {
  const elapsed = Math.max(1, weekOfQuarter);
  const total = Math.max(elapsed, weeksInQuarter);
  const linearExpected = target === null ? null : target * (elapsed / total);
  const expected = expectedToDate !== null && expectedToDate !== undefined ? expectedToDate : linearExpected;
  const runRate = signed * (total / elapsed);
  const paceRatio = expected && expected > 0 ? signed / expected : null;
  return {
    week_of_quarter: weekOfQuarter,
    weeks_in_quarter: total,
    signed_to_date: signed,
    forecast,
    target,
    signed_n1: signedN1,
    expected_to_date: expected,
    run_rate: runRate,
    pace_ratio: paceRatio,
    won_count: wonCount,
    expected_mode: expectedToDate !== null && expectedToDate !== undefined ? "seasonal" : "linear",
  };
}

/** FY XOS juillet→juin : Q1=07-09 … Q4=04-06. */
export const FISCAL_QUARTER_MONTHS = {
  Q1: ["07", "08", "09"],
  Q2: ["10", "11", "12"],
  Q3: ["01", "02", "03"],
  Q4: ["04", "05", "06"],
};

/**
 * Agrège 3 ans de CA signé mensuel → poids année / trimestre / mois-dans-TQ.
 * rows: [{ year, month (1-12), amount }]
 */
export function buildSeasonality(rows, asOf = dateKey()) {
  const byMonth = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1).padStart(2, "0"), 0]));
  let sampleYears = new Set();
  for (const row of rows || []) {
    const month = String(Number(row.month)).padStart(2, "0");
    if (!byMonth[month] && byMonth[month] !== 0) continue;
    byMonth[month] += Number(row.amount) || 0;
    if (row.year) sampleYears.add(Number(row.year));
  }
  const yearTotal = Object.values(byMonth).reduce((sum, value) => sum + value, 0);
  const month_of_year = {};
  for (const [month, amount] of Object.entries(byMonth)) {
    month_of_year[month] = yearTotal > 0 ? amount / yearTotal : 1 / 12;
  }
  const quarter_of_year = {};
  const month_in_quarter = {};
  for (const [qKey, months] of Object.entries(FISCAL_QUARTER_MONTHS)) {
    const qTotal = months.reduce((sum, month) => sum + (byMonth[month] || 0), 0);
    quarter_of_year[qKey] = yearTotal > 0 ? qTotal / yearTotal : 0.25;
    month_in_quarter[qKey] = {};
    for (const month of months) {
      month_in_quarter[qKey][month] = qTotal > 0 ? (byMonth[month] || 0) / qTotal : 1 / months.length;
    }
  }
  return {
    as_of: asOf,
    sample_years: [...sampleYears].sort(),
    year_total: yearTotal,
    month_of_year,
    quarter_of_year,
    month_in_quarter,
  };
}

/** Attendu à date dans le TQ courant, pondéré par le poids historique des mois du TQ. */
export function seasonalExpectedToDate(target, todayKey, quarter, seasonality) {
  if (target === null || target === undefined || !seasonality?.month_in_quarter) return null;
  const match = /Q([1-4])$/.exec(quarter.label || "");
  if (!match) return null;
  const qKey = `Q${match[1]}`;
  const months = FISCAL_QUARTER_MONTHS[qKey];
  const weights = seasonality.month_in_quarter[qKey];
  if (!months || !weights) return null;
  const todayMonthKey = todayKey.slice(5, 7);
  const todayDay = Number(todayKey.slice(8, 10));
  const todayIndex = months.indexOf(todayMonthKey);
  if (todayIndex === -1) return null;
  let progress = 0;
  for (let index = 0; index < months.length; index += 1) {
    const month = months[index];
    const weight = weights[month] || 0;
    if (index < todayIndex) progress += weight;
    else if (index === todayIndex) {
      const year = Number(todayKey.slice(0, 4));
      const daysInMonth = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
      progress += weight * Math.min(1, Math.max(0, todayDay / daysInMonth));
    }
  }
  return target * Math.min(1, Math.max(0, progress));
}

export function emptyCallResults() {
  const results = mapping.objects.task.results || [];
  return Object.fromEntries(results.map((label) => [label, 0]));
}

async function loadForecastHistory(client, quarterLabel, ownerIds) {
  if (!ownerIds.length) return [];
  const { data, error } = await client
    .from("perf_forecast_snapshots")
    .select("week_start, sf_user_id, forecast, signed_to_date")
    .eq("quarter", quarterLabel)
    .in("sf_user_id", ownerIds)
    .order("week_start", { ascending: true });
  if (error) {
    // Table absente en local / avant migration : on ne casse pas Weekly Perf.
    if (/perf_forecast_snapshots|schema cache|does not exist/i.test(error.message || "")) return [];
    throw new Error("forecast_history_lookup_failed");
  }
  return data || [];
}

async function upsertForecastSnapshots(client, rows) {
  if (!rows.length) return;
  const { error } = await client.from("perf_forecast_snapshots").upsert(rows, { onConflict: "week_start,sf_user_id" });
  if (error && !/perf_forecast_snapshots|schema cache|does not exist/i.test(error.message || "")) {
    throw new Error("forecast_snapshot_write_failed");
  }
}

async function upsertWeekSnapshots(client, quarterLabel, rows, signedByOwner, forecastByOwner) {
  if (!rows.length) return;
  const payload = rows.map((row) => ({
    week_start: row.week_start,
    sf_user_id: row.sf_user_id,
    iso_week: row.week,
    quarter: quarterLabel,
    calls: row.calls,
    meetings: row.meetings,
    proposals: row.proposals || 0,
    progressions: row.progressions || 0,
    call_results: row.call_results || {},
    generated_count: row.generated_count,
    generated_amount: row.generated_amount,
    won_count: row.won_count,
    won_amount: row.won_amount,
    won_catalogue: row.won_by_type?.catalogue || 0,
    won_sur_mesure: row.won_by_type?.sur_mesure || 0,
    won_conseil: row.won_by_type?.conseil || 0,
    won_arr_amount: row.won_arr_amount || 0,
    signed_to_date: signedByOwner?.get(row.sf_user_id) || 0,
    forecast: forecastByOwner?.get(row.sf_user_id) || 0,
  }));
  const { error } = await client.from("perf_week_snapshots").upsert(payload, { onConflict: "week_start,sf_user_id" });
  if (error && !/perf_week_snapshots|schema cache|does not exist/i.test(error.message || "")) {
    throw new Error("week_snapshot_write_failed");
  }
}

async function loadPeriodHistory(client) {
  const { data, error } = await client
    .from("perf_week_snapshots")
    .select("week_start, iso_week, quarter")
    .order("week_start", { ascending: false })
    .limit(520);
  if (error) {
    if (/perf_week_snapshots|schema cache|does not exist/i.test(error.message || "")) return { weeks: [], quarters: [] };
    throw new Error("period_history_lookup_failed");
  }
  const weeks = [];
  const seen = new Set();
  const quarterSet = new Set();
  const today = dateKey();
  const currentMonday = mondayFor(today);
  for (const row of data || []) {
    if (!row.week_start || row.week_start > currentMonday) continue;
    if (seen.has(row.week_start)) continue;
    seen.add(row.week_start);
    weeks.push({ week_start: row.week_start, iso_week: row.iso_week, quarter: row.quarter });
    if (row.quarter) quarterSet.add(row.quarter);
  }
  return { weeks, quarters: [...quarterSet] };
}

async function loadWeekSnapshotRows(client, weekStarts) {
  if (!weekStarts.length) return [];
  const { data, error } = await client
    .from("perf_week_snapshots")
    .select("week_start, sf_user_id, iso_week, quarter, calls, meetings, proposals, progressions, call_results, generated_count, generated_amount, won_count, won_amount, won_catalogue, won_sur_mesure, won_conseil, won_arr_amount, signed_to_date, forecast")
    .in("week_start", weekStarts);
  if (error) {
    if (/perf_week_snapshots|schema cache|does not exist/i.test(error.message || "")) return null;
    throw new Error("week_snapshot_lookup_failed");
  }
  return data || [];
}

async function tryHistoricalSnapshotResponse({
  client, profile, teamView, empty, window, quarter, priorQuarter, weekIndex, quarterStarts, effectiveDate, today, resolvedPeriod,
}) {
  const currentMonday = mondayFor(effectiveDate);
  const liveMonday = mondayFor(today);
  if (currentMonday >= liveMonday) return null;

  const starts = window.starts;
  const [snapRows, profiles, targets, trackingOverrides, periodHistory] = await Promise.all([
    loadWeekSnapshotRows(client, starts),
    teamProfiles(client),
    settingsValue(client, "weekly_targets"),
    settingsValue(client, "weekly_tracking"),
    loadPeriodHistory(client),
  ]);
  if (snapRows === null) return null;
  if (!snapRows.some((row) => row.week_start === currentMonday)) return null;
  if (resolvedPeriod === "quarter") {
    const covered = new Set(snapRows.map((row) => row.week_start));
    if (covered.size < Math.min(3, starts.length || 3)) return null;
  }
  if (!profiles) return null;

  let ownerIds = [...new Set(snapRows.map((row) => row.sf_user_id).filter(Boolean))];
  if (!teamView) ownerIds = profile.sfUserId ? [profile.sfUserId] : [];
  ownerIds = ownerIds.filter((id) => {
    const mapped = findBySfId(profiles, id);
    return !isWeeklyOwnerExcluded(null, mapped?.full_name || "", mapped?.email || "");
  });
  if (!teamView && profile.sfUserId && !ownerIds.some((id) => sfIdKey(id) === sfIdKey(profile.sfUserId))) {
    ownerIds.push(profile.sfUserId);
  }
  if (!ownerIds.length) return null;

  const byKey = new Map(snapRows.map((row) => [`${sfIdKey(row.sf_user_id)}:${row.week_start}`, row]));
  const pulse = [];
  const pipeline = [];
  const effort = [];
  for (const owner of ownerIds) {
    for (const start of starts) {
      const snap = byKey.get(`${sfIdKey(owner)}:${start}`);
      const week = snap?.iso_week || isoWeek(start);
      const generatedCount = number(snap?.generated_count);
      const generatedAmount = number(snap?.generated_amount);
      const wonCount = number(snap?.won_count);
      const wonAmount = number(snap?.won_amount);
      pulse.push({
        sf_user_id: owner,
        week,
        week_start: start,
        calls: number(snap?.calls),
        meetings: number(snap?.meetings),
        proposals: number(snap?.proposals),
        call_results: snap?.call_results && typeof snap.call_results === "object" ? snap.call_results : emptyCallResults(),
      });
      pipeline.push({
        sf_user_id: owner,
        week,
        week_start: start,
        generated_count: generatedCount,
        generated_amount: generatedAmount,
        won_count: wonCount,
        won_amount: wonAmount,
        won_by_type: {
          catalogue: number(snap?.won_catalogue),
          sur_mesure: number(snap?.won_sur_mesure),
          conseil: number(snap?.won_conseil),
        },
        won_arr_amount: number(snap?.won_arr_amount),
        closing_rate_count: generatedCount ? wonCount / generatedCount : null,
        closing_rate_amount: generatedAmount ? wonAmount / generatedAmount : null,
      });
      effort.push({
        sf_user_id: owner,
        week,
        week_start: start,
        progressions: number(snap?.progressions),
        open_opps_at_start: 0,
        effort_rate: null,
      });
    }
  }

  const quarterRows = ownerIds.map((owner) => {
    const snap = byKey.get(`${sfIdKey(owner)}:${currentMonday}`);
    const targetEntry = Object.entries(targets || {}).find(([id]) => sfIdKey(id) === sfIdKey(owner))?.[1];
    const target = targetEntry == null || targetEntry === "" ? null : number(targetEntry);
    const signedToDate = number(snap?.signed_to_date);
    const forecast = number(snap?.forecast);
    const expected = target === null ? null : target * ((weekIndex + 1) / Math.max(quarterStarts.length, weekIndex + 1));
    return {
      sf_user_id: owner,
      quarter: quarter.label,
      signed_to_date: signedToDate,
      weighted_open: 0,
      forecast,
      custom_pipe: 0,
      target,
      signed_n1: 0,
      pace_ratio: expected && expected > 0 ? signedToDate / expected : null,
      expected_to_date: expected,
      monthly_indicative: [],
    };
  });

  const forecastHistory = ownerIds.flatMap((owner) => starts.map((start) => {
    const snap = byKey.get(`${sfIdKey(owner)}:${start}`);
    return {
      sf_user_id: owner,
      week_start: start,
      week: snap?.iso_week || isoWeek(start),
      forecast: snap ? number(snap.forecast) : null,
      signed_to_date: number(snap?.signed_to_date),
    };
  }));

  const paceTarget = quarterRows.map((row) => row.target).filter((value) => value !== null);
  const targetSum = paceTarget.length ? paceTarget.reduce((sum, value) => sum + value, 0) : null;
  const pace = buildPace({
    signed: quarterRows.reduce((sum, row) => sum + row.signed_to_date, 0),
    forecast: quarterRows.reduce((sum, row) => sum + row.forecast, 0),
    target: targetSum,
    signedN1: 0,
    weekOfQuarter: weekIndex + 1,
    weeksInQuarter: Math.max(quarterStarts.length, weekIndex + 1),
    wonCount: 0,
    expectedToDate: targetSum === null ? null : targetSum * ((weekIndex + 1) / Math.max(quarterStarts.length, weekIndex + 1)),
  });

  const compareWeekStart = window.starts.length > 1 ? window.starts[window.starts.length - 2] : null;
  const context = {
    iso_week: isoWeek(currentMonday),
    quarter_label: quarter.label,
    week_of_quarter: weekIndex + 1,
    weeks_in_quarter: Math.max(quarterStarts.length, weekIndex + 1),
    compare_week: compareWeekStart ? isoWeek(compareWeekStart) : null,
    prior_quarter_label: priorQuarter.label,
    anchor_week_start: currentMonday,
    live_week_start: liveMonday,
    live_iso_week: isoWeek(liveMonday),
    source: "snapshot",
    lite: false,
    timing_ms: null,
  };

  return json(200, {
    ...empty,
    owners: ownerIds.map((id) => ownerMeta(
      profiles,
      [],
      id,
      id === profile.sfUserId || sfIdKey(id) === sfIdKey(profile.sfUserId) ? { name: profile.fullName, role: profile.role } : {},
      trackingOverrides,
    )),
    pulse,
    pipeline,
    prior_pulse: [],
    prior_pipeline: [],
    effort,
    quarter: quarterRows,
    forecast_history: forecastHistory,
    custom_pipe: empty.custom_pipe,
    follow_up_opps: [],
    stagnant_opps: [],
    pace: { ...pace, monthly_indicative: [] },
    seasonality: null,
    period_history: periodHistory,
    context,
    week_meta: starts.map((start) => ({ week_start: start, iso_week: isoWeek(start) })),
    quarter_bounds: { from: quarter.from, to: addDays(quarter.toExclusive, -1), label: quarter.label },
  });
}

function aggregateWeeklyRows({
  ownerIds, starts, allowed, tasks, events, histories, generated, won, wonArr,
  task, event, opportunity, opportunityHistory, saleTypeValues, baselineStages,
}) {
  const data = new Map();
  const startSet = new Set(starts);
  const row = (owner, start) => {
    const key = `${owner}:${start}`;
    if (!data.has(key)) {
      data.set(key, {
        sf_user_id: owner, week: isoWeek(start), week_start: start, calls: 0, meetings: 0, proposals: 0,
        generated_count: 0, generated_amount: 0, won_count: 0, won_amount: 0,
        won_by_type: { catalogue: 0, sur_mesure: 0, conseil: 0 }, won_arr_amount: 0, progressions: 0,
        call_results: emptyCallResults(),
      });
    }
    return data.get(key);
  };
  for (const owner of ownerIds) for (const start of starts) row(owner, start);
  const inWindow = (record, ownerField, dateField, callback) => {
    const owner = record[ownerField];
    const start = mondayFor(dateKey(record[dateField]));
    if (allowed(owner) && startSet.has(start)) callback(row(owner, start));
  };
  for (const record of tasks) if (record[task.fields.subtype] === task.subtypeValue) inWindow(record, task.fields.ownerId, task.fields.activityDate, (target) => {
    target.calls += 1;
    const label = record[task.fields.result] || "Non renseigné";
    target.call_results[label] = (target.call_results[label] || 0) + 1;
  });
  for (const record of events) inWindow(record, event.fields.ownerId, event.fields.activityDate, (target) => { target.meetings += 1; });
  for (const record of histories) if (record[opportunityHistory.fields.stageName] === opportunityHistory.stages.proposalSent) inWindow(record, opportunityHistory.fields.createdById, opportunityHistory.fields.createdDate, (target) => { target.proposals += 1; });
  for (const record of generated) inWindow(record, opportunity.fields.ownerId, opportunity.fields.createdDate, (target) => { target.generated_count += 1; target.generated_amount += number(record[opportunity.fields.amount]); });
  for (const record of won) inWindow(record, opportunity.fields.ownerId, opportunity.fields.closeDate, (target) => {
    const amount = number(record[opportunity.fields.amount]);
    const saleType = Object.entries(saleTypeValues).find(([, values]) => values.includes(record[opportunity.saleTypeField]))?.[0];
    target.won_count += 1;
    target.won_amount += amount;
    if (saleType) target.won_by_type[saleType] += amount;
  });
  for (const record of wonArr) inWindow(record, opportunity.fields.ownerId, opportunity.fields.closeDate, (target) => { target.won_arr_amount += number(record[opportunity.fields.amount]); });
  const previousStages = new Map(baselineStages);
  const progressed = new Set();
  for (const record of histories) {
    const opportunityId = record[opportunityHistory.fields.opportunityId];
    const stage = record[opportunityHistory.fields.stageName];
    const previous = previousStages.get(opportunityId);
    previousStages.set(opportunityId, stage);
    const start = mondayFor(dateKey(record[opportunityHistory.fields.createdDate]));
    const progressionKey = `${opportunityId}:${start}`;
    if (previous && opportunityHistory.stageOrder[stage] > opportunityHistory.stageOrder[previous] && !progressed.has(progressionKey)) {
      inWindow(record, opportunityHistory.fields.createdById, opportunityHistory.fields.createdDate, (target) => { target.progressions += 1; });
      progressed.add(progressionKey);
    }
  }
  return [...data.values()];
}

export async function GET(request) {
  const startedAt = Date.now();
  const user = await verifyJWT(request);
  if (!user) return json(401, { error: "unauthorized" });
  const url = new URL(request.url);
  const rawPeriod = url.searchParams.get("period");
  const period = rawPeriod === "quarter" ? "quarter" : rawPeriod === "week" ? "week" : null;
  const rawWeeks = url.searchParams.get("weeks");
  const weeks = rawWeeks === null ? 2 : Number(rawWeeks);
  const lite = url.searchParams.get("lite") === "1" || url.searchParams.get("lite") === "true";
  // period=week → 2 semaines (S + S−1) ; period=quarter → trimestre fiscal ; weeks=N reste supporté pour tests.
  if (period === null && (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS)) return json(400, { error: "invalid_weeks" });

  const client = getServiceClient();
  if (!client) return json(500, { error: "service_unavailable" });
  const profile = await getProfile(client, user.id);
  if (profile.error) return json(500, { error: profile.error });
  const teamView = canViewTeamPerf(profile.role);
  const anchorWeekStart = url.searchParams.get("week_start");
  const today = dateKey();
  const effectiveDate = anchorWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(anchorWeekStart)
    ? addDays(mondayFor(anchorWeekStart), 6)
    : today;
  const quarter = fiscalQuarter(effectiveDate);
  const resolvedPeriod = period || (rawWeeks !== null ? "weeks" : "week");
  const window = resolvedPeriod === "quarter"
    ? quarterWeekWindow(effectiveDate)
    : anchorWeekStart
      ? weekWindowAnchored(anchorWeekStart, resolvedPeriod === "week" ? 2 : weeks)
      : weekWindow(resolvedPeriod === "week" ? 2 : weeks);
  const empty = {
    weeks: window.starts.length,
    period: resolvedPeriod === "weeks" ? "week" : resolvedPeriod,
    timezone: TIMEZONE,
    range: { from: window.from, to: window.to },
    view: teamView ? "team" : "self",
    owners: [],
    pulse: [],
    pipeline: [],
    prior_pulse: [],
    prior_pipeline: [],
    effort: [],
    quarter: [],
    forecast_history: [],
    period_history: { weeks: [], quarters: [] },
    context: null,
    week_meta: [],
    custom_pipe: { horizon_days: 180, total_amount: 0, total_expected: 0, count: 0, months: [], by_owner: [], opps: [] },
    follow_up_opps: [],
    stagnant_opps: [],
    pace: null,
    seasonality: null,
    quarter_bounds: { from: quarter.from, to: addDays(quarter.toExclusive, -1), label: quarter.label },
  };
  if (!teamView && !profile.sfUserId) return json(200, { ...empty, warning: "sf_user_unmapped" });

  const priorQuarter = priorFiscalQuarter(effectiveDate);
  const quarterStarts = fiscalQuarterWeekStarts(quarter);
  const priorStarts = fiscalQuarterWeekStarts(priorQuarter);
  const weekIndex = weekOfQuarterIndex(quarterStarts, effectiveDate);

  const liveMondayEarly = mondayFor(today);
  const currentMondayEarly = mondayFor(effectiveDate);
  if (currentMondayEarly < liveMondayEarly) {
    try {
      const snapshotResponse = await tryHistoricalSnapshotResponse({
        client,
        profile,
        teamView,
        empty,
        window,
        quarter,
        priorQuarter,
        weekIndex,
        quarterStarts,
        effectiveDate,
        today,
        resolvedPeriod,
      });
      if (snapshotResponse) {
        const body = await snapshotResponse.json();
        if (body?.context) {
          body.context.timing_ms = Date.now() - startedAt;
          body.context.lite = false;
          body.context.source = body.context.source || "snapshot";
        }
        return json(200, body);
      }
    } catch {
      // Fallback Salesforce si snapshots incomplets / indisponibles.
    }
  }

  const tokenResult = await fetchSFToken();
  if (tokenResult.error || !tokenResult.accessToken) return json(502, { error: tokenResult.error || "sf_auth_error" });
  const { task, event, opportunity, opportunityHistory, user: sfUserObject } = mapping.objects;
  // SOQL : les littéraux date (YYYY-MM-DD) et datetime (ISO Z) ne se quotent PAS —
  // quotés, Salesforce répond MALFORMED_QUERY (vérifié live sur l'org).
  const fromDate = window.from;
  const toDate = window.toExclusive;
  const fromDateTime = `${window.from}T00:00:00Z`;
  const toDateTime = `${window.toExclusive}T00:00:00Z`;
  const customToExclusive = addDays(today, 181);
  const saleTypeValues = opportunity.saleTypes;
  const arrWhere = `${opportunity.saleTypeField} = '${escapeSOQL(saleTypeValues.catalogue[0])}' AND ${opportunity.commissionTypeField} IN (${opportunity.arrCommissionTypes.map((value) => `'${escapeSOQL(value)}'`).join(", ")})`;
  const openOppFields = [
    opportunity.fields.id, opportunity.fields.name, opportunity.fields.ownerId, opportunity.fields.isClosed, opportunity.fields.stageName,
    opportunity.fields.amount, opportunity.fields.probability, opportunity.fields.expectedRevenue, opportunity.fields.closeDate,
    opportunity.fields.createdDate, opportunity.fields.lastActivityDate, opportunity.fields.lastStageChangeDate,
    "Account.Name",
  ];
  const quarterOpenFields = [
    opportunity.fields.id, opportunity.fields.name, opportunity.fields.ownerId, opportunity.fields.closeDate,
    opportunity.fields.amount, opportunity.fields.probability, opportunity.fields.expectedRevenue, opportunity.fields.stageName,
    "Account.Name",
  ];
  const seasonalityFrom = addDays(quarter.from, -365 * 3);

  // Roster d’abord → scoper les SOQL (surtout openOpps) au lieu de tirer toute l’org.
  const [profilesEarly, targetsEarly, trackingEarly] = await Promise.all([
    teamView ? teamProfiles(client) : Promise.resolve([]),
    settingsValue(client, "weekly_targets"),
    settingsValue(client, "weekly_tracking").catch(() => ({})),
  ]);
  if (teamView && profilesEarly === null) return json(500, { error: "team_lookup_failed" });
  const scopeOwnerIds = teamView
    ? [...new Set((profilesEarly || []).map((row) => row.sf_user_id).filter(Boolean))]
    : (profile.sfUserId ? [profile.sfUserId] : []);
  const byOwner = (field) => ownerInClause(field, scopeOwnerIds);

  try {
    const [tasks, events, histories, generated, won, wonArr, openOpps, quarterWon, quarterOpen, customOpen, priorQuarterWon, seasonalityRows] = await Promise.all([
      crmRecords(tokenResult.accessToken, query(task.name, [task.fields.ownerId, task.fields.activityDate, task.fields.subtype, task.fields.result], `${task.fields.subtype} = '${task.subtypeValue}' AND ${task.fields.activityDate} >= ${fromDate} AND ${task.fields.activityDate} < ${toDate}${byOwner(task.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(event.name, [event.fields.ownerId, event.fields.activityDate], `${event.fields.activityDate} >= ${fromDate} AND ${event.fields.activityDate} < ${toDate}${byOwner(event.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunityHistory.name, [opportunityHistory.fields.opportunityId, opportunityHistory.fields.stageName, opportunityHistory.fields.createdDate, opportunityHistory.fields.createdById], `${opportunityHistory.fields.createdDate} >= ${fromDateTime} AND ${opportunityHistory.fields.createdDate} < ${toDateTime}${byOwner(opportunityHistory.fields.createdById)}`, `${opportunityHistory.fields.opportunityId}, ${opportunityHistory.fields.createdDate}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.createdDate, opportunity.fields.amount], `${opportunity.fields.createdDate} >= ${fromDateTime} AND ${opportunity.fields.createdDate} < ${toDateTime}${byOwner(opportunity.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount, opportunity.saleTypeField, opportunity.commissionTypeField], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${fromDate} AND ${opportunity.fields.closeDate} < ${toDate}${byOwner(opportunity.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount, opportunity.saleTypeField, opportunity.commissionTypeField], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${fromDate} AND ${opportunity.fields.closeDate} < ${toDate} AND ${arrWhere}${byOwner(opportunity.fields.ownerId)}`)),
      lite
        ? Promise.resolve([])
        : crmRecords(tokenResult.accessToken, query(opportunity.name, openOppFields, `${opportunity.fields.isClosed} = false AND ${opportunity.fields.stageName} != '${opportunityHistory.stages.stalledSuspect}'${byOwner(opportunity.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${quarter.from} AND ${opportunity.fields.closeDate} < ${quarter.toExclusive}${byOwner(opportunity.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, quarterOpenFields, `${opportunity.fields.isClosed} = false AND ${opportunity.fields.closeDate} >= ${quarter.from} AND ${opportunity.fields.closeDate} < ${quarter.toExclusive}${byOwner(opportunity.fields.ownerId)}`)),
      lite
        ? Promise.resolve([])
        : crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.id, opportunity.fields.name, opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount, opportunity.fields.probability, opportunity.fields.expectedRevenue, opportunity.saleTypeField], `${opportunity.fields.isClosed} = false AND ${opportunity.saleTypeField} = '${escapeSOQL(saleTypeValues.sur_mesure[0])}' AND ${opportunity.fields.closeDate} >= ${today} AND ${opportunity.fields.closeDate} < ${customToExclusive}${byOwner(opportunity.fields.ownerId)}`)),
      crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${priorQuarter.from} AND ${opportunity.fields.closeDate} < ${priorQuarter.toExclusive}${byOwner(opportunity.fields.ownerId)}`)),
      lite || resolvedPeriod === "week"
        ? Promise.resolve([])
        : crmRecords(tokenResult.accessToken, `SELECT CALENDAR_YEAR(${opportunity.fields.closeDate}) yearNum, CALENDAR_MONTH(${opportunity.fields.closeDate}) monthNum, SUM(${opportunity.fields.amount}) totalAmount FROM ${opportunity.name} WHERE ${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${seasonalityFrom} AND ${opportunity.fields.closeDate} < ${today} GROUP BY CALENDAR_YEAR(${opportunity.fields.closeDate}), CALENDAR_MONTH(${opportunity.fields.closeDate})`).catch(() => []),
    ]);
    const profiles = profilesEarly || [];
    const targets = targetsEarly || {};
    const trackingOverrides = trackingEarly || {};

    // Étape de départ des opps vues dans la fenêtre : dernière ligne d'historique
    // pré-fenêtre par opp, sinon la première transition de la fenêtre serait ignorée.
    const windowOppIds = [...new Set(histories.map((record) => record[opportunityHistory.fields.opportunityId]).filter(Boolean))];
    const baselineStages = new Map();
    const baselineChunks = [];
    for (let index = 0; index < windowOppIds.length; index += 200) baselineChunks.push(windowOppIds.slice(index, index + 200));
    const baselineResults = await Promise.all(baselineChunks.map((chunk) => crmRecords(tokenResult.accessToken, query(
      opportunityHistory.name,
      [opportunityHistory.fields.opportunityId, opportunityHistory.fields.stageName],
      `${opportunityHistory.fields.opportunityId} IN (${chunk.map((id) => `'${escapeSOQL(id)}'`).join(", ")}) AND ${opportunityHistory.fields.createdDate} < ${fromDateTime}`,
      `${opportunityHistory.fields.opportunityId}, ${opportunityHistory.fields.createdDate}`,
    ))));
    for (const rows of baselineResults) {
      for (const row of rows) baselineStages.set(row[opportunityHistory.fields.opportunityId], row[opportunityHistory.fields.stageName]);
    }

    const owners = new Set(scopeOwnerIds);
    if (!teamView && profile.sfUserId) {
      owners.clear();
      owners.add(profile.sfUserId);
    }
    const candidateOwnerIds = [...owners];

    const sfUsers = candidateOwnerIds.length
      ? await crmRecords(
        tokenResult.accessToken,
        query(
          sfUserObject.name,
          [sfUserObject.fields.id, sfUserObject.fields.name, sfUserObject.fields.email, sfUserObject.fields.isActive],
          `${sfUserObject.fields.id} IN (${candidateOwnerIds.map((id) => `'${escapeSOQL(id)}'`).join(", ")})`,
        ),
      )
      : [];

    const activeOwnerIds = candidateOwnerIds.filter((id) => {
      const sfUser = findBySfId(sfUsers, id);
      const mapped = findBySfId(profiles, id);
      return !isWeeklyOwnerExcluded(sfUser, mapped?.full_name || sfUser?.Name || "", mapped?.email || sfUser?.Email || "");
    });
    if (!teamView && profile.sfUserId && !activeOwnerIds.some((id) => sfIdKey(id) === sfIdKey(profile.sfUserId))) {
      activeOwnerIds.push(profile.sfUserId);
    }
    owners.clear();
    for (const id of activeOwnerIds) owners.add(id);
    const allowedIds = new Set([...owners].map((id) => sfIdKey(id)));
    const allowed = (id) => allowedIds.has(sfIdKey(id));
    const ownerIds = [...owners];

    const openByOwner = new Map();
    for (const record of openOpps) {
      if (allowed(record[opportunity.fields.ownerId]) && !record[opportunity.fields.isClosed] && record[opportunity.fields.stageName] !== opportunityHistory.stages.stalledSuspect) {
        const owner = record[opportunity.fields.ownerId];
        openByOwner.set(owner, (openByOwner.get(owner) || 0) + 1);
      }
    }
    const rows = aggregateWeeklyRows({
      ownerIds,
      starts: window.starts,
      allowed,
      tasks,
      events,
      histories,
      generated,
      won,
      wonArr,
      task,
      event,
      opportunity,
      opportunityHistory,
      saleTypeValues,
      baselineStages,
    });
    const signedByOwner = new Map();
    const openQuarterByOwner = new Map();
    const customByOwner = new Map();
    for (const record of quarterWon) {
      const owner = record[opportunity.fields.ownerId];
      if (allowed(owner)) signedByOwner.set(owner, (signedByOwner.get(owner) || 0) + number(record[opportunity.fields.amount]));
    }
    for (const record of quarterOpen) {
      const owner = record[opportunity.fields.ownerId];
      if (allowed(owner)) openQuarterByOwner.set(owner, [...(openQuarterByOwner.get(owner) || []), record]);
    }
    for (const record of customOpen) {
      const owner = record[opportunity.fields.ownerId];
      if (allowed(owner)) customByOwner.set(owner, (customByOwner.get(owner) || 0) + number(record[opportunity.fields.amount]));
    }

    const customPipe = lite ? empty.custom_pipe : buildCustomPipe(customOpen, opportunity.fields, effectiveDate, owners);
    const followUpOpps = lite ? [] : buildFollowUpOpps(quarterOpen, opportunity.fields, owners);
    const stagnantOpps = lite ? [] : buildStagnantOpps(openOpps, opportunity.fields, owners, effectiveDate, opportunityHistory.stages.stalledSuspect, {
      quarterFrom: quarter.from,
      quarterToExclusive: quarter.toExclusive,
    });

    // Saisonnalité = agrégat 3 ans : utile pour le pace trimestre, skip en vue semaine.
    const seasonality = lite || resolvedPeriod === "week" ? null : buildSeasonality(
      (Array.isArray(seasonalityRows) ? seasonalityRows : []).map((row) => ({
        year: Number(row.yearNum ?? row.expr0),
        month: Number(row.monthNum ?? row.expr1),
        amount: Number(row.totalAmount ?? row.expr2) || 0,
      })),
      effectiveDate,
    );

    let priorPulse = [];
    let priorPipeline = [];
    if (!lite && resolvedPeriod === "quarter" && priorStarts.length) {
      const priorWeekStarts = priorStarts.slice(0, Math.min(weekIndex + 1, priorStarts.length));
      if (priorWeekStarts.length) {
        const pFrom = priorWeekStarts[0];
        const pToEx = addDays(priorWeekStarts[priorWeekStarts.length - 1], 7);
        const pFromDt = `${pFrom}T00:00:00Z`;
        const pToDt = `${pToEx}T00:00:00Z`;
        const [pTasks, pEvents, pHistories, pGenerated, pWon, pWonArr] = await Promise.all([
          crmRecords(tokenResult.accessToken, query(task.name, [task.fields.ownerId, task.fields.activityDate, task.fields.subtype, task.fields.result], `${task.fields.subtype} = '${task.subtypeValue}' AND ${task.fields.activityDate} >= ${pFrom} AND ${task.fields.activityDate} < ${pToEx}${byOwner(task.fields.ownerId)}`)),
          crmRecords(tokenResult.accessToken, query(event.name, [event.fields.ownerId, event.fields.activityDate], `${event.fields.activityDate} >= ${pFrom} AND ${event.fields.activityDate} < ${pToEx}${byOwner(event.fields.ownerId)}`)),
          crmRecords(tokenResult.accessToken, query(opportunityHistory.name, [opportunityHistory.fields.opportunityId, opportunityHistory.fields.stageName, opportunityHistory.fields.createdDate, opportunityHistory.fields.createdById], `${opportunityHistory.fields.createdDate} >= ${pFromDt} AND ${opportunityHistory.fields.createdDate} < ${pToDt}${byOwner(opportunityHistory.fields.createdById)}`, `${opportunityHistory.fields.opportunityId}, ${opportunityHistory.fields.createdDate}`)),
          crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.createdDate, opportunity.fields.amount], `${opportunity.fields.createdDate} >= ${pFromDt} AND ${opportunity.fields.createdDate} < ${pToDt}${byOwner(opportunity.fields.ownerId)}`)),
          crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount, opportunity.saleTypeField, opportunity.commissionTypeField], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${pFrom} AND ${opportunity.fields.closeDate} < ${pToEx}${byOwner(opportunity.fields.ownerId)}`)),
          crmRecords(tokenResult.accessToken, query(opportunity.name, [opportunity.fields.ownerId, opportunity.fields.closeDate, opportunity.fields.amount, opportunity.saleTypeField, opportunity.commissionTypeField], `${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${pFrom} AND ${opportunity.fields.closeDate} < ${pToEx} AND ${arrWhere}${byOwner(opportunity.fields.ownerId)}`)),
        ]);
        const priorRows = aggregateWeeklyRows({
          ownerIds,
          starts: priorWeekStarts,
          allowed,
          tasks: pTasks,
          events: pEvents,
          histories: pHistories,
          generated: pGenerated,
          won: pWon,
          wonArr: pWonArr,
          task,
          event,
          opportunity,
          opportunityHistory,
          saleTypeValues,
          baselineStages: new Map(),
        });
        priorPulse = priorRows.map(({ sf_user_id, week, week_start, calls, meetings, proposals, call_results }) => ({ sf_user_id, week, week_start, calls, meetings, proposals, call_results: call_results || emptyCallResults() }));
        priorPipeline = priorRows.map((entry) => ({
          sf_user_id: entry.sf_user_id,
          week: entry.week,
          week_start: entry.week_start,
          generated_count: entry.generated_count,
          generated_amount: entry.generated_amount,
          won_count: entry.won_count,
          won_amount: entry.won_amount,
          won_by_type: entry.won_by_type,
          won_arr_amount: entry.won_arr_amount,
          closing_rate_count: entry.generated_count ? entry.won_count / entry.generated_count : null,
          closing_rate_amount: entry.generated_amount ? entry.won_amount / entry.generated_amount : null,
        }));
      }
    }

    const quarterRows = ownerIds.map((owner) => {
      const signedToDate = signedByOwner.get(owner) || 0;
      const { weightedOpen, forecast } = quarterForecast(signedToDate, openQuarterByOwner.get(owner) || [], opportunity.fields);
      const targetEntry = Object.entries(targets || {}).find(([id]) => sfIdKey(id) === sfIdKey(owner))?.[1];
      const targetValue = targetEntry?.[quarter.label];
      const target = targetValue !== null && targetValue !== undefined && Number.isFinite(Number(targetValue)) ? Number(targetValue) : null;
      const priorSignedValues = priorStarts.length
        ? signedSeries(priorStarts, priorQuarterWon, opportunity.fields.ownerId, opportunity.fields.amount, opportunity.fields.closeDate, owner)
        : [];
      const signedN1 = priorSignedValues[Math.min(weekIndex, Math.max(0, priorSignedValues.length - 1))] ?? 0;
      const seasonalExpected = seasonalExpectedToDate(target, effectiveDate, quarter, seasonality);
      const linearExpected = target === null ? null : target * ((weekIndex + 1) / Math.max(quarterStarts.length, weekIndex + 1));
      const expected = seasonalExpected ?? linearExpected;
      const pace_ratio = expected && expected > 0 ? signedToDate / expected : null;
      return {
        sf_user_id: owner,
        quarter: quarter.label,
        signed_to_date: signedToDate,
        weighted_open: weightedOpen,
        forecast,
        custom_pipe: customByOwner.get(owner) || 0,
        target,
        signed_n1: signedN1,
        pace_ratio,
        expected_to_date: expected,
        monthly_indicative: target ? quarterlyToMonthlyIndicative(target, quarter.label, seasonality) : [],
      };
    });

    const currentMonday = mondayFor(effectiveDate);
    const isLive = effectiveDate === today;
    if (isLive) {
      const forecastByOwner = new Map(quarterRows.map((entry) => [entry.sf_user_id, entry.forecast]));
      void Promise.all([
        upsertForecastSnapshots(client, quarterRows.map((entry) => ({
          week_start: currentMonday,
          sf_user_id: entry.sf_user_id,
          quarter: quarter.label,
          forecast: entry.forecast,
          signed_to_date: entry.signed_to_date,
        }))),
        upsertWeekSnapshots(client, quarter.label, rows, signedByOwner, forecastByOwner),
      ]).catch(() => {});
    }

    const [storedHistory, periodHistory] = await Promise.all([
      loadForecastHistory(client, quarter.label, ownerIds),
      loadPeriodHistory(client),
    ]);
    const historyByOwnerWeek = new Map(storedHistory.map((entry) => [`${sfIdKey(entry.sf_user_id)}:${entry.week_start}`, entry]));
    const signedByOwnerWeek = new Map();
    for (const owner of ownerIds) {
      signedByOwnerWeek.set(owner, signedSeries(window.starts, quarterWon, opportunity.fields.ownerId, opportunity.fields.amount, opportunity.fields.closeDate, owner));
    }
    const forecastHistory = ownerIds.flatMap((owner) => window.starts.map((start, index) => {
      const stored = historyByOwnerWeek.get(`${sfIdKey(owner)}:${start}`);
      const signedValues = signedByOwnerWeek.get(owner) || [];
      const live = quarterRows.find((entry) => sfIdKey(entry.sf_user_id) === sfIdKey(owner));
      const isCurrent = start === currentMonday;
      return {
        sf_user_id: owner,
        week_start: start,
        week: isoWeek(start),
        forecast: isCurrent ? (live?.forecast ?? null) : (stored ? number(stored.forecast) : null),
        signed_to_date: isCurrent ? (live?.signed_to_date ?? signedValues[index]) : (stored ? number(stored.signed_to_date) : signedValues[index]),
      };
    }));

    const paceOwners = quarterRows;
    const paceTargets = paceOwners.map((row) => row.target).filter((value) => value !== null);
    const paceTarget = paceTargets.length ? paceTargets.reduce((sum, value) => sum + value, 0) : null;
    const seasonalExpected = seasonalExpectedToDate(paceTarget, effectiveDate, quarter, seasonality);
    const pace = buildPace({
      signed: paceOwners.reduce((sum, row) => sum + row.signed_to_date, 0),
      forecast: paceOwners.reduce((sum, row) => sum + row.forecast, 0),
      target: paceTarget,
      signedN1: paceOwners.reduce((sum, row) => sum + (row.signed_n1 || 0), 0),
      weekOfQuarter: weekIndex + 1,
      weeksInQuarter: Math.max(quarterStarts.length, weekIndex + 1),
      wonCount: quarterWon.filter((record) => allowed(record[opportunity.fields.ownerId])).length,
      expectedToDate: seasonalExpected,
    });
    const paceWithMonthly = {
      ...pace,
      monthly_indicative: paceTarget ? quarterlyToMonthlyIndicative(paceTarget, quarter.label, seasonality) : [],
    };

    const compareWeekStart = window.starts.length > 1 ? window.starts[window.starts.length - 2] : null;
    const liveMonday = mondayFor(today);
    const context = {
      iso_week: isoWeek(currentMonday),
      quarter_label: quarter.label,
      week_of_quarter: weekIndex + 1,
      weeks_in_quarter: Math.max(quarterStarts.length, weekIndex + 1),
      compare_week: compareWeekStart ? isoWeek(compareWeekStart) : null,
      prior_quarter_label: priorQuarter.label,
      anchor_week_start: currentMonday,
      live_week_start: liveMonday,
      live_iso_week: isoWeek(liveMonday),
      source: "live",
      lite,
      timing_ms: Date.now() - startedAt,
    };

    return json(200, {
      ...empty,
      owners: ownerIds.map((id) => ownerMeta(profiles, sfUsers, id, id === profile.sfUserId || sfIdKey(id) === sfIdKey(profile.sfUserId) ? { name: profile.fullName, role: profile.role } : {}, trackingOverrides)),
      pulse: rows.map(({ sf_user_id, week, week_start, calls, meetings, proposals, call_results }) => ({ sf_user_id, week, week_start, calls, meetings, proposals, call_results: call_results || emptyCallResults() })),
      pipeline: rows.map((entry) => ({ ...((({ sf_user_id, week, week_start, generated_count, generated_amount, won_count, won_amount, won_by_type, won_arr_amount }) => ({ sf_user_id, week, week_start, generated_count, generated_amount, won_count, won_amount, won_by_type, won_arr_amount }))(entry)), closing_rate_count: entry.generated_count ? entry.won_count / entry.generated_count : null, closing_rate_amount: entry.generated_amount ? entry.won_amount / entry.generated_amount : null })),
      prior_pulse: priorPulse,
      prior_pipeline: priorPipeline,
      effort: rows.map((entry) => { const open = openByOwner.get(entry.sf_user_id) || 0; return { sf_user_id: entry.sf_user_id, week: entry.week, week_start: entry.week_start, progressions: entry.progressions, open_opps_at_start: open, effort_rate: open ? entry.progressions / open : null }; }),
      quarter: quarterRows,
      forecast_history: forecastHistory,
      custom_pipe: customPipe,
      follow_up_opps: followUpOpps,
      stagnant_opps: stagnantOpps,
      pace: paceWithMonthly,
      seasonality,
      period_history: periodHistory,
      context,
      week_meta: window.starts.map((start) => ({ week_start: start, iso_week: isoWeek(start) })),
      quarter_bounds: { from: quarter.from, to: addDays(quarter.toExclusive, -1), label: quarter.label },
    });
  } catch (error) {
    return json(502, { error: error.message || "sf_query_error" });
  }
}
