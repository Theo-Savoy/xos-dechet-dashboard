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
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTH_CACHE_MAX_ENTRIES = 200;
const authCache = new Map();

/** Test-only helper to clear the module-scope authentication cache. */
export function __resetAuthCache() {
  authCache.clear();
}

/**
 * @param {Request} request
 * @returns {Promise<object|null>} user object from Supabase, or null
 */
export async function verifyJWT(request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("_auth: missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return null;
  }

  const authHeader = typeof request.headers?.get === "function"
    ? request.headers.get("authorization")
    : request.headers?.authorization || request.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) return null;

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  if (cached) authCache.delete(token);

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) {
    return null;
  }

  const user = await res.json();
  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    authCache.delete(authCache.keys().next().value);
  }
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
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
