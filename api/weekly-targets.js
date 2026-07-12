import { createClient } from "@supabase/supabase-js";
import { respond, verifyJWT } from "./_auth.js";
import { getProfile } from "./_calls/profileCache.js";
import { canManageSettings } from "./_config/access.js";
import { FISCAL_QUARTER_MONTHS, quarterlyToMonthlyIndicative } from "./_weekly/targets.js";
import { buildSeasonality, dateKey, fiscalQuarter } from "./perf.js";
import { fetchSFToken, searchContacts } from "./_crm/salesforce.js";
import mapping from "./_crm/mapping.js";

const TARGETS_KEY = "weekly_targets";

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function sfIdKey(id) {
  return String(id || "").slice(0, 15);
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function loadTargets(client) {
  const { data, error } = await client.from("settings").select("value").eq("key", TARGETS_KEY).maybeSingle();
  if (error) throw new Error("targets_lookup_failed");
  return data?.value && typeof data.value === "object" ? data.value : {};
}

async function saveTargets(client, value) {
  const { error } = await client.from("settings").upsert({ key: TARGETS_KEY, value }, { onConflict: "key" });
  if (error) throw new Error("targets_write_failed");
}

async function seasonalityFromSalesforce(quarter) {
  const tokenResult = await fetchSFToken();
  if (tokenResult.error || !tokenResult.accessToken) return null;
  const { opportunity } = mapping.objects;
  const today = dateKey();
  const seasonalityFrom = addDays(quarter.from, -365 * 3);
  const soql = `SELECT CALENDAR_YEAR(${opportunity.fields.closeDate}) yearNum, CALENDAR_MONTH(${opportunity.fields.closeDate}) monthNum, SUM(${opportunity.fields.amount}) totalAmount FROM ${opportunity.name} WHERE ${opportunity.fields.isWon} = true AND ${opportunity.fields.closeDate} >= ${seasonalityFrom} AND ${opportunity.fields.closeDate} < ${today} GROUP BY CALENDAR_YEAR(${opportunity.fields.closeDate}), CALENDAR_MONTH(${opportunity.fields.closeDate})`;
  const result = await searchContacts(tokenResult.accessToken, soql);
  if (result.error) return null;
  return buildSeasonality(
    (result.records || []).map((row) => ({
      year: row.yearNum,
      month: row.monthNum,
      amount: Number(row.totalAmount) || 0,
    })),
    today,
  );
}

function sellerProfiles(profiles) {
  return (profiles || [])
    .filter((row) => row.sf_user_id && row.role !== "admin")
    .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", "fr"));
}

function targetForOwner(targets, sfUserId, quarterLabel) {
  const entry = Object.entries(targets || {}).find(([id]) => sfIdKey(id) === sfIdKey(sfUserId))?.[1];
  const raw = entry?.[quarterLabel];
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

async function managerContext(request) {
  const user = await verifyJWT(request);
  if (!user) return { response: respond(401, { error: "unauthorized" }) };
  const client = serviceClient();
  if (!client) return { response: respond(500, { error: "service_unavailable" }) };
  const profile = await getProfile(client, user.id);
  if (profile.error) return { response: respond(500, { error: profile.error }) };
  if (!canManageSettings(profile.role)) return { response: respond(403, { error: "forbidden" }) };
  return { client, profile };
}

export async function GET(request) {
  const context = await managerContext(request);
  if (context.response) return context.response;

  const today = dateKey();
  const quarter = fiscalQuarter(today);
  const [targets, profiles, seasonality] = await Promise.all([
    loadTargets(context.client),
    context.client.from("profiles").select("id, email, full_name, sf_user_id, role").order("full_name"),
    seasonalityFromSalesforce(quarter),
  ]);
  if (profiles.error) return respond(500, { error: "profiles_lookup_failed" });

  const sellers = sellerProfiles(profiles.data);
  const qMatch = /Q([1-4])$/.exec(quarter.label || "");
  const qKey = qMatch ? `Q${qMatch[1]}` : null;
  const monthTemplate = qKey && FISCAL_QUARTER_MONTHS[qKey]
    ? FISCAL_QUARTER_MONTHS[qKey].map((month) => ({
      month,
      weight: seasonality?.month_in_quarter?.[qKey]?.[month] ?? 1 / FISCAL_QUARTER_MONTHS[qKey].length,
    }))
    : [];

  const rows = sellers.map((person) => {
    const quarterly = targetForOwner(targets, person.sf_user_id, quarter.label);
    return {
      sf_user_id: person.sf_user_id,
      name: person.full_name || person.email?.split("@")[0] || person.sf_user_id,
      email: person.email,
      role: person.role,
      quarterly_target: quarterly,
      monthly_indicative: quarterly ? quarterlyToMonthlyIndicative(quarterly, quarter.label, seasonality) : [],
    };
  });

  return respond(200, {
    quarter: { label: quarter.label, from: quarter.from, to: quarter.toExclusive },
    seasonality: seasonality ? { as_of: seasonality.as_of, sample_years: seasonality.sample_years } : null,
    month_template: monthTemplate,
    rows,
    targets,
  });
}

export async function POST(request) {
  const context = await managerContext(request);
  if (context.response) return context.response;

  let body;
  try { body = await request.json(); } catch { return respond(400, { error: "invalid_json" }); }

  const quarterLabel = typeof body.quarter === "string" ? body.quarter.trim() : null;
  const values = body.values;
  if (!quarterLabel || !values || typeof values !== "object" || Array.isArray(values)) {
    return respond(400, { error: "invalid_payload" });
  }

  const targets = await loadTargets(context.client);
  for (const [sfUserId, raw] of Object.entries(values)) {
    if (!sfUserId || typeof sfUserId !== "string") continue;
    const key = sfIdKey(sfUserId);
    const existing = Object.entries(targets).find(([id]) => sfIdKey(id) === key)?.[1] || {};
    const parsed = raw === null || raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      return respond(400, { error: "invalid_target_value", sf_user_id: sfUserId });
    }
    const merged = { ...existing, [quarterLabel]: parsed };
    const storedKey = Object.keys(targets).find((id) => sfIdKey(id) === key) || sfUserId;
    targets[storedKey] = merged;
  }

  await saveTargets(context.client, targets);
  return respond(200, { ok: true });
}
