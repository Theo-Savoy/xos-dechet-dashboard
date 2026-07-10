import { createClient } from "@supabase/supabase-js";
import { verifyJWT, respond } from "./_auth.js";

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fetch a Salesforce OAuth access token using the refresh token flow.
 */
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

/**
 * Write action to the action_journal.
 */
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

/**
 * POST /api/log
 * Actions:
 * - log_call: Create completed Task SF.
 * - create_contact: Create Contact SF.
 */
export async function POST(request) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  // 1. Verify JWT
  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  // 2. Parse body
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  }

  const action = body.action;
  if (!action) {
    return new Response(JSON.stringify({ error: "missing_action" }), { status: 400, headers });
  }

  const instanceUrl = process.env.SF_INSTANCE_URL || "https://db0000000d7rdeay.my.salesforce.com";

  // 3. Handle Actions & Validation first (before SF network requests)
  if (action === "log_call") {
    const { recordId, recordType, comments } = body;

    // Validation
    if (!recordId || typeof recordId !== "string" || !SF_ID.test(recordId)) {
      return new Response(JSON.stringify({ error: "invalid_record_id" }), { status: 400, headers });
    }
    if (!["Account", "Contact", "Opportunity"].includes(recordType)) {
      return new Response(JSON.stringify({ error: "invalid_record_type" }), { status: 400, headers });
    }
    if (!comments || typeof comments !== "string" || comments.trim().length === 0) {
      return new Response(JSON.stringify({ error: "missing_comments" }), { status: 400, headers });
    }

    // Salesforce Authenticate
    const tokenResult = await fetchSFToken();
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }
    const accessToken = tokenResult.accessToken;

    const userFullName = user.user_metadata?.full_name || user.email || "Utilisateur Inconnu";
    const decoratedDescription = `${comments}\n\n[via X OS par ${userFullName}]`;
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

    const taskFields = {
      Subject: "Note d'appel",
      Description: decoratedDescription,
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: today,
    };

    if (recordType === "Contact") {
      taskFields.WhoId = recordId;
    } else {
      taskFields.WhatId = recordId;
    }

    // Salesforce write
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

    // Journal write
    await journalAction({
      actorId: user.id,
      actionType: "log_call",
      changes: { comments },
      targets: [{ id: recordId, type: recordType }],
      result: { success: true, taskId },
    });

    return new Response(JSON.stringify({ error: null, success: true, taskId }), { status: 200, headers });
  }

  if (action === "create_contact") {
    const { firstName: _fn, lastName: _ln, email: _em, phone: _ph, accountId: _ac } = body;

    // Normalize: trim strings; map empty trimmed optionals to undefined
    const lastName = typeof _ln === "string" ? _ln.trim() : _ln;
    const firstName = typeof _fn === "string" ? _fn.trim() || undefined : _fn;
    const email = typeof _em === "string" ? _em.trim() || undefined : _em;
    const phone = typeof _ph === "string" ? _ph.trim() || undefined : _ph;
    const accountId = typeof _ac === "string" ? _ac.trim() || undefined : _ac;

    // Validation
    if (!lastName || typeof lastName !== "string" || lastName.length === 0) {
      return new Response(JSON.stringify({ error: "missing_last_name" }), { status: 400, headers });
    }
    if (firstName !== undefined && typeof firstName !== "string") {
      return new Response(JSON.stringify({ error: "invalid_first_name" }), { status: 400, headers });
    }
    if (phone !== undefined && typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "invalid_phone" }), { status: 400, headers });
    }
    if (email && (typeof email !== "string" || !EMAIL_REGEX.test(email))) {
      return new Response(JSON.stringify({ error: "invalid_email" }), { status: 400, headers });
    }
    if (accountId && (typeof accountId !== "string" || !SF_ID.test(accountId))) {
      return new Response(JSON.stringify({ error: "invalid_account_id" }), { status: 400, headers });
    }

    // Salesforce Authenticate
    const tokenResult = await fetchSFToken();
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }
    const accessToken = tokenResult.accessToken;

    const contactFields = {
      LastName: lastName,
    };
    if (firstName) contactFields.FirstName = firstName;
    if (email) contactFields.Email = email;
    if (phone) contactFields.Phone = phone;
    if (accountId) contactFields.AccountId = accountId;

    // Salesforce write
    const sfResp = await fetch(`${instanceUrl}/services/data/v67.0/sobjects/Contact`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contactFields),
      signal: AbortSignal.timeout(30_000),
    });

    if (!sfResp.ok) {
      const errText = await sfResp.text();
      return new Response(
        JSON.stringify({ error: "sf_contact_creation_failed", message: errText.slice(0, 500) }),
        { status: 502, headers }
      );
    }

    const sfResult = await sfResp.json();
    const contactId = sfResult.id;

    // Journal write
    await journalAction({
      actorId: user.id,
      actionType: "create_contact",
      changes: { firstName: _fn, lastName: _ln, email: _em, phone: _ph, accountId: _ac },
      targets: [{ id: contactId, type: "Contact" }],
      result: { success: true, contactId },
    });

    return new Response(JSON.stringify({ error: null, success: true, contactId }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers });
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

