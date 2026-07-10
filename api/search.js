/**
 * api/search.js — SOSL multi-object search (Account, Contact, Opportunity).
 *
 * Vercel Fetch API handler (same pattern as api/sso-bridge.js).
 * Auth: JWT Supabase via api/_auth.js (Authorization Bearer header).
 * Cache: Cache-Control no-store on ALL responses (search is not cacheable).
 * Read-only: no Salesforce writes.
 *
 * SF Search REST API: GET /services/data/v67.0/search?q=<SOSL>
 */

import { verifyJWT, respond } from "./_auth.js";

/**
 * Escape SOSL reserved characters in a user query string.
 * SOSL reserves: ' " \ ? & ! ^ ~ * [ ] { } ( ) |
 * Braces ({}) are stripped (they represent SOSL set operators, not escapable).
 */
export function escapeSOSL(query) {
  return query
    .replace(/[{}]/g, "")
    .replace(/['"\\?&!^~*[\]()|+:-]/g, "\\$&");
}

/**
 * Build a Salesforce Lightning record URL from the record attributes.
 * Uses `attributes.url` (REST API path) when present to derive the instance host,
 * avoiding hardcoded URLs. Falls back to SF_INSTANCE_URL env.
 */
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

/**
 * Normalize raw SOSL searchRecords into a flat list.
 * Each result: { type, id, name, detail, recordUrl }
 */
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

/**
 * Fetch a Salesforce OAuth access token using the refresh token flow.
 * Exported for direct testing.
 */
export async function fetchSFToken() {
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
 * Execute a SOSL search against Salesforce (GET /search endpoint).
 * Exported for direct testing.
 */
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

/**
 * GET /api/search — SOSL multi-object search.
 * Query param: ?q=<search term> (min 2 characters)
 * Auth: Authorization: Bearer <supabase_jwt>
 */
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

  const escapedQuery = escapeSOSL(q);

  const tokenResult = await fetchSFToken();
  if (tokenResult.error) {
    return new Response(JSON.stringify({ error: tokenResult.error }), { status: 502, headers: noStore });
  }

  const searchResult = await searchSF(tokenResult.accessToken, escapedQuery);
  if (searchResult.error) {
    return new Response(JSON.stringify({ error: searchResult.error }), { status: 502, headers: noStore });
  }

  const results = normalizeSFResults(searchResult.records);

  return new Response(JSON.stringify({ error: null, results }), {
    status: 200,
    headers: noStore,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
