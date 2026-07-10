import { verifyJWT, respond } from "./_auth.js";

/**
 * POST /api/sso-bridge — pont SSO → legacy.
 * Vérifie le JWT Supabase dans le header Authorization,
 * puis pose le cookie xos_auth pour compatibilité avec
 * l'iframe Cleaner et les APIs legacy.
 *
 * Répond 204 (pas de corps) avec Set-Cookie.
 * Si JWT invalide → 401.
 */

export async function POST(request) {
  const user = await verifyJWT(request);
  if (!user) {
    return respond(401, { error: "Unauthorized" });
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
