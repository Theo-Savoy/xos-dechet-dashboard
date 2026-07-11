/**
 * GET /api/launcher — SOSL multi-object search.
 * POST /api/launcher — log_call and create_contact actions.
 */

import { verifyJWT } from "./_auth.js";
import { getProfile } from "./_calls/profileCache.js";
import { getServiceClient, journalAction } from "./_calls/http.js";
import { createRecord, fetchSFToken } from "./_crm/salesforce.js";

export { fetchSFToken };

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function escapeSOSL(query) {
  return query
    .replace(/[{}]/g, "")
    .replace(/['"\\?&!^~*[\]()|+:-]/g, "\\$&");
}

function buildRecordUrl(record) {
  const id = record.Id;
  const type = record.attributes?.type;
  if (!id || !type) return null;

  const attrUrl = record.attributes?.url;
  if (attrUrl) {
    const baseUrl = attrUrl.split("/services/data/")[0];
    if (baseUrl) return `${baseUrl}/lightning/r/${type}/${id}/view`;
  }

  const instanceUrl =
    process.env.SF_INSTANCE_URL || "https://login.salesforce.com";
  return `${instanceUrl}/lightning/r/${type}/${id}/view`;
}

export function normalizeSFResults(records) {
  if (!Array.isArray(records)) return [];

  return records
    .filter(
      (r) => r?.attributes?.type && typeof r.Id === "string" && r.Id.length > 0,
    )
    .map((r) => {
      const type = r.attributes.type;
      const base = { type, id: r.Id, recordUrl: buildRecordUrl(r) };

      if (type === "Account") {
        return {
          ...base,
          name: r.Name || "",
          detail: [r.Industry, r.Owner?.Name].filter(Boolean).join(" · "),
        };
      }
      if (type === "Contact") {
        const fullName = [r.FirstName, r.LastName].filter(Boolean).join(" ");
        return {
          ...base,
          name: fullName,
          detail: [r.Title, r.Account?.Name].filter(Boolean).join(" · "),
        };
      }
      if (type === "Opportunity") {
        const amount =
          r.Amount != null
            ? new Intl.NumberFormat("fr-FR").format(r.Amount) + " €"
            : null;
        return {
          ...base,
          name: r.Name || "",
          detail: [r.StageName, amount, r.Account?.Name]
            .filter(Boolean)
            .join(" · "),
        };
      }

      return null;
    })
    .filter(Boolean);
}

/** Attribution best-effort : OwnerId = User SF du commercial si son profil est mappé. */
async function lookupSfOwnerId(userId) {
  try {
    const client = getServiceClient();
    if (!client) return null;
    const profile = await getProfile(client, userId);
    return !profile.error && profile.sfUserId ? profile.sfUserId : null;
  } catch {
    return null;
  }
}

export async function searchSF(accessToken, escapedQuery) {
  const instanceUrl =
    process.env.SF_INSTANCE_URL || "https://login.salesforce.com";

  const sosl =
    `FIND {${escapedQuery}} IN ALL FIELDS ` +
    `RETURNING Account(Id, Name, Phone, Industry, Owner.Name ` +
    `ORDER BY Name LIMIT 25), ` +
    `Contact(Id, FirstName, LastName, Email, Title, Account.Name, Owner.Name ` +
    `ORDER BY LastName LIMIT 25), ` +
    `Opportunity(Id, Name, Amount, StageName, CloseDate, Account.Name, Owner.Name ` +
    `ORDER BY Name LIMIT 25)`;

  const searchUrl =
    instanceUrl +
    "/services/data/v67.0/search?" +
    new URLSearchParams({ q: sosl });

  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(30_000),
  });

  if (!searchResp.ok) {
    return { error: "sf_search_error" };
  }

  return { records: (await searchResp.json()).searchRecords };
}

export async function GET(request) {
  const noStore = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  const user = await verifyJWT(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: noStore });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return new Response(JSON.stringify({ error: "invalid_query" }), { status: 400, headers: noStore });
  }

  const tokenResult = await fetchSFToken();
  if (tokenResult.error) {
    return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers: noStore });
  }

  const searchResult = await searchSF(tokenResult.accessToken, escapeSOSL(q));
  if (searchResult.error) {
    return new Response(JSON.stringify({ error: searchResult.error }), { status: 502, headers: noStore });
  }

  return new Response(JSON.stringify({ error: null, results: normalizeSFResults(searchResult.records) }), {
    status: 200,
    headers: noStore,
  });
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

  if (action === "log_call") {
    const { recordId, recordType, comments } = body;
    if (!recordId || typeof recordId !== "string" || !SF_ID.test(recordId)) {
      return new Response(JSON.stringify({ error: "invalid_record_id" }), { status: 400, headers });
    }
    if (!["Account", "Contact", "Opportunity"].includes(recordType)) {
      return new Response(JSON.stringify({ error: "invalid_record_type" }), { status: 400, headers });
    }
    if (!comments || typeof comments !== "string" || comments.trim().length === 0) {
      return new Response(JSON.stringify({ error: "missing_comments" }), { status: 400, headers });
    }

    const tokenResult = await fetchSFToken({ client: getServiceClient(), userId: user.id });
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

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

    if (recordType === "Contact") taskFields.WhoId = recordId;
    else taskFields.WhatId = recordId;

    const sfOwnerId = await lookupSfOwnerId(user.id);
    if (sfOwnerId) taskFields.OwnerId = sfOwnerId;

    const sfResult = await createRecord(tokenResult.accessToken, "Task", taskFields);
    if (sfResult.error) {
      return new Response(
        JSON.stringify({ error: "sf_task_creation_failed", message: sfResult.message }),
        { status: 502, headers },
      );
    }

    const taskId = sfResult.record.id;
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
    const lastName = typeof _ln === "string" ? _ln.trim() : _ln;
    const firstName = typeof _fn === "string" ? _fn.trim() || undefined : _fn;
    const email = typeof _em === "string" ? _em.trim() || undefined : _em;
    const phone = typeof _ph === "string" ? _ph.trim() || undefined : _ph;
    const accountId = typeof _ac === "string" ? _ac.trim() || undefined : _ac;

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

    const tokenResult = await fetchSFToken({ client: getServiceClient(), userId: user.id });
    if (tokenResult.error) {
      return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers });
    }

    const contactFields = { LastName: lastName };
    if (firstName) contactFields.FirstName = firstName;
    if (email) contactFields.Email = email;
    if (phone) contactFields.Phone = phone;
    if (accountId) contactFields.AccountId = accountId;

    const sfOwnerId = await lookupSfOwnerId(user.id);
    if (sfOwnerId) contactFields.OwnerId = sfOwnerId;

    const sfResult = await createRecord(tokenResult.accessToken, "Contact", contactFields);
    if (sfResult.error) {
      return new Response(
        JSON.stringify({ error: "sf_contact_creation_failed", message: sfResult.message }),
        { status: 502, headers },
      );
    }

    const contactId = sfResult.record.id;
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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
