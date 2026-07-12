import { createClient } from '@supabase/supabase-js';
import { respond, verifyJWT } from './_auth.js';
import { getProfile, invalidateProfileCache } from './_calls/profileCache.js';
import { canManageRoles, canManageSettings, ROLES } from './_config/access.js';
import { fetchSFToken } from './_crm/salesforce.js';
import {
  CLEANER_SETTINGS_KEY,
  DEFAULT_CLEANER_SETTINGS,
  normalizeCleanerSettings,
} from './_cleaner/core/settings.js';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function instanceUrl() {
  return (
    process.env.SF_INSTANCE_URL || 'https://db0000000d7rdeay.my.salesforce.com'
  );
}

async function fetchSalesforceStatus({ client, userId }) {
  const empty = { connected: false, dailyApiRequests: null };
  try {
    // Single credential model: the signed-in user's Salesforce OAuth token.
    const liveToken = await fetchSFToken({ client, userId });
    const connected = Boolean(liveToken.accessToken && !liveToken.error);
    if (!connected) return empty;

    const response = await fetch(`${instanceUrl()}/services/data/v67.0/limits`, {
      headers: { Authorization: `Bearer ${liveToken.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return empty;
    const limits = await response.json();
    const daily = limits.DailyApiRequests;
    return {
      connected: true,
      dailyApiRequests: daily
        ? { max: daily.Max, remaining: daily.Remaining }
        : null,
    };
  } catch {
    return empty;
  }
}

function nativeCleanerCache() {
  return { version: 'native' };
}

async function profileForUser(client, user) {
  const profile = await getProfile(client, user.id);
  if (profile.error) return profile;
  return {
    ...profile,
    role: ROLES.includes(profile.role) ? profile.role : 'commercial',
  };
}

async function listSettings(client) {
  const { data, error } = await client
    .from('settings')
    .select('id, key, value, updated_at')
    .order('key');
  return error ? null : data || [];
}

async function listProfiles(client) {
  const { data, error } = await client
    .from('profiles')
    .select('id, email, full_name, sf_user_id, role')
    .order('email');
  return error ? null : data || [];
}

export async function GET(request) {
  const user = await verifyJWT(request);
  if (!user) return respond(401, { error: 'unauthorized' });
  const client = getServiceClient();
  if (!client) return respond(500, { error: 'service_unavailable' });
  const profile = await profileForUser(client, user);
  if (profile.error) return respond(500, { error: profile.error });

  const [salesforce, settings, profiles] = await Promise.all([
    fetchSalesforceStatus({ client, userId: user.id }),
    canManageSettings(profile.role)
      ? listSettings(client)
      : Promise.resolve(undefined),
    canManageSettings(profile.role)
      ? listProfiles(client)
      : Promise.resolve(undefined),
  ]);
  const settingsRows = settings || [];
  const cleanerSettings =
    settings !== undefined ? normalizeCleanerSettings(settingsRows) : null;
  return respond(200, {
    role: profile.role,
    capabilities: {
      manageSettings: canManageSettings(profile.role),
      manageRoles: canManageRoles(profile.role),
    },
    profile: {
      email: user.email || null,
      fullName: profile.fullName,
      sfUserId: profile.sfUserId,
      sfLinked: Boolean(profile.userLinked),
    },
    salesforce: {
      ...salesforce,
      userLinked: Boolean(profile.userLinked),
    },
    cache: { cleaner: nativeCleanerCache() },
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
    ...(settings !== undefined
      ? {
          settings: settingsRows.filter(
            (setting) =>
              setting.key !== 'cleaner_late_days' &&
              setting.key !== CLEANER_SETTINGS_KEY,
          ),
          cleanerSettings: {
            key: CLEANER_SETTINGS_KEY,
            defaults: DEFAULT_CLEANER_SETTINGS,
            effective: cleanerSettings.settings,
            warnings: cleanerSettings.warnings,
          },
        }
      : {}),
    ...(profiles !== undefined ? { profiles: profiles || [] } : {}),
  });
}

async function actionContext(request) {
  const user = await verifyJWT(request);
  if (!user) return { response: respond(401, { error: 'unauthorized' }) };
  const client = getServiceClient();
  if (!client)
    return { response: respond(500, { error: 'service_unavailable' }) };
  const profile = await profileForUser(client, user);
  if (profile.error)
    return { response: respond(500, { error: profile.error }) };
  return { user, client, profile };
}

export async function POST(request) {
  const context = await actionContext(request);
  if (context.response) return context.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: 'invalid_json' });
  }

  if (body?.action === 'update_settings') {
    if (!canManageSettings(context.profile.role))
      return respond(403, { error: 'forbidden' });
    if (
      typeof body.key !== 'string' ||
      !body.key.trim() ||
      body.key.length > 120
    )
      return respond(400, { error: 'invalid_setting_key' });
    const key = body.key.trim();
    if (key === 'cleaner_late_days')
      return respond(400, {
        error: 'legacy_setting_rejected',
        message: 'cleaner_late_days n’est plus utilisé par Labo.',
      });
    if (key === CLEANER_SETTINGS_KEY) {
      if (body.operation !== 'upsert' || !('value' in body))
        return respond(400, { error: 'invalid_settings_operation' });
      const normalized = normalizeCleanerSettings([
        { key: CLEANER_SETTINGS_KEY, value: body.value },
      ]);
      if (normalized.warnings.length)
        return respond(400, {
          error: 'invalid_cleaner_v2',
          message: normalized.warnings[0].message,
          warnings: normalized.warnings,
        });
      const { data, error } = await context.client
        .from('settings')
        .upsert(
          { key: CLEANER_SETTINGS_KEY, value: normalized.settings },
          { onConflict: 'key' },
        )
        .select('id, key, value, updated_at');
      return error
        ? respond(500, { error: 'settings_write_failed' })
        : respond(200, {
            setting: Array.isArray(data) ? data[0] : data,
            cleanerSettings: normalized,
          });
    }
    if (body.operation === 'delete') {
      const { error } = await context.client
        .from('settings')
        .delete()
        .eq('key', key);
      return error
        ? respond(500, { error: 'settings_write_failed' })
        : respond(200, { ok: true });
    }
    if (body.operation !== 'upsert' || !('value' in body))
      return respond(400, { error: 'invalid_settings_operation' });
    const { data, error } = await context.client
      .from('settings')
      .upsert({ key, value: body.value }, { onConflict: 'key' })
      .select('id, key, value, updated_at');
    return error
      ? respond(500, { error: 'settings_write_failed' })
      : respond(200, { setting: Array.isArray(data) ? data[0] : data });
  }

  if (body?.action === 'set_role') {
    if (!canManageRoles(context.profile.role))
      return respond(403, { error: 'forbidden' });
    if (body.profileId === context.user.id)
      return respond(400, { error: 'admin_cannot_demote_self' });
    if (typeof body.profileId !== 'string' || !ROLES.includes(body.role))
      return respond(400, { error: 'invalid_role_change' });
    const { data, error } = await context.client
      .from('profiles')
      .update({ role: body.role })
      .eq('id', body.profileId)
      .select('id, email, full_name, sf_user_id, role');
    if (error) return respond(500, { error: 'role_update_failed' });
    invalidateProfileCache(body.profileId);
    return respond(200, { profile: Array.isArray(data) ? data[0] : data });
  }

  return respond(400, { error: 'invalid_action' });
}
