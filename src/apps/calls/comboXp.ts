/** Modèle XP + paliers Combo. Pas d'UI, pas de notifs — voir docs/specs/combo-gamification-v1.md §1. */

import { todayParisIso } from "../../lib/dates";

export type ComboXpAxis = "vitesse" | "impact" | "regularite";

export type PalierId = "bronze" | "argent" | "or" | "platine" | "diamant" | "challenger";

export type ComboXpEventType = "shortcut" | "rdv" | "day-logged";

export interface ComboXp {
  vitesse: number;
  impact: number;
  regularite: number;
  badges: string[];
  lastSeen: string;
}

export interface AxePalier {
  axis: ComboXpAxis;
  palier: PalierId;
}

export interface ApplyEventResult {
  xp: ComboXp;
  previousXp: ComboXp;
  paliersFranchis: AxePalier[];
}

export interface ProgressToNext {
  current: PalierId | null;
  next: PalierId | null;
  pctToNext: number;
  valueToNext: number;
}

export const PALIER_ORDER: PalierId[] = ["bronze", "argent", "or", "platine", "diamant", "challenger"];

/**
 * BUG-03 : l'axe Impact stocke des XP (10 par RDV, spec §1.1), pas un compteur
 * de RDV brut — les seuils ci-dessous sont donc les seuils "RDV cumulés" de la
 * spec §1.3 multipliés par IMPACT_XP_PER_RDV (3→30, 7→70, 15→150, 30→300,
 * 60→600, 100→1000).
 */
export const PALIERS: Record<ComboXpAxis, Record<PalierId, number>> = {
  vitesse: { bronze: 10, argent: 30, or: 75, platine: 150, diamant: 300, challenger: 500 },
  impact: { bronze: 30, argent: 70, or: 150, platine: 300, diamant: 600, challenger: 1000 },
  regularite: { bronze: 3, argent: 7, or: 14, platine: 30, diamant: 60, challenger: 100 },
};

const AXES: ComboXpAxis[] = ["vitesse", "impact", "regularite"];

const EVENT_AXIS: Record<ComboXpEventType, ComboXpAxis> = {
  shortcut: "vitesse",
  rdv: "impact",
  "day-logged": "regularite",
};

/** XP par unité de `qty` — un RDV vaut 10 XP Impact (spec §1.1), les autres événements 1:1. */
export const IMPACT_XP_PER_RDV = 10;

const EVENT_XP_MULTIPLIER: Record<ComboXpEventType, number> = {
  shortcut: 1,
  rdv: IMPACT_XP_PER_RDV,
  "day-logged": 1,
};

function xpStorageKey(userId: string): string {
  return `xos-combo-xp:${userId}`;
}

function emptyXp(): ComboXp {
  return { vitesse: 0, impact: 0, regularite: 0, badges: [], lastSeen: "" };
}

export function loadXp(userId: string): ComboXp {
  try {
    const raw = window.localStorage?.getItem(xpStorageKey(userId));
    if (!raw) return emptyXp();
    const parsed = JSON.parse(raw) as Partial<ComboXp>;
    return {
      vitesse: typeof parsed.vitesse === "number" ? parsed.vitesse : 0,
      impact: typeof parsed.impact === "number" ? parsed.impact : 0,
      regularite: typeof parsed.regularite === "number" ? parsed.regularite : 0,
      badges: Array.isArray(parsed.badges) ? parsed.badges : [],
      lastSeen: typeof parsed.lastSeen === "string" ? parsed.lastSeen : "",
    };
  } catch {
    return emptyXp();
  }
}

export function saveXp(userId: string, xp: ComboXp): void {
  try {
    window.localStorage?.setItem(xpStorageKey(userId), JSON.stringify(xp));
  } catch {
    /* ignore */
  }
}

export function currentPalier(axis: ComboXpAxis, value: number): PalierId | null {
  let reached: PalierId | null = null;
  for (const palier of PALIER_ORDER) {
    if (value >= PALIERS[axis][palier]) reached = palier;
  }
  return reached;
}

