import { createClient } from "@supabase/supabase-js";
import { verifyJWT } from "./_auth.js";
import { listContacts } from "./_calls/listContacts.js";
import { deletePreset, listPresets, savePreset } from "./_calls/presets.js";
import mapping from "./_crm/mapping.js";
import { buildLightningUrl, createEvent, createRecallTask, fetchContactContext, fetchSFToken, logCall, updateContactDoNotCall } from "./_crm/salesforce.js";

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const VALID_RESULTS = mapping.objects.task.results;
const TASK_SEMANTIC = mapping.objects.task.resultSemantic;
const ISO_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidScheduledFor(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year
    && check.getUTCMonth() + 1 === month
    && check.getUTCDate() === day
  );
}

export function todayParisDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
}

const PGRST_NOT_FOUND = "PGRST116";

export function isNotFoundError(error) {
  return error?.code === PGRST_NOT_FOUND;
}

export function isValidEventStart(start) {
  if (!start || typeof start !== "string" || start.trim() === "") return false;
  const trimmed = start.trim();
  if (!ISO_START_RE.test(trimmed)) return false;

  const parts = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!parts) return false;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = parts[6] ? Number(parts[6]) : 0;
  const zone = parts[7];

  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const offsetParts = zone.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!offsetParts) return false;
    const offsetHour = Number(offsetParts[2]);
    const offsetMinute = Number(offsetParts[3]);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() + 1 !== month
    || calendarCheck.getUTCDate() !== day
  ) {
    return false;
  }

  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
}

export function getFollowUpOutcomes(taskMapping = mapping) {
  const semantic = taskMapping.objects.task.resultSemantic;
  return [semantic.followUpNoAnswer, semantic.followUpVoicemail];
}

export function filterContactsForFollowUp(contacts, followUpOutcomes = getFollowUpOutcomes()) {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => {
    // Deux cas de follow-up :
    // 1) essayé sans succès (skipped / non-décroché / répondeur) — compteur déjà incrémenté
    // 2) pas essayé (pending) — reporté tel quel, sans incrément
    if (contact?.status === "skipped" || contact?.status === "pending") return true;
    return followUpOutcomes.includes(contact?.outcome);
  });
}

export const SESSION_TYPES = ["prospection", "suivi_opportunites", "suivi_clients", "relance"];

export function isValidSessionType(value) {
  return typeof value === "string" && SESSION_TYPES.includes(value);
}

const PIPE_DECROCHE = ["Appel décroché", "Appel argumenté", "RDV planifié"];
const PIPE_ARGUMENTE = ["Appel argumenté", "RDV planifié"];

/** KPIs hub à partir des lignes contact (status called/skipped + outcome + marked_npa). */
export function computeHubKpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const called = list.filter((row) => row?.status === "called");
  const calls = called.length;
  const decroche = called.filter((row) => PIPE_DECROCHE.includes(row?.outcome)).length;
  const argumente = called.filter((row) => PIPE_ARGUMENTE.includes(row?.outcome)).length;
  const rdv = called.filter((row) => row?.outcome === "RDV planifié").length;
  const npa = list.filter((row) => row?.marked_npa === true).length;
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  return {
    calls,
    decroche,
    argumente,
    rdv,
    npa,
    rate_decroche: rate(decroche, calls),
    rate_argumente: rate(argumente, calls),
    rate_rdv_per_decroche: rate(rdv, decroche),
    rate_rdv_per_argumente: rate(rdv, argumente),
  };
}

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function journalAction({ actorId, actionType, changes, targets, result }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("_journal: missing Supabase URL or service role key");
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await supabase.from("action_journal").insert({
      actor: actorId,
      action_type: actionType,
      changes: changes || {},
      targets: targets || [],
      result: result || {},
    });
  } catch (err) {
    console.error("Failed to write to action_journal:", err);
  }
}

async function fetchUserProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("sf_user_id, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: "profile_lookup_failed" };
  return {
    sfUserId: data?.sf_user_id || null,
    fullName: data?.full_name || null,
  };
}

function actorName(user, profile) {
  return profile?.fullName || user.user_metadata?.full_name || user.email || "Utilisateur Inconnu";
}

