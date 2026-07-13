/**
 * Tenant access bootstrap (XOS config).
 *
 * Product code only understands roles: commercial | manager | admin.
 * Which emails get which role at first login is tenant configuration —
 * replace this module (or later a `tenant_access` table) for another client.
 *
 * Hierarchy: admin > manager > commercial
 * - admin  : full Hub config, role management, all manager capabilities
 * - manager: team views, settings CRUD (seuils, exclusions), Arena challenges
 * - commercial: own data, own sessions, Hub status read-only
 *
 * Weekly Perf tracking modes (orthogonal to access roles):
 * - commercial : activité + ventes (défaut)
 * - sdr        : appels, RDV pris, opps détectées — pas de ventes
 * - dg         : signatures / CA signé seulement
 */

export const ROLES = ["commercial", "manager", "admin"];

/** @typedef {"commercial" | "manager" | "admin"} Role */
/** @typedef {"commercial" | "sdr" | "dg"} TrackingMode */

/**
 * Email → role overrides applied on profile create / login bootstrap.
 * Unlisted @domain users stay on the default role (`commercial`).
 */
export const ROLE_BOOTSTRAP_BY_EMAIL = {
  "theo.savoy@xos-learning.fr": "admin",
  "jerome.bosio@xos-learning.fr": "manager",
  "paul.rathouin@xos-learning.fr": "manager",
};

/**
 * SF User Id → mode de suivi Weekly Perf (surchargeable via settings.weekly_tracking).
 * IDs alignés sur sf_user_map (migration 013).
 */
export const WEEKLY_TRACKING_BY_SF_USER = {
  "005Sb000007b6dWIAQ": "sdr", // Yanis Agharbi
  "005b0000005zfnvAAA": "dg", // Jérôme Bosio
};

/** Commerciaux inactifs / hors rituel Weekly Perf (nom SF ou email). */
export const WEEKLY_EXCLUDED_NAME_PATTERNS = [
  /waeselynck/i, // Romain Waeselynck
  /^julien bak$/i,
  /^roxane s[eé]rie$/i,
  /^antoine fardet$/i,
  /ibrahima sissoko/i,
  /th[eé]o\s*savoy/i,
  /theo\.savoy/i,
];

export function roleFromEmail(email) {
  if (typeof email !== "string" || email === "") return "commercial";
  const key = email.trim().toLowerCase();
  return ROLE_BOOTSTRAP_BY_EMAIL[key] || "commercial";
}

/** Compare Salesforce IDs on the case-sensitive 15-char prefix (18-char checksum ignored). */
export function sfIdKey(id) {
  return String(id || "").slice(0, 15);
}

export function trackingModeFor(sfUserId, overrides = {}) {
  const key = sfIdKey(sfUserId);
  const fromOverride = Object.entries(overrides || {}).find(([id]) => sfIdKey(id) === key)?.[1];
  if (fromOverride === "sdr" || fromOverride === "dg" || fromOverride === "commercial") return fromOverride;
  const fromDefault = Object.entries(WEEKLY_TRACKING_BY_SF_USER).find(([id]) => sfIdKey(id) === key)?.[1];
  return fromDefault || "commercial";
}

/** Exclut les users SF inactifs et les profils hors rituel (Théo, anciens commerciaux…). */
export function isWeeklyOwnerExcluded(sfUser, nameFallback = "", emailFallback = "") {
  if (sfUser && sfUser.IsActive === false) return true;
  const name = String(sfUser?.Name || nameFallback || "");
  const email = String(sfUser?.Email || emailFallback || "");
  return WEEKLY_EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(email));
}

export function roleAtLeast(role, minimum) {
  const rank = { commercial: 1, manager: 2, admin: 3 };
  return (rank[role] || 0) >= (rank[minimum] || 99);
}

export function canManageSettings(role) {
  return roleAtLeast(role, "manager");
}

export function canManageRoles(role) {
  return roleAtLeast(role, "admin");
}

export function canViewTeamPerf(role) {
  return roleAtLeast(role, "manager");
}

/** Lundi : tout commercial mappé peut basculer Moi / Équipe (lecture seule). */
export function canViewWeeklyTeam(role) {
  return roleAtLeast(role, "commercial");
}
