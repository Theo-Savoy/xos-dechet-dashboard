/**
 * api/_auth.js — JWT verification helper for serverless endpoints.
 *
 * Usage:
 *   const user = await verifyJWT(request);
 *   if (!user) return respond(401, { error: "Unauthorized" });
 *
 * Validates a Supabase access token by calling GET /auth/v1/user.
 * Does NOT use the service role — uses the anon key.
 * Accepts token from Authorization: Bearer <token> header.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

/**
 * @param {Request} request
 * @returns {Promise<object|null>} user object from Supabase, or null
 */
export async function verifyJWT(request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("_auth: missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

/**
 * Helper: return a JSON response with given status.
 * @param {number} status
 * @param {object} body
 * @returns {Response}
 */
export function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
