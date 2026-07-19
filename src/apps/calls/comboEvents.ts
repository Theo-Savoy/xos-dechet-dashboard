/**
 * BUG-01 : orchestrateur post-succès unique qui branche les moteurs
 * XP/badges/streaks/nudge learning aux événements réels du produit. Logique
 * pure — pas de hooks React ici (voir CallManagerApp.tsx / RunnerView.tsx
 * pour le câblage UI). Voir docs/audits/audit-gamification-coherence-2026-07-18.md#BUG-01.
 */

import { todayParisIso } from "../../lib/dates";
import { checkBadges, type BadgeCheckInput, type BadgeId } from "./comboBadges";
import { computeIntenseStreak, computeProductifStreak, computeStreak, saveStreaks, type ComboStreaksState } from "./comboStreaks";
import { applyEvent, loadXp, saveXp, type ApplyEventResult } from "./comboXp";
import { markAdopted, type ShortcutId } from "./nudgeLearning";

const engineKey = (userId: string) => `xos-combo-engine:${userId}`;

type EngineState = {
  logDates: string[];
  sessionRdvHistory: number[];
  sessionCallHistory: number[];
  sessionsCompletedCount: number;
  npaTotal: number;
  shortcutsToday: { date: string; count: number };
};

const EMPTY_ENGINE_STATE: EngineState = {
  logDates: [],
  sessionRdvHistory: [],
  sessionCallHistory: [],
  sessionsCompletedCount: 0,
  npaTotal: 0,
  shortcutsToday: { date: "", count: 0 },
};

/** Combien d'entrées d'historique on garde par utilisateur — largement assez pour les streaks composites. */
const MAX_HISTORY = 200;

function loadEngineState(userId: string): EngineState {
  try {
    const raw = window.localStorage?.getItem(engineKey(userId));
    if (!raw) return { ...EMPTY_ENGINE_STATE };
    const parsed = JSON.parse(raw) as Partial<EngineState>;
    return {
      logDates: Array.isArray(parsed.logDates) ? parsed.logDates : [],
      sessionRdvHistory: Array.isArray(parsed.sessionRdvHistory) ? parsed.sessionRdvHistory : [],
      sessionCallHistory: Array.isArray(parsed.sessionCallHistory) ? parsed.sessionCallHistory : [],
      sessionsCompletedCount:
        typeof parsed.sessionsCompletedCount === "number" ? parsed.sessionsCompletedCount : 0,
      npaTotal: typeof parsed.npaTotal === "number" ? parsed.npaTotal : 0,
      shortcutsToday:
        parsed.shortcutsToday && typeof parsed.shortcutsToday.date === "string"
          ? { date: parsed.shortcutsToday.date, count: parsed.shortcutsToday.count || 0 }
          : { date: "", count: 0 },
    };
  } catch {
    return { ...EMPTY_ENGINE_STATE };
  }
}

