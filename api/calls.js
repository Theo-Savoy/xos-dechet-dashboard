import { createClient } from "@supabase/supabase-js";
import { verifyJWT, respond } from "./_auth.js";

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const VALID_OUTCOMES = ["answered", "no_answer", "callback", "not_interested", "wrong_number"];

const OUTCOME_LABELS = {
  answered: "Répondu",
  no_answer: "Sans réponse",
  callback: "Rappel",
  not_interested: "Pas intéressé",
  wrong_number: "Mauvais numéro",
};

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function fetchSFToken() {
  const clientId = process.env.SF_CLIENT_ID || "";
  const clientSecret = process.env.SF_CLIENT_SECRET || "";
  const refreshToken = process.env.SF_REFRESH_TOKEN || "";
  const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";

  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "sf_missing_credentials" };
  }

  const tokenResp = await fetch(loginUrl + "/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!tokenResp.ok) {
    return { error: "sf_auth_error" };
  }

  return { accessToken: (await tokenResp.json()).access_token };
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

    const sessionIds = (userSessions || []).map((s) => s.id);

    let sessionsActive = 0;
    let sessionsCompleted = 0;
    for (const s of userSessions || []) {
      const { data: sdata } = await client
        .from("call_sessions")
        .select("status")
        .eq("id", s.id)
        .single();
      if (sdata) {
        if (sdata.status === "active") sessionsActive++;
        else if (sdata.status === "completed") sessionsCompleted++;
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
      for (const c of calls || []) {
        const called = new Date(c.called_at);
        if (called >= todayStart) callsToday++;
        if (called >= weekStart) callsWeek++;
      }
    }

    return new Response(
      JSON.stringify({
        stats: { calls_today: callsToday, calls_week: callsWeek, sessions_active: sessionsActive, sessions_completed: sessionsCompleted },
      }),
      { status: 200, headers }
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
      .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, status, outcome, comments, sf_task_id, called_at")
      .eq("session_id", sessionId)
      .order("position", { ascending: true });

    const { owner, ...sessionData } = session;
    return new Response(
      JSON.stringify({ session: sessionData, contacts: contacts || [] }),
      { status: 200, headers }
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

  const allSessionIds = sessions.map((s) => s.id);
  const { data: allContacts } = await client
    .from("call_session_contacts")
    .select("session_id, status")
    .in("session_id", allSessionIds);

  const grouped = {};
  for (const c of allContacts || []) {
    if (!grouped[c.session_id]) {
      grouped[c.session_id] = { total: 0, called: 0, skipped: 0, pending: 0 };
    }
    grouped[c.session_id].total++;
    grouped[c.session_id][c.status]++;
  }

  const result = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    created_at: s.created_at,
    ...(grouped[s.id] || { total: 0, called: 0, skipped: 0, pending: 0 }),
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

  const instanceUrl = process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com";

  if (action === "create_session") {
    const { name, contacts } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers });
    }
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
    }
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (!c || typeof c !== "object") {
        return new Response(JSON.stringify({ error: "invalid_contacts" }), { status: 400, headers });
      }
      if (!c.sf_contact_id || typeof c.sf_contact_id !== "string" || !SF_ID.test(c.sf_contact_id)) {
        return new Response(JSON.stringify({ error: "invalid_sf_contact_id" }), { status: 400, headers });
      }
      if (!c.contact_name || typeof c.contact_name !== "string" || c.contact_name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "invalid_contact_name" }), { status: 400, headers });
      }
      if (c.sf_account_id !== undefined && c.sf_account_id !== null && (typeof c.sf_account_id !== "string" || !SF_ID.test(c.sf_account_id))) {
        return new Response(JSON.stringify({ error: "invalid_sf_account_id" }), { status: 400, headers });
      }
    }

    const { data: session } = await client
      .from("call_sessions")
      .insert({ owner: user.id, name: name.trim(), status: "active" })
      .select("id, name, status, created_at")
      .single();

    if (!session) {
      return new Response(JSON.stringify({ error: "session_creation_failed" }), { status: 500, headers });
    }

    const contactRows = contacts.map((c, idx) => ({
      session_id: session.id,
      position: idx,
      sf_contact_id: c.sf_contact_id,
      sf_account_id: c.sf_account_id || null,
      contact_name: c.contact_name.trim(),
      account_name: c.account_name || null,
      phone: c.phone || null,
      status: "pending",
    }));

    const { data: insertedContacts } = await client
      .from("call_session_contacts")
      .insert(contactRows)
      .select("id, position, sf_contact_id, sf_account_id, contact_name, account_name, phone, status, outcome, comments, sf_task_id, called_at")
      .order("position", { ascending: true });

    return new Response(
      JSON.stringify({ session, contacts: insertedContacts || [] }),
      { status: 200, headers }
    );
  }

  if (action === "log_call") {
    const { session_id, contact_id, outcome, comments } = body;

    if (typeof session_id !== "number" || !Number.isInteger(session_id) || session_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_session_id" }), { status: 400, headers });
    }
    if (typeof contact_id !== "number" || !Number.isInteger(contact_id) || contact_id < 1) {
      return new Response(JSON.stringify({ error: "invalid_contact_id" }), { status: 400, headers });
    }
    if (!VALID_OUTCOMES.includes(outcome)) {
      return new Response(JSON.stringify({ error: "invalid_outcome" }), { status: 400, headers });
    }
    if (comments !== undefined && typeof comments !== "string") {
      return new Response(JSON.stringify({ error: "invalid_comments" }), { status: 400, headers });
    }

    const { data: session } = await client
      .from("call_sessions")
      .select("id, owner, name")
      .eq("id", session_id)
      .single();

    if (!session) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }
    if (session.owner !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const { data: contact } = await client
      .from("call_session_contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    if (!contact || contact.session_id !== session_id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const tokenResult = await fetchSFToken();
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }
    const accessToken = tokenResult.accessToken;

    const userFullName = user.user_metadata?.full_name || user.email || "Utilisateur Inconnu";
    const callComments = comments || "";
    const decoratedDescription = `${callComments}\n\n[via X OS par ${userFullName}]`;
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

    const taskFields = {
      Subject: `Appel — ${OUTCOME_LABELS[outcome] || outcome}`,
      Description: decoratedDescription,
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: today,
      WhoId: contact.sf_contact_id,
    };
    if (contact.sf_account_id) {
      taskFields.WhatId = contact.sf_account_id;
    }

    const sfResp = await fetch(`${instanceUrl}/services/data/v67.0/sobjects/Task`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(taskFields),
      signal: AbortSignal.timeout(30_000),
    });

    if (!sfResp.ok) {
      const errText = await sfResp.text();
      return new Response(
        JSON.stringify({ error: "sf_task_creation_failed", message: errText.slice(0, 500) }),
        { status: 502, headers }
      );
    }

    const sfResult = await sfResp.json();
    const taskId = sfResult.id;

    await client
      .from("call_session_contacts")
      .update({
        status: "called",
        outcome,
        comments: callComments || null,
        sf_task_id: taskId,
        called_at: new Date().toISOString(),
      })
      .eq("id", contact_id);

    await journalAction({
      actorId: user.id,
      actionType: "call_session_log",
      changes: { outcome, comments: callComments },
      targets: [{ id: contact.sf_contact_id, type: "Contact", session_contact_id: contact_id, session_id }],
      result: { success: true, taskId },
    });

    return new Response(
      JSON.stringify({ success: true, taskId, contact_id }),
      { status: 200, headers }
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

    const { data: session } = await client
      .from("call_sessions")
      .select("id, owner")
      .eq("id", session_id)
      .single();

    if (!session || session.owner !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const { data: contact } = await client
      .from("call_session_contacts")
      .select("id, session_id")
      .eq("id", contact_id)
      .single();

    if (!contact || contact.session_id !== session_id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
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

    const { data: session } = await client
      .from("call_sessions")
      .select("id, owner, status")
      .eq("id", session_id)
      .single();

    if (!session || session.owner !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    if (session.status === "completed") {
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
