/**
 * Mode de suivi Weekly / Combo (aligné sur api/_config/access.js).
 * Yanis = SDR → RDV attribués à un commercial, pas à soi.
 */

export type CallerTracking = "commercial" | "sdr" | "dg";

const TRACKING_BY_SF_USER: Record<string, CallerTracking> = {
  "005Sb000007b6dW": "sdr", // Yanis Agharbi
  "005b0000005zfnv": "dg", // Jérôme Bosio
};

function sfIdKey(id: string): string {
  return String(id || "").slice(0, 15);
}

export function trackingModeFor(sfUserId: string | null | undefined): CallerTracking {
  if (!sfUserId) return "commercial";
  const key = sfIdKey(sfUserId);
  const hit = Object.entries(TRACKING_BY_SF_USER).find(([id]) => sfIdKey(id) === key)?.[1];
  return hit || "commercial";
}

export function isSdrCaller(sfUserId: string | null | undefined): boolean {
  return trackingModeFor(sfUserId) === "sdr";
}

/** Commerciaux à qui un SDR peut attribuer un RDV (exclut SDR / DG). */
export function isRdvAssigneeCandidate(sfUserId: string): boolean {
  return trackingModeFor(sfUserId) === "commercial";
}
