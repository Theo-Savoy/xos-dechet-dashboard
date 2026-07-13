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

/** Libellés affichés Combo (équipe, filtre propriétaire) — prioritaire sur email / full_name incomplet. */
export const CALLS_TEAM_LABEL_BY_SF_ID = {
  "005AZ000000fLYkYAM": "Paul Rathouin",
  "0055I000002lY9QQAU": "Christophe Hirtz",
  "005b0000005zfnvAAA": "Jérôme Bosio",
  "005AZ000000X5nDYAS": "Théo Savoy",
  "005Sb000007b6dWIAQ": "Yanis Agharbi",
};

/**
 * Pas de comptes SF à leur nom — exclus du filtre propriétaire (Labo couvrira le reste).
 * Préfixes 15 car. Salesforce (alignés sf_user_map).
 */
export const CALLS_ACCOUNT_OWNER_EXCLUDED_SF_PREFIXES = [
  "005AZ000000X5nD", // Théo Savoy
  "005Sb000007b6dW", // Yanis Agharbi (SDR)
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

export function looksLikeSalesforceId(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^005[A-Za-z0-9]{12,17}$/.test(raw);
}

export function resolveCallsTeamLabel(sfUserId, fallbackLabel = "", email = "") {
  const key = sfIdKey(sfUserId);
  const override = Object.entries(CALLS_TEAM_LABEL_BY_SF_ID).find(([id]) => sfIdKey(id) === key)?.[1];
  if (override) return override;
  const fallback = String(fallbackLabel || "").trim();
  if (fallback && !fallback.includes("@") && !looksLikeSalesforceId(fallback)) return fallback;
  const local = String(email || (fallback.includes("@") ? fallback : "") || "").split("@")[0] || "";
  if (!local) return override || fallback || sfUserId;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function shouldUpgradeCallsTeamLabel(sfUserId, label) {
  if (hasCallsTeamLabelOverride(sfUserId)) return true;
  const current = String(label || "");
  return current.includes("@") || looksLikeSalesforceId(current);
}

export function hasCallsTeamLabelOverride(sfUserId) {
  const key = sfIdKey(sfUserId);
  return Object.keys(CALLS_TEAM_LABEL_BY_SF_ID).some((id) => sfIdKey(id) === key);
}

export function isCallsAccountOwnerCandidate(sfUserId) {
  if (!sfUserId) return false;
  const key = sfIdKey(sfUserId);
  return !CALLS_ACCOUNT_OWNER_EXCLUDED_SF_PREFIXES.some((prefix) => key.startsWith(sfIdKey(prefix)));
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
