/**
 * Filtre propriétaire du compte — aligné sur api/_config/access.js
 * (Théo / Yanis exclus ; Christophe libellé côté API équipe).
 */

const EXCLUDED_SF_PREFIXES = [
  "005AZ000000X5nD", // Théo Savoy
  "005Sb000007b6dW", // Yanis Agharbi (SDR)
];

function sfIdKey(id: string): string {
  return String(id || "").slice(0, 15);
}

export function isAccountOwnerFilterCandidate(sfUserId: string): boolean {
  const key = sfIdKey(sfUserId);
  return !EXCLUDED_SF_PREFIXES.some((prefix) => key.startsWith(sfIdKey(prefix)));
}
