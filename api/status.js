import { createClient } from "@supabase/supabase-js";
import { respond, verifyJWT } from "./_auth.js";
import { getProfile, invalidateProfileCache } from "./_calls/profileCache.js";
import { canManageRoles, canManageSettings, ROLES } from "./_config/access.js";
import { fetchSFToken } from "./_crm/salesforce.js";

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function instanceUrl() {
  return process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com";
}

async function fetchSalesforceStatus() {
  try {
    const token = await fetchSFToken();
    if (token.error || !token.accessToken) return { connected: false, dailyApiRequests: null };
    const response = await fetch(`${instanceUrl()}/services/data/v67.0/limits`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { connected: false, dailyApiRequests: null };
    const limits = await response.json();
    const daily = limits.DailyApiRequests;
    return {
      connected: true,
      dailyApiRequests: daily ? { max: daily.Max, remaining: daily.Remaining } : null,
    };
  } catch {
    return { connected: false, dailyApiRequests: null };
  }
}

async function fetchCleanerCache(request) {
  try {
    // /api/version est derrière le middleware legacy : on forwarde le cookie du navigateur.
    const response = await fetch(new URL("/api/version", request.url), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { version: null };
    const { version } = await response.json();
    return { version: typeof version === "string" ? version : null };
  } catch {
    return { version: null };
  }
}

async function profileForUser(client, user) {
  const profile = await getProfile(client, user.id);
  if (profile.error) return profile;
  return { ...profile, role: ROLES.includes(profile.role) ? profile.role : "commercial" };
}

async function listSettings(client) {
  const { data, error } = await client.from("settings").select("id, key, value, updated_at").order("key");
  return error ? null : data || [];
}

async function listProfiles(client) {
  const { data, error } = await client.from("profiles").select("id, email, full_name, sf_user_id, role").order("email");
  return error ? null : data || [];
}

export async function GET(request) {
  const user = await verifyJWT(request);
  if (!user) return respond(401, { error: "unauthorized" });
  const client = getServiceClient();
  if (!client) return respond(500, { error: "service_unavailable" });
  const profile = await profileForUser(client, user);
  if (profile.error) return respond(500, { error: profile.error });

  const [salesforce, cleaner, settings, profiles] = await Promise.all([
    fetchSalesforceStatus(),
    fetchCleanerCache(request),
    canManageSettings(profile.role) ? listSettings(client) : Promise.resolve(undefined),
    canManageSettings(profile.role) ? listProfiles(client) : Promise.resolve(undefined),
  ]);
  return respond(200, {
    role: profile.role,
    capabilities: {
      manageSettings: canManageSettings(profile.role),
      manageRoles: canManageRoles(profile.role),
    },
    profile: { email: user.email || null, fullName: profile.fullName, sfUserId: profile.sfUserId },
    salesforce,
    cache: { cleaner },
    version: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
    ...(settings !== undefined ? { settings: settings || [] } : {}),
    ...(profiles !== undefined ? { profiles: profiles || [] } : {}),
  });
}

async function actionContext(request) {
  const user = await verifyJWT(request);
  if (!user) return { response: respond(401, { error: "unauthorized" }) };
  const client = getServiceClient();
  if (!client) return { response: respond(500, { error: "service_unavailable" }) };
  const profile = await profileForUser(client, user);
  if (profile.error) return { response: respond(500, { error: profile.error }) };
  return { user, client, profile };
}

export async function POST(request) {
  const context = await actionContext(request);
  if (context.response) return context.response;
  let body;
  try { body = await request.json(); } catch { return respond(400, { error: "invalid_json" }); }

  if (body?.action === "update_settings") {
    if (!canManageSettings(context.profile.role)) return respond(403, { error: "forbidden" });
    if (typeof body.key !== "string" || !body.key.trim() || body.key.length > 120) return respond(400, { error: "invalid_setting_key" });
    if (body.operation === "delete") {
      const { error } = await context.client.from("settings").delete().eq("key", body.key.trim());
      return error ? respond(500, { error: "settings_write_failed" }) : respond(200, { ok: true });
    }
    if (body.operation !== "upsert" || !("value" in body)) return respond(400, { error: "invalid_settings_operation" });
    const { data, error } = await context.client.from("settings")
      .upsert({ key: body.key.trim(), value: body.value }, { onConflict: "key" })
      .select("id, key, value, updated_at");
    return error ? respond(500, { error: "settings_write_failed" }) : respond(200, { setting: Array.isArray(data) ? data[0] : data });
  }

  if (body?.action === "set_role") {
    if (!canManageRoles(context.profile.role)) return respond(403, { error: "forbidden" });
    if (body.profileId === context.user.id) return respond(400, { error: "admin_cannot_demote_self" });
    if (typeof body.profileId !== "string" || !ROLES.includes(body.role)) return respond(400, { error: "invalid_role_change" });
    const { data, error } = await context.client.from("profiles").update({ role: body.role }).eq("id", body.profileId).select("id, email, full_name, sf_user_id, role");
    if (error) return respond(500, { error: "role_update_failed" });
    invalidateProfileCache(body.profileId);
    return respond(200, { profile: Array.isArray(data) ? data[0] : data });
  }

  return respond(400, { error: "invalid_action" });
}