function saveEngineState(userId: string, state: EngineState): void {
  try {
    window.localStorage?.setItem(engineKey(userId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Idempotence orchestrateur : deux appels du même événement dans la même
 * seconde ne déclenchent rien (anti-abus, ex. double événement clavier
 * capture+bubble). Garde en mémoire uniquement — n'a pas vocation à
 * persister entre rechargements de page.
 */
const lastCallAtMs = new Map<string, number>();

function isDuplicateWithinSecond(key: string): boolean {
  const now = Date.now();
  const last = lastCallAtMs.get(key);
  lastCallAtMs.set(key, now);
  return last !== undefined && now - last < 1000;
}

/** Réservé aux tests : vide la garde anti-doublon en mémoire entre deux cas de test. */
export function __resetComboEventsInternals(): void {
  lastCallAtMs.clear();
}

/** Raccourci qualifié : crédite Vitesse (dédupliqué par raccourci+jour, BUG-02) et marque le raccourci adopté (BUG-06). */
export function recordShortcut(userId: string, shortcutId: ShortcutId): ApplyEventResult | null {
  if (!userId) return null;
  if (isDuplicateWithinSecond(`${userId}:shortcut:${shortcutId}`)) return null;

  const engine = loadEngineState(userId);
  const today = todayParisIso();
  engine.shortcutsToday =
    engine.shortcutsToday.date === today
      ? { date: today, count: engine.shortcutsToday.count + 1 }
      : { date: today, count: 1 };
  saveEngineState(userId, engine);

  const result = applyEvent(userId, "shortcut", 1, { actionId: shortcutId });
  markAdopted(shortcutId, userId);
  return result;
}

/** RDV planifié avec succès côté Salesforce : crédite Impact (10 XP, BUG-03). `source` identifie l'appelant (ex. le flux de log). */
export function recordRdv(userId: string, source: string): ApplyEventResult | null {
  if (!userId) return null;
  if (isDuplicateWithinSecond(`${userId}:rdv:${source}`)) return null;

  const engine = loadEngineState(userId);
  engine.sessionRdvHistory = [...engine.sessionRdvHistory, 1].slice(-MAX_HISTORY);
  saveEngineState(userId, engine);

  return applyEvent(userId, "rdv", 1, { actionId: source });
}

/** `log_call` réussi : crédite Régularité (1 crédit par jour Europe/Paris, dédupliqué BUG-02). */
export function recordLogCall(userId: string): ApplyEventResult | null {
  if (!userId) return null;
  if (isDuplicateWithinSecond(`${userId}:day-logged`)) return null;

  const today = todayParisIso();
  const engine = loadEngineState(userId);
  if (!engine.logDates.includes(today)) {
    engine.logDates = [...engine.logDates, today].slice(-MAX_HISTORY);
    saveEngineState(userId, engine);
  }

  return applyEvent(userId, "day-logged", 1, { dateParis: today });
}

export interface SessionCompleteInput {
  sessionId: number;
  /** ISO — utilisé pour le critère "séance démarrée avant 9h Europe/Paris" du badge Lève-tôt. */
  startedAt: string;
  rdvCount: number;
  callsCount: number;
  contactsCompletedCount: number;
  npaCount: number;
  achievementSigned?: boolean;
}

export interface SessionCompleteResult {
  streaks: ComboStreaksState;
  newBadges: BadgeId[];
}

function startedBeforeNineAmParis(startedAt: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(startedAt));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Number.isFinite(hour) && hour < 9;
}

/** Séance terminée avec succès : recalcule et persiste les 3 streaks, détecte et persiste les nouveaux badges (BUG-01). */
export function recordSessionComplete(userId: string, session: SessionCompleteInput): SessionCompleteResult | null {
  if (!userId) return null;
  if (isDuplicateWithinSecond(`${userId}:session-complete:${session.sessionId}`)) return null;

  const engine = loadEngineState(userId);
  const today = todayParisIso();

  const logDates = engine.logDates.includes(today) ? engine.logDates : [...engine.logDates, today].slice(-MAX_HISTORY);
  const sessionRdvHistory = [...engine.sessionRdvHistory, session.rdvCount].slice(-MAX_HISTORY);
  const sessionCallHistory = [...engine.sessionCallHistory, session.callsCount].slice(-MAX_HISTORY);
  const sessionsCompletedCount = engine.sessionsCompletedCount + 1;
  const npaTotal = engine.npaTotal + session.npaCount;

  saveEngineState(userId, {
    ...engine,
    logDates,
    sessionRdvHistory,
    sessionCallHistory,
    sessionsCompletedCount,
    npaTotal,
  });

  const streaks: ComboStreaksState = {
    classique: computeStreak(logDates, today).currentDays,
    productif: computeProductifStreak(sessionRdvHistory).currentSessions,
    intense: computeIntenseStreak(sessionCallHistory).currentSessions,
  };
  saveStreaks(userId, streaks);

  const xp = loadXp(userId);
  const shortcutsUsedToday = engine.shortcutsToday.date === today ? engine.shortcutsToday.count : 0;
  const badgeInput: BadgeCheckInput = {
    sessionsCompletedCount,
    shortcutsUsedToday,
    rdvInCurrentSession: session.rdvCount,
    sessionStartedBeforeNineAm: startedBeforeNineAmParis(session.startedAt),
    contactsCompletedInSession: session.contactsCompletedCount,
    npaTotal,
    muraReussiteSigned: session.achievementSigned ?? false,
  };
  const newBadges = checkBadges(badgeInput, xp.badges);
  if (newBadges.length > 0) {
    saveXp(userId, { ...xp, badges: [...xp.badges, ...newBadges] });
  }

  return { streaks, newBadges };
}
