import { createClient } from "@supabase/supabase-js";
import { verifyJWT } from "./_auth.js";
import mapping from "./_crm/mapping.js";
import { createEvent, fetchSFToken, logCall } from "./_crm/salesforce.js";

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const VALID_RESULTS = mapping.objects.task.results;
const RDV_RESULT = "RDV planifié";

export function getFollowUpOutcomes(taskMapping = mapping) {
  return taskMapping.objects.task.results.filter(
    (result) => result === "Appel non décroché" || result === "Message répondeur",
  );
}

export function filterContactsForFollowUp(contacts, followUpOutcomes = getFollowUpOutcomes()) {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) =>
    followUpOutcomes.includes(contact.outcome),
  );
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
  const { data: session } = await client
    .from("call_sessions")
    .select("id, owner, name, status")
    .eq("id", sessionId)
    .single();
  if (!session || session.owner !== userId) return { error: "not_found", status: 404 };
  return { session };
}

async function assertSessionContact(client, sessionId, contactId) {
  const { data: contact } = await client
    .from("call_session_contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (!contact || contact.session_id !== sessionId) return { error: "not_found", status: 404 };
  return { contact };
}

async function insertSessionWithContacts(client, userId, name, contacts) {
  const { data: session } = await client
    .from("call_sessions")
    .insert({ owner: userId, name: name.trim(), status: "active" })
    .select("id, name, status, created_at")
    .single();

  if (!session) return { error: "session_creation_failed", status: 500 };

  const contactRows = contacts.map((contact, index) => ({
    session_id: session.id,
    position: index,
    sf_contact_id: contact.sf_contact_id,
    sf_account_id: contact.sf_account_id || null,
    contact_name: contact.contact_name.trim(),
    account_name: contact.account_name || null,
    phone: contact.phone || null,
    status: "pending",
  }));

  const { data: insertedContacts } = await client
    .from("call_session_contacts")
    .insert(contactRows)
    .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, status, outcome, comments, sf_task_id, sf_event_id, called_at")
    .order("position", { ascending: true });

  return { session, contacts: insertedContacts || [] };
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

  return { todayStart, tomorrowStart, weekStart };
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

  if (statsParam === "1") {
    const { data: userSessions } = await client
      .from("call_sessions")
      .select("id")
      .eq("owner", user.id);

    const sessionIds = (userSessions || []).map((session) => session.id);

    let sessionsActive = 0;
    let sessionsCompleted = 0;
    for (const session of userSessions || []) {
      const { data: sessionData } = await client
        .from("call_sessions")
        .select("status")
        .eq("id", session.id)
        .single();
      if (sessionData) {
        if (sessionData.status === "active") sessionsActive++;
        else if (sessionData.status === "completed") sessionsCompleted++;
      }
    }

    let callsToday = 0;
    let callsWeek = 0;
    if (sessionIds.length > 0) {
      const { data: calls } = await client
        .from("call_session_contacts")
        .select("called_at")
        .eq("status", "called")
        .in("session_id", sessionIds)
        .not("called_at", "is", null);

      const { todayStart, weekStart } = getParisDateRange();
      for (const call of calls || []) {
        const called = new Date(call.called_at);
        if (called >= todayStart) callsToday++;
        if (called >= weekStart) callsWeek++;
      }
    }

    return new Response(
      JSON.stringify({
        stats: { calls_today: callsToday, calls_week: callsWeek, sessions_active: sessionsActive, sessions_completed: sessionsCompleted },
      }),
      { status: 200, headers },
    );
  }

  if (sessionIdParam) {
    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId) || sessionId < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }

    const { data: session } = await client
      .from("call_sessions")
      .select("id, owner, name, status, created_at")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }
    if (session.owner !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const { data: contacts } = await client
      .from("call_session_contacts")
      .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, status, outcome, comments, sf_task_id, sf_event_id, called_at")
      .eq("session_id", sessionId)
      .order("position", { ascending: true });

    const { owner, ...sessionData } = session;
    return new Response(
      JSON.stringify({ session: sessionData, contacts: contacts || [] }),
      { status: 200, headers },
    );
  }

  const { data: sessions } = await client
    .from("call_sessions")
    .select("id, name, status, created_at")
    .eq("owner", user.id)
    .order("created_at", { ascending: false });

  if (!sessions || sessions.length === 0) {
    return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers });
  }

  const allSessionIds = sessions.map((session) => session.id);
  const { data: allContacts } = await client
    .from("call_session_contacts")
    .select("session_id, status")
    .in("session_id", allSessionIds);

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

  if (action === "create_session") {
    const { name, contacts } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
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

    const created = await insertSessionWithContacts(client, user.id, name, contacts);
    if (created.error) {
      return new Response(JSON.stringify({ error: created.error }), { status: created.status, headers });
    }

    return new Response(
      JSON.stringify({ session: created.session, contacts: created.contacts }),
      { status: 200, headers },
    );
  }

  if (action === "log_call") {
    const { session_id, contact_id, resultat, comments, duration_sec } = body;

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

    await client
      .from("call_session_contacts")
      .update({
        status: "called",
        outcome: resultat,
        comments: callComments || null,
        sf_task_id: taskId,
        called_at: new Date().toISOString(),
      })
      .eq("id", contact_id);

    await journalAction({
      actorId: user.id,
      actionType: "call_session_log",
      changes: { resultat, comments: callComments, duration_sec: duration_sec ?? 0 },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: { success: true, taskId },
    });

    const response = { ok: true, contact_id, sf_task_id: taskId };
    if (resultat === RDV_RESULT) {
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
    if (!start || typeof start !== "string") {
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

    if (sfResult.error) {
      return new Response(
        JSON.stringify({ error: sfResult.error, message: sfResult.message, inviteeError: sfResult.inviteeError }),
        { status: 502, headers },
      );
    }

    const eventId = sfResult.record?.id;
    if (eventId) {
      await client
        .from("call_session_contacts")
        .update({ sf_event_id: eventId })
        .eq("id", contact_id);
    }

    await journalAction({
      actorId: user.id,
      actionType: "call_session_event",
      changes: { start, duration_min, invitees: invitees || [] },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: { success: true, eventId },
    });

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

    const { data: sessionContacts } = await client
      .from("call_session_contacts")
      .select("sf_contact_id, sf_account_id, contact_name, account_name, phone, outcome")
      .eq("session_id", session_id)
      .order("position", { ascending: true });

    const followUpContacts = filterContactsForFollowUp(sessionContacts || []);
    if (followUpContacts.length === 0) {
      return new Response(JSON.stringify({ error: "no_follow_up_contacts" }), { status: 400, headers });
    }

    const created = await insertSessionWithContacts(
      client,
      user.id,
      `Relance — ${sessionCheck.session.name}`,
      followUpContacts,
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

    await client
      .from("call_session_contacts")
      .update({ status: "skipped" })
      .eq("id", contact_id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
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

    await client
      .from("call_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", session_id);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