async function assertSessionOwner(client, sessionId, userId) {
  const { data: session, error } = await client
    .from("call_sessions")
    .select("id, owner, name, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error && !isNotFoundError(error)) return { error: "session_lookup_failed", status: 500 };
  if (!session || session.owner !== userId) return { error: "not_found", status: 404 };
  return { session };
}

async function assertSessionContact(client, sessionId, contactId) {
  const { data: contact, error } = await client
    .from("call_session_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (error && !isNotFoundError(error)) return { error: "contact_lookup_failed", status: 500 };
  if (!contact || contact.session_id !== sessionId) return { error: "not_found", status: 404 };
  return { contact };
}

async function insertSessionWithContacts(client, userId, name, contacts, scheduledFor, options = {}) {
  const sessionType = isValidSessionType(options.sessionType) ? options.sessionType : "prospection";
  const { data: session, error: sessionError } = await client
    .from("call_sessions")
    .insert({
      owner: userId,
      name: name.trim(),
      status: "active",
      scheduled_for: scheduledFor,
      session_type: sessionType,
    })
    .select("id, name, status, created_at, scheduled_for, session_type")
    .single();

  if (sessionError || !session) return { error: "session_creation_failed", status: 500 };

  const contactRows = contacts.map((contact, index) => ({
    session_id: session.id,
    position: index,
    sf_contact_id: contact.sf_contact_id,
    sf_account_id: contact.sf_account_id || null,
    contact_name: contact.contact_name.trim(),
    account_name: contact.account_name || null,
    phone: contact.mobile_phone || contact.phone || null,
    title: contact.title || null,
    linkedin_url: contact.linkedin_url || null,
    status: "pending",
    attempt_count: Number.isInteger(contact.attempt_count) && contact.attempt_count >= 0
      ? contact.attempt_count
      : 0,
    marked_npa: false,
  }));

  const { data: insertedContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .insert(contactRows)
    .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, title, linkedin_url, status, outcome, comments, sf_task_id, sf_event_id, called_at, recall_at, attempt_count, marked_npa")
    .order("position", { ascending: true });

  if (contactsError || !insertedContacts?.length) {
    await client.from("call_sessions").delete().eq("id", session.id);
    return { error: "session_contacts_insert_failed", status: 500 };
  }

  return { session, contacts: enrichSessionContacts(insertedContacts) };
}

function enrichSessionContacts(contacts) {
  return (contacts || []).map((contact) => ({
    ...contact,
    sf_contact_url: buildLightningUrl("Contact", contact.sf_contact_id),
    sf_account_url: contact.sf_account_id ? buildLightningUrl("Account", contact.sf_account_id) : null,
  }));
}

function getParisDateRange() {
  const now = new Date();
  const parisNowStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const [datePart, timePart] = parisNowStr.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  const utcNow = Date.now();
  const parisNowDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMs = utcNow - parisNowDate.getTime();

  const todayStart = new Date(Date.UTC(year, month - 1, day) + offsetMs);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const dow = todayStart.getUTCDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(todayStart.getTime() - mondayOffset * 86400000);
  const monthStart = new Date(Date.UTC(year, month - 1, 1) + offsetMs);

  return { todayStart, tomorrowStart, weekStart, monthStart };
}

export async function GET(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  const url = new URL(request.url);
  const sessionIdParam = url.searchParams.get("session_id");
  const statsParam = url.searchParams.get("stats");
  const resource = url.searchParams.get("resource");

  if (resource === "presets") {
    const result = await listPresets(client, user.id);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers });
    }
    return new Response(JSON.stringify({ presets: result.presets }), { status: 200, headers });
  }

  if (statsParam === "1") {
    const { data: userSessions, error: sessionsError } = await client
      .from("call_sessions")
      .select("id, status")
      .eq("owner", user.id);

    if (sessionsError) {
      return new Response(JSON.stringify({ error: "sessions_lookup_failed" }), { status: 500, headers });
    }

    const sessionIds = (userSessions || []).map((session) => session.id);
    let sessionsActive = 0;
    let sessionsCompleted = 0;
    for (const session of userSessions || []) {
      if (session.status === "active") sessionsActive++;
      else if (session.status === "completed") sessionsCompleted++;
    }

    let callsToday = 0;
    let callsWeek = 0;
    let weekRows = [];
    let monthRows = [];

    if (sessionIds.length > 0) {
      const { data: calls, error: callsError } = await client
        .from("call_session_contacts")
        .select("status, outcome, called_at, marked_npa")
        .in("session_id", sessionIds)
        .eq("status", "called")
        .not("called_at", "is", null);

      if (callsError) {
        return new Response(JSON.stringify({ error: "calls_lookup_failed" }), { status: 500, headers });
      }

      const { todayStart, weekStart, monthStart } = getParisDateRange();
      for (const call of calls || []) {
        const called = new Date(call.called_at);
        if (called >= todayStart) callsToday++;
        if (called >= weekStart) {
          callsWeek++;
          weekRows.push(call);
        }
        if (called >= monthStart) monthRows.push(call);
      }
    }

    const week = computeHubKpis(weekRows);
    const month = computeHubKpis(monthRows);

    return new Response(
      JSON.stringify({
        stats: {
          calls_today: callsToday,
          calls_week: callsWeek,
          sessions_active: sessionsActive,
          sessions_completed: sessionsCompleted,
          week,
          month,
        },
      }),
      { status: 200, headers },
    );
  }

  if (sessionIdParam) {
    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId) || sessionId < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const { data: session, error: sessionError } = await client
      .from("call_sessions")
      .select("id, owner, name, status, created_at, scheduled_for, session_type")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError && !isNotFoundError(sessionError)) {
      return new Response(JSON.stringify({ error: "session_lookup_failed" }), { status: 500, headers });
    }
    if (!session) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }
    if (session.owner !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const { data: contacts, error: contactsError } = await client
      .from("call_session_contacts")
      .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, title, linkedin_url, status, outcome, comments, sf_task_id, sf_event_id, called_at, recall_at, attempt_count, marked_npa")
      .eq("session_id", sessionId)
      .order("position", { ascending: true });

    if (contactsError) {
      return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
    }

    const { owner, ...sessionData } = session;
    const contextContactId = url.searchParams.get("context_contact_id");
    let context = null;
    if (contextContactId) {
      const row = (contacts || []).find((c) => String(c.id) === String(contextContactId));
      if (!row) {
        return new Response(JSON.stringify({ error: "contact_not_in_session" }), { status: 404, headers });
      }
      const tokenResult = await fetchSFToken();
      if (tokenResult.error) {
        return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
      }
      const ctx = await fetchContactContext(
        tokenResult.accessToken,
        { contactId: row.sf_contact_id, accountId: row.sf_account_id },
        mapping,
      );
      if (ctx.error) {
        return new Response(JSON.stringify({ error: ctx.error }), { status: 502, headers });
      }
      context = ctx;
    }

    return new Response(
      JSON.stringify({
        session: sessionData,
        contacts: enrichSessionContacts(contacts),
        ...(context ? { context } : {}),
      }),
      { status: 200, headers },
    );
  }

  const { data: sessions, error: sessionsError } = await client
    .from("call_sessions")
    .select("id, name, status, created_at, scheduled_for, session_type")
    .eq("owner", user.id)
    .order("created_at", { ascending: false });

  if (sessionsError) {
    return new Response(JSON.stringify({ error: "sessions_lookup_failed" }), { status: 500, headers });
  }

  if (!sessions || sessions.length === 0) {
    return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers });
  }

  const allSessionIds = sessions.map((session) => session.id);
  const { data: allContacts, error: contactsError } = await client
    .from("call_session_contacts")
    .select("session_id, status")
    .in("session_id", allSessionIds);

  if (contactsError) {
    return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
  }

  const grouped = {};
  for (const contact of allContacts || []) {
    if (!grouped[contact.session_id]) {
      grouped[contact.session_id] = { total: 0, called: 0, skipped: 0, pending: 0 };
    }
    grouped[contact.session_id].total++;
    grouped[contact.session_id][contact.status]++;
  }

  const result = sessions.map((session) => ({
    id: session.id,
    name: session.name,
    status: session.status,
    created_at: session.created_at,
    scheduled_for: session.scheduled_for ?? null,
    session_type: session.session_type ?? "prospection",
    ...(grouped[session.id] || { total: 0, called: 0, skipped: 0, pending: 0 }),
  }));

  return new Response(JSON.stringify({ sessions: result }), { status: 200, headers });
}

