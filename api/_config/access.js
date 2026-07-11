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
 */

export const ROLES = ["commercial", "manager", "admin"];

/** @typedef {"commercial" | "manager" | "admin"} Role */

/**
 * Email → role overrides applied on profile create / login bootstrap.
 * Unlisted @domain users stay on the default role (`commercial`).
 */
export const ROLE_BOOTSTRAP_BY_EMAIL = {
  "theo.savoy@xos-learning.fr": "admin",
  "jerome.bosio@xos-learning.fr": "manager",
  "paul.rathouin@xos-learning.fr": "manager",
};

export function roleFromEmail(email) {
  if (typeof email !== "string" || !email) return "commercial";
  const key = email.trim().toLowerCase();
  return ROLE_BOOTSTRAP_BY_EMAIL[key] || "commercial";
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