export function progressToNext(axis: ComboXpAxis, value: number): ProgressToNext {
  const current = currentPalier(axis, value);
  const currentIndex = current ? PALIER_ORDER.indexOf(current) : -1;
  const next = currentIndex + 1 < PALIER_ORDER.length ? PALIER_ORDER[currentIndex + 1] : null;

  if (!next) {
    return { current, next: null, pctToNext: 100, valueToNext: 0 };
  }

  const previousThreshold = current ? PALIERS[axis][current] : 0;
  const nextThreshold = PALIERS[axis][next];
  const span = nextThreshold - previousThreshold;
  const pctToNext = span > 0 ? Math.max(0, Math.min(100, ((value - previousThreshold) / span) * 100)) : 100;

  return { current, next, pctToNext, valueToNext: Math.max(0, nextThreshold - value) };
}

export function detectPaliers(previousXp: ComboXp, newXp: ComboXp): AxePalier[] {
  const crossed: AxePalier[] = [];
  for (const axis of AXES) {
    for (const palier of PALIER_ORDER) {
      const threshold = PALIERS[axis][palier];
      if (previousXp[axis] < threshold && newXp[axis] >= threshold) {
        crossed.push({ axis, palier });
      }
    }
  }
  return crossed;
}

function dedupeStorageKey(userId: string): string {
  return `xos-combo-xp-dedupe:${userId}`;
}

function loadDedupeSet(userId: string): Set<string> {
  try {
    const raw = window.localStorage?.getItem(dedupeStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveDedupeSet(userId: string, set: Set<string>): void {
  try {
    window.localStorage?.setItem(dedupeStorageKey(userId), JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

/** BUG-02 : lit le Set de déduplication persisté pour `userId` — `dedupeKey` identifie une action déjà comptée. */
export function hasEventRecorded(userId: string, dedupeKey: string): boolean {
  return loadDedupeSet(userId).has(dedupeKey);
}

function markEventRecorded(userId: string, dedupeKey: string): void {
  const set = loadDedupeSet(userId);
  set.add(dedupeKey);
  saveDedupeSet(userId, set);
}

export interface ApplyEventOptions {
  /** Identifiant métier de l'action (ex. le raccourci utilisé) — requis pour dédupliquer Vitesse. */
  actionId?: string;
  /** Jour Europe/Paris (YYYY-MM-DD) de l'événement ; par défaut aujourd'hui. */
  dateParis?: string;
}

/**
 * BUG-02 : anti-abus — Vitesse ne peut être créditée qu'une fois par
 * {userId, actionId, dateParis} (empêche de matraquer le même raccourci pour
 * farmer de l'XP), Régularité qu'une fois par {userId, dateParis} (un seul
 * crédit "jour loggé" par jour). Impact n'est pas dédupliqué ici : chaque
 * crédit correspond à un RDV réellement créé côté Salesforce.
 */
function buildDedupeKey(axis: ComboXpAxis, options: ApplyEventOptions): string | null {
  const dateParis = options.dateParis ?? todayParisIso();
  if (axis === "regularite") return `regularite:${dateParis}`;
  if (axis === "vitesse" && options.actionId) return `vitesse:${options.actionId}:${dateParis}`;
  return null;
}

export function applyEvent(
  userId: string,
  event: ComboXpEventType,
  qty = 1,
  options: ApplyEventOptions = {},
): ApplyEventResult {
  const previousXp = loadXp(userId);
  const axis = EVENT_AXIS[event];

  const dedupeKey = buildDedupeKey(axis, options);
  if (dedupeKey && hasEventRecorded(userId, dedupeKey)) {
    return { xp: previousXp, previousXp, paliersFranchis: [] };
  }

  const xpGain = qty * EVENT_XP_MULTIPLIER[event];
  const newXp: ComboXp = { ...previousXp, [axis]: previousXp[axis] + xpGain, lastSeen: new Date().toISOString() };

  const paliersFranchis = detectPaliers(previousXp, newXp);
  saveXp(userId, newXp);
  if (dedupeKey) markEventRecorded(userId, dedupeKey);

  return { xp: newXp, previousXp, paliersFranchis };
}
