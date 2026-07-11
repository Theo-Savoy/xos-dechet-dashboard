import { verifyJWT, respond } from "./_auth.js";
import { getServiceClient } from "./_calls/http.js";
import { completeSalesforceOAuth, startSalesforceOAuth, storeSalesforceRefreshToken } from "./_crm/salesforceOAuth.js";

/**
 * POST /api/auth — pont SSO → legacy.
 * GET /api/auth?flow=salesforce — stub OAuth Salesforce.
 */
export async function POST(request) {
  const user = await verifyJWT(request);
  if (!user) {
    return respond(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("flow") === "salesforce-link") {
    const client = getServiceClient();
    if (!client) return respond(500, { error: "server_error" });
    const result = await startSalesforceOAuth({ client, user, origin: url.origin });
    if (result.error) return respond(502, { error: result.error });
    return respond(200, { authorization_url: result.authorizationUrl });
  }

  let body = null;
  try { body = await request.json(); } catch { body = null; }
  if (typeof body?.salesforce_refresh_token === "string" && body.salesforce_refresh_token) {
    const client = getServiceClient();
    if (client) {
      const result = await storeSalesforceRefreshToken({
        client,
        user,
        refreshToken: body.salesforce_refresh_token,
      });
      if (result.error) console.error(`Salesforce automatic link failed: ${result.error}`);
    }
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return respond(500, { error: "Server misconfiguration: DASHBOARD_PASSWORD not set" });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `xos_auth=${password}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("flow") === "salesforce-callback") {
    const redirect = new URL("/", url.origin);
    if (url.searchParams.get("error")) {
      redirect.searchParams.set("auth_error", "oauth_denied");
      return Response.redirect(redirect.toString(), 302);
    }
    const client = getServiceClient();
    if (!client) {
      redirect.searchParams.set("auth_error", "server_error");
      return Response.redirect(redirect.toString(), 302);
    }
    const result = await completeSalesforceOAuth({ client, url });
    if (result.error) redirect.searchParams.set("auth_error", result.error);
    else redirect.searchParams.set("sf_link", "success");
    return Response.redirect(redirect.toString(), 302);
  }
  if (url.searchParams.get("flow") === "salesforce") {
    const redirect = new URL("/", url.origin);
    redirect.searchParams.set("auth_error", "sf_coming_soon");
    return Response.redirect(redirect.toString(), 302);
  }

  return new Response(JSON.stringify({ error: "invalid_flow" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
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
