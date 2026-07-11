/** Live Call Manager target list, backed by the CRM adapter. */
import { createClient } from "@supabase/supabase-js";
import { respond, verifyJWT } from "./_auth.js";
import mapping from "./_crm/mapping.js";
import {
  buildTargetQuery,
  boundedLimit,
  fetchSFToken,
  filterTargetContacts,
  hasRelanceQueryFilters,
  searchContacts,
} from "./_crm/salesforce.js";

function json(status, body) {
  const response = respond(status, body);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBody(body) {
  if (!isObject(body)) return { error: "invalid_body" };
  if (!isObject(body.filters)) return { error: "invalid_filters" };
  for (const family of ["entreprise", "contact", "relance"]) {
    if (body.filters[family] !== undefined && !isObject(body.filters[family])) {
      return { error: "invalid_filters" };
    }
  }
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1)) {
    return { error: "invalid_limit" };
  }
  if (body.preset_id !== undefined && (!Number.isInteger(body.preset_id) || body.preset_id < 1)) {
    return { error: "invalid_preset_id" };
  }
  return { filters: { ...body.filters, limit: body.limit ?? body.filters.limit } };
}

async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("sf_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: "profile_lookup_failed" };
  return { sfUserId: data?.sf_user_id || null };
}

function normalizeContacts(records) {
  const contact = mapping.objects.contact.fields;
  const account = mapping.objects.account.fields;
  const task = mapping.objects.task;
  return records
    .filter((record) => typeof record?.[contact.id] === "string")
    .map((record) => {
      const tasks = record[task.childRelationship];
      const lastCall = Array.isArray(tasks?.records) ? tasks.records[0] : null;
      return {
        sf_contact_id: record[contact.id],
        sf_account_id: record.Account?.[account.id] ?? record[contact.accountId] ?? null,
        contact_name: record[contact.name] || "",
        account_name: record.Account?.[account.name] ?? null,
        // Prefer mobile for dialing — filter "a_telephone" means has MobilePhone.
        phone: record[contact.mobilePhone] ?? record[contact.phone] ?? null,
        title: record[contact.title] ?? null,
        linkedin_url: record[contact.linkedin] ?? null,
        email: record[contact.email] ?? null,
        mobile_phone: record[contact.mobilePhone] ?? null,
        ...(lastCall?.[task.fields.activityDate] ? { last_call_at: lastCall[task.fields.activityDate] } : {}),
        ...(typeof tasks?.totalSize === "number" ? { call_count: tasks.totalSize } : {}),
      };
    });
}

async function findDedup(client, contactIds) {
  if (!contactIds.length) return [];
  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, owner")
    .eq("status", "active");
  if (sessionsError || !sessions?.length) return [];
  const sessionIds = sessions.map((session) => session.id);
  const { data: sessionContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .select("sf_contact_id, session_id")
    .in("session_id", sessionIds)
    .in("sf_contact_id", contactIds);
  if (contactsError || !sessionContacts?.length) return [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const owners = [...new Set(sessions.map((session) => session.owner))];
  const { data: profiles } = await client.from("profiles").select("id, full_name, email").in("id", owners);
  const ownerLabels = new Map((profiles || []).map((profile) => [profile.id, profile.full_name || profile.email || profile.id]));
  const dedup = new Map();
  for (const row of sessionContacts) {
    if (!dedup.has(row.sf_contact_id)) {
      const session = sessionById.get(row.session_id);
      dedup.set(row.sf_contact_id, ownerLabels.get(session.owner) || session.owner);
    }
  }
  return [...dedup].map(([sf_contact_id, in_session_of]) => ({ sf_contact_id, in_session_of }));
}

export async function POST(request) {
  const user = await verifyJWT(request);
  if (!user) return json(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const parsed = parseBody(body);
  if (parsed.error) return json(400, { error: parsed.error });

  const client = getServiceClient();
  if (!client) return json(500, { error: "server_error" });
  const profile = await fetchProfile(client, user.id);
  if (profile.error) return json(500, { error: profile.error });

  const tokenResult = await fetchSFToken();
  if (tokenResult.error) return json(502, { error: tokenResult.error });
  const soql = buildTargetQuery(parsed.filters, mapping, profile.sfUserId);
  const search = await searchContacts(tokenResult.accessToken, soql);
  if (search.error) return json(502, { error: search.error });

  const filtered = filterTargetContacts(search.records, parsed.filters, mapping);
  const requestedLimit = boundedLimit(parsed.filters.limit);
  const contacts = normalizeContacts(
    hasRelanceQueryFilters(parsed.filters) ? filtered.slice(0, requestedLimit) : filtered,
  );
  const dedup = await findDedup(client, contacts.map((contact) => contact.sf_contact_id));
  return json(200, { contacts, dedup });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
