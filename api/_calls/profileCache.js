const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const profileCache = new Map();

/** Test-only helper to clear the module-scope profile cache. */
export function __resetProfileCache() {
  profileCache.clear();
}

export function invalidateProfileCache(userId) {
  profileCache.delete(userId);
}

export async function getProfile(client, userId) {
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  if (cached) profileCache.delete(userId);

  const { data, error } = await client
    .from("profiles")
    .select("sf_user_id, full_name, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: "profile_lookup_failed" };

  const profile = {
    sfUserId: data?.sf_user_id || null,
    fullName: data?.full_name || null,
    role: data?.role || "commercial",
  };
  profileCache.set(userId, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  return profile;
}