export async function POST(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  const action = body.action;
  if (!action) {
    return new Response(JSON.stringify({ error: "missing_action" }), { status: 400, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  if (action === "list_contacts") {
    const result = await listContacts(client, user.id, body);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: result.status || 500, headers });
    }
    if (typeof result.count === "number") {
      return new Response(
        JSON.stringify({ count: result.count, capped: Boolean(result.capped) }),
        { status: 200, headers },
      );
    }
    return new Response(
      JSON.stringify({ contacts: result.contacts, dedup: result.dedup }),
      { status: 200, headers },
    );
  }

  if (action === "list_presets") {
    const result = await listPresets(client, user.id);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers });
    }
    return new Response(JSON.stringify({ presets: result.presets }), { status: 200, headers });
  }

  if (action === "save_preset") {
    const result = await savePreset(client, user.id, body);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: result.status || 500, headers });
    }
    return new Response(JSON.stringify({ preset: result.preset }), { status: 200, headers });
  }

  if (action === "delete_preset") {
    const result = await deletePreset(client, user.id, body.id);
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: result.status || 500, headers });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (action === "create_session") {
    const { name, contacts, scheduled_for: scheduledForInput, session_type: sessionTypeInput } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
    }
    let scheduledFor = todayParisDate();
    if (scheduledForInput !== undefined) {
      if (!isValidScheduledFor(scheduledForInput)) {
        return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
      }
      scheduledFor = scheduledForInput;
    }
    const sessionType = sessionTypeInput === undefined ? "prospection" : sessionTypeInput;
    if (!isValidSessionType(sessionType)) {
      return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
    }
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact || typeof contact !== "object") {
        return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
      }
      if (!contact.sf_contact_id || typeof contact.sf_contact_id !== "string" || !SF_ID.test(contact.sf_contact_id)) {
        return new Response(JSON.stringify({ error: "invalid_sf_contact_id" }), { status: 400, headers });
      }
      if (!contact.contact_name || typeof contact.contact_name !== "string" || contact.contact_name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "invalid_contact_name" }), { status: 400, headers });
      }
      if (contact.sf_account_id !== undefined && contact.sf_account_id !== null && (typeof contact.sf_account_id !== "string" || !SF_ID.test(contact.sf_account_id))) {
        return new Response(JSON.stringify({ error: "invalid_sf_account_id" }), { status: 400, headers });
      }
    }

    const created = await insertSessionWithContacts(client, user.id, name, contacts, scheduledFor, {
      sessionType,
    });
    if (created.error) {
      return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
    }

    return new Response(
      JSON.stringify({ session: created.session, contacts: created.contacts }),
      { status: 200, headers },
    );
  }

  if (action === "update_session") {
    const { session_id, name, scheduled_for: scheduledForInput, session_type: sessionTypeInput } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const patch = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
      }
      patch.name = name.trim();
    }
    if (scheduledForInput !== undefined) {
      if (scheduledForInput !== null && !isValidScheduledFor(scheduledForInput)) {
        return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
      }
      patch.scheduled_for = scheduledForInput;
    }
    if (sessionTypeInput !== undefined) {
      if (!isValidSessionType(sessionTypeInput)) {
        return new Response(JSON.stringify({ error: "invalid_session_type" }), { status: 400, headers });
      }
      patch.session_type = sessionTypeInput;
    }
    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ error: "empty_update" }), { status: 400, headers });
    }

    const { data: updated, error: updateError } = await client
      .from("call_sessions")
      .update(patch)
      .eq("id", session_id)
      .select("id, name, status, created_at, scheduled_for, session_type")
      .single();

    if (updateError || !updated) {
      return new Response(JSON.stringify({ error: "session_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true, session: updated }), { status: 200, headers });
  }

  if (action === "delete_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { error: deleteError } = await client.from("call_sessions").delete().eq("id", session_id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: "session_delete_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (action === "log_call") {
    const { session_id, contact_id, resultat, comments, duration_sec, recall_at, do_not_call } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!VALID_RESULTS.includes(resultat)) {
      return new Response(JSON.stringify({ error: "invalid_resultat" }), { status: 400, headers });
    }
    if (comments !== undefined && typeof comments !== "string") {
      return new Response(JSON.stringify({ error: "invalid_comments" }), { status: 400, headers });
    }
    if (duration_sec !== undefined && (!Number.isInteger(duration_sec) || duration_sec < 0)) {
      return new Response(JSON.stringify({ error: "invalid_duration_sec" }), { status: 400, headers });
    }
    if (recall_at !== undefined && recall_at !== null) {
      if (typeof recall_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(recall_at)) {
        return new Response(JSON.stringify({ error: "invalid_recall_at" }), { status: 400, headers });
      }
    }
    if (do_not_call !== undefined && typeof do_not_call !== "boolean") {
      return new Response(JSON.stringify({ error: "invalid_do_not_call" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    const contact = contactCheck.contact;

    const profileResult = await fetchUserProfile(client, user.id);
    if (profileResult.error) {
      return new Response(JSON.stringify({ error: profileResult.error }), { status: 500, headers });
    }

    const tokenResult = await fetchSFToken();
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const callComments = comments || "";
    const sfResult = await logCall(
      tokenResult.accessToken,
      {
        contactId: contact.sf_contact_id,
        accountId: contact.sf_account_id,
        resultat,
        comments: callComments,
        durationSec: duration_sec ?? 0,
        ownerId: profileResult.sfUserId || undefined,
        actorName: actorName(user, profileResult),
      },
      mapping,
    );

    if (sfResult.error) {
      return new Response(
        JSON.stringify({ error: sfResult.error, message: sfResult.message }),
        { status: 502, headers },
      );
    }

    const taskId = sfResult.record?.id;
    const wantsRecall = typeof recall_at === "string" && recall_at;
    let recallTaskId = null;
    if (wantsRecall && do_not_call !== true) {
      const recall = await createRecallTask(
        tokenResult.accessToken,
        {
          contactId: contact.sf_contact_id,
          accountId: contact.sf_account_id,
          recallAt: recall_at,
          ownerId: profileResult.sfUserId || undefined,
          actorName: actorName(user, profileResult),
        },
        mapping,
      );
      if (!recall.error) recallTaskId = recall.record?.id || null;
    }

    if (do_not_call === true) {
      await updateContactDoNotCall(tokenResult.accessToken, contact.sf_contact_id, true, mapping);
    }

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({
        status: "called",
        outcome: resultat,
        comments: callComments || null,
        sf_task_id: taskId,
        called_at: new Date().toISOString(),
        recall_at: wantsRecall && do_not_call !== true ? recall_at : null,
        attempt_count: (Number.isInteger(contact.attempt_count) ? contact.attempt_count : 0) + 1,
        marked_npa: do_not_call === true,
      })
      .eq("id", contact_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "contact_update_failed", sf_task_id: taskId }),
        { status: 500, headers },
      );
    }

    await journalAction({
      actorId: user.id,
      actionType: "call_session_log",
      changes: {
        resultat,
        comments: callComments,
        recall_at: wantsRecall ? recall_at : null,
        do_not_call: do_not_call === true,
        recall_task_id: recallTaskId,
      },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: { success: true, taskId },
    });

    const response = { ok: true, contact_id, sf_task_id: taskId };
    if (resultat === TASK_SEMANTIC.rdv) {
      response.needs_event = true;
    }

    return new Response(JSON.stringify(response), { status: 200, headers });
  }

  if (action === "log_event") {
    const { session_id, contact_id, start, duration_min, invitees } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!isValidEventStart(start)) {
      return new Response(JSON.stringify({ error: "invalid_start" }), { status: 400, headers });
    }
    if (!Number.isInteger(duration_min) || duration_min < 1) {
      return new Response(JSON.stringify({ error: "invalid_duration_min" }), { status: 400, headers });
    }
    if (invitees !== undefined && (!Array.isArray(invitees) || invitees.some((id) => typeof id !== "string" || !SF_ID.test(id)))) {
      return new Response(JSON.stringify({ error: "invalid_invitees" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }
    const contact = contactCheck.contact;

    const profileResult = await fetchUserProfile(client, user.id);
    if (profileResult.error) {
      return new Response(JSON.stringify({ error: profileResult.error }), { status: 500, headers });
    }

    const tokenResult = await fetchSFToken();
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const sfResult = await createEvent(
      tokenResult.accessToken,
      {
        subject: `RDV — ${contact.contact_name}`,
        startDateTime: start,
        durationMin: duration_min,
        whoId: contact.sf_contact_id,
        whatId: contact.sf_account_id || undefined,
        ownerId: profileResult.sfUserId || undefined,
        invitees: invitees || [],
      },
      mapping,
    );

    if (sfResult.error && !sfResult.record?.id) {
      return new Response(
        JSON.stringify({ error: sfResult.error, message: sfResult.message, inviteeError: sfResult.inviteeError }),
        { status: 502, headers },
      );
    }

    const eventId = sfResult.record?.id;
    if (eventId) {
      const { error: updateError } = await client
        .from("call_session_contacts")
        .update({ sf_event_id: eventId })
        .eq("id", contact_id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "contact_update_failed", sf_event_id: eventId }),
          { status: 500, headers },
        );
      }
    }

    const partialInviteeFailure = Boolean(sfResult.inviteeError);
    await journalAction({
      actorId: user.id,
      actionType: "call_session_event",
      changes: { start, duration_min, invitees: invitees || [] },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: {
        success: !partialInviteeFailure,
        partial: partialInviteeFailure,
        eventId,
        inviteeError: sfResult.inviteeError,
      },
    });

    if (partialInviteeFailure) {
      return new Response(
        JSON.stringify({ error: "event_invitee_failed", sf_event_id: eventId, inviteeError: sfResult.inviteeError }),
        { status: 502, headers },
      );
    }

    return new Response(JSON.stringify({ ok: true, sf_event_id: eventId }), { status: 200, headers });
  }

  if (action === "create_follow_up_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { data: sessionContacts, error: contactsLookupError } = await client
      .from("call_session_contacts")
      .select("sf_contact_id, sf_account_id, contact_name, account_name, phone, title, linkedin_url, outcome, status, attempt_count")
      .eq("session_id", session_id)
      .order("position", { ascending: true });

    if (contactsLookupError) {
      return new Response(JSON.stringify({ error: "session_contacts_lookup_failed" }), { status: 500, headers });
    }

    const followUpContacts = filterContactsForFollowUp(sessionContacts || []);
    if (followUpContacts.length === 0) {
      return new Response(JSON.stringify({ error: "no_follow_up_contacts" }), { status: 400, headers });
    }

    const created = await insertSessionWithContacts(
      client,
      user.id,
      `Relance — ${sessionCheck.session.name}`,
      followUpContacts,
      todayParisDate(),
      { sessionType: "relance" },
    );
    if (created.error) {
      return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
    }

    return new Response(
      JSON.stringify({ ok: true, session: created.session, contacts: created.contacts }),
      { status: 200, headers },
    );
  }

  if (action === "skip_contact") {
    const { session_id, contact_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const contactCheck = await assertSessionContact(client, session_id, contact_id);
    if (contactCheck.error) {
      return new Response(JSON.stringify({ error: contactCheck.error }), { status: contactCheck.status, headers });
    }

    const { error: updateError } = await client
      .from("call_session_contacts")
      .update({
        status: "skipped",
        // Non contacté = pas d'essai dans cette séance → pas d'incrément
      })
      .eq("id", contact_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "contact_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  if (action === "defer_contacts") {
    const {
      session_id,
      contact_ids,
      scheduled_for: scheduledForInput,
      target_session_id: targetSessionId,
    } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (!Array.isArray(contact_ids) || contact_ids.length === 0 || contact_ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id < 1)) {
      return new Response(JSON.stringify({ error: "invalid_contact_ids" }), { status: 400, headers });
    }
    if (!isValidScheduledFor(scheduledForInput)) {
      return new Response(JSON.stringify({ error: "invalid_scheduled_for" }), { status: 400, headers });
    }
    if (
      targetSessionId !== undefined
      && targetSessionId !== null
      && (typeof targetSessionId !== "number" || !Number.isInteger(targetSessionId) || targetSessionId < 1)
    ) {
      return new Response(JSON.stringify({ error: "invalid_target_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    const { data: sourceContacts, error: sourceError } = await client
      .from("call_session_contacts")
      .select("id, sf_contact_id, sf_account_id, contact_name, account_name, phone, title, linkedin_url, status, attempt_count")
      .eq("session_id", session_id)
      .in("id", contact_ids);

    if (sourceError) {
      return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
    }
    if (!sourceContacts || sourceContacts.length !== contact_ids.length) {
      return new Response(JSON.stringify({ error: "contact_not_in_session" }), { status: 404, headers });
    }
    if (sourceContacts.some((contact) => contact.status !== "pending")) {
      return new Response(JSON.stringify({ error: "contact_not_pending" }), { status: 400, headers });
    }

    const { error: skipError } = await client
      .from("call_session_contacts")
      .update({ status: "skipped" })
      .in("id", contact_ids)
      .eq("session_id", session_id);

    if (skipError) {
      return new Response(JSON.stringify({ error: "contact_update_failed" }), { status: 500, headers });
    }

    const payloadContacts = sourceContacts.map((contact) => ({
      sf_contact_id: contact.sf_contact_id,
      sf_account_id: contact.sf_account_id,
      contact_name: contact.contact_name,
      account_name: contact.account_name,
      phone: contact.phone,
      title: contact.title,
      linkedin_url: contact.linkedin_url,
      attempt_count: Number.isInteger(contact.attempt_count) ? contact.attempt_count : 0,
    }));

    let targetSession = null;
    let targetContacts = null;

    if (typeof targetSessionId === "number") {
      const targetCheck = await assertSessionOwner(client, targetSessionId, user.id);
      if (targetCheck.error) {
        return new Response(JSON.stringify({ error: targetCheck.error }), { status: targetCheck.status, headers });
      }
      if (targetCheck.session.status !== "active") {
        return new Response(JSON.stringify({ error: "target_session_not_active" }), { status: 400, headers });
      }
      if (targetSessionId === session_id) {
        return new Response(JSON.stringify({ error: "invalid_target_session_id" }), { status: 400, headers });
      }

      const { data: existingRows, error: existingError } = await client
        .from("call_session_contacts")
        .select("position, sf_contact_id")
        .eq("session_id", targetSessionId)
        .order("position", { ascending: false });

      if (existingError) {
        return new Response(JSON.stringify({ error: "contacts_lookup_failed" }), { status: 500, headers });
      }

      const existingIds = new Set((existingRows || []).map((row) => row.sf_contact_id));
      const toInsert = payloadContacts.filter((contact) => !existingIds.has(contact.sf_contact_id));
      const startPosition = existingRows?.[0]?.position != null ? existingRows[0].position + 1 : 0;

      if (toInsert.length > 0) {
        const rows = toInsert.map((contact, index) => ({
          session_id: targetSessionId,
          position: startPosition + index,
          sf_contact_id: contact.sf_contact_id,
          sf_account_id: contact.sf_account_id || null,
          contact_name: contact.contact_name,
          account_name: contact.account_name || null,
          phone: contact.phone || null,
          title: contact.title || null,
          linkedin_url: contact.linkedin_url || null,
          status: "pending",
          attempt_count: contact.attempt_count,
          marked_npa: false,
        }));
        const { error: insertError } = await client.from("call_session_contacts").insert(rows);
        if (insertError) {
          return new Response(JSON.stringify({ error: "session_contacts_insert_failed" }), { status: 500, headers });
        }
      }

      const { data: refreshedTarget, error: refreshError } = await client
        .from("call_sessions")
        .select("id, name, status, created_at, scheduled_for, session_type")
        .eq("id", targetSessionId)
        .single();
      if (refreshError || !refreshedTarget) {
        return new Response(JSON.stringify({ error: "session_lookup_failed" }), { status: 500, headers });
      }
      targetSession = refreshedTarget;
    } else {
      const created = await insertSessionWithContacts(
        client,
        user.id,
        `Relance — ${sessionCheck.session.name}`,
        payloadContacts,
        scheduledForInput,
        { sessionType: "relance" },
      );
      if (created.error) {
        return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
      }
      targetSession = created.session;
      targetContacts = created.contacts;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        target_session: targetSession,
        contacts: targetContacts,
      }),
      { status: 200, headers },
    );
  }

  if (action === "complete_session") {
    const { session_id } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const sessionCheck = await assertSessionOwner(client, session_id, user.id);
    if (sessionCheck.error) {
      return new Response(JSON.stringify({ error: sessionCheck.error }), { status: sessionCheck.status, headers });
    }

    if (sessionCheck.session.status === "completed") {
      return new Response(JSON.stringify({ error: "already_completed" }), { status: 400, headers });
    }

    const { error: updateError } = await client
      .from("call_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", session_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "session_update_failed" }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers });
}

export async function DELETE(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("resource") !== "presets") {
    return new Response(JSON.stringify({ error: "invalid_resource" }), { status: 400, headers });
  }

  let presetId = url.searchParams.get("id");
  if (!presetId) {
    try {
      const body = await request.json();
      presetId = body?.id;
    } catch {
      presetId = null;
    }
  }

  const result = await deletePreset(client, user.id, presetId);
  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status || 500, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
