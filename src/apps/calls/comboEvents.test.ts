// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetComboEventsInternals, recordLogCall, recordRdv, recordSessionComplete, recordShortcut } from "./comboEvents";
import { loadXp } from "./comboXp";
import { loadLearningState } from "./nudgeLearning";
import { loadStreaks } from "./comboStreaks";

function installLocalStorage() {
  const store: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    },
  });
}

const USER = "u1";

describe("comboEvents orchestrator (BUG-01)", () => {
  beforeEach(() => {
    installLocalStorage();
    __resetComboEventsInternals();
  });

  afterEach(() => {
    window.localStorage?.clear();
    vi.useRealTimers();
  });

  it("recordShortcut credits vitesse XP and marks the shortcut adopted (BUG-06)", () => {
    const result = recordShortcut(USER, "L");
    expect(result?.xp.vitesse).toBe(1);
    expect(loadLearningState("L", USER).phase).toBe("acceptee");
  });

  it("returns null and does nothing without a userId", () => {
    expect(recordShortcut("", "L")).toBeNull();
    expect(recordRdv("", "handleLogRdvAndNext")).toBeNull();
    expect(recordLogCall("")).toBeNull();
    expect(recordSessionComplete("", {
      sessionId: 1,
      startedAt: "2026-07-19T08:00:00.000Z",
      rdvCount: 0,
      callsCount: 0,
      contactsCompletedCount: 0,
      npaCount: 0,
    })).toBeNull();
  });

  it("is idempotent within the same second (CONTRAINTES anti-abus)", () => {
    const first = recordShortcut(USER, "K");
    const second = recordShortcut(USER, "K");
    expect(first?.xp.vitesse).toBe(1);
    expect(second).toBeNull();
  });

  it("credits vitesse once per shortcut per day even across seconds (BUG-02, layered on top of the second-guard)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"));
    const first = recordShortcut(USER, "L");
    vi.setSystemTime(new Date("2026-07-19T10:00:05.000Z"));
    const second = recordShortcut(USER, "L");
    expect(first?.xp.vitesse).toBe(1);
    expect(second?.xp.vitesse).toBe(1);
  });

  it("recordRdv credits 10 XP impact per RDV (BUG-03)", () => {
    const result = recordRdv(USER, "handleLogRdvAndNext");
    expect(result?.xp.impact).toBe(10);
  });

  it("recordRdv is idempotent within the same second", () => {
    const first = recordRdv(USER, "handleLogRdvAndNext");
    const second = recordRdv(USER, "handleLogRdvAndNext");
    expect(first?.xp.impact).toBe(10);
    expect(second).toBeNull();
  });

  it("recordLogCall credits 1 XP regularite, once per day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"));
    const first = recordLogCall(USER);
    vi.setSystemTime(new Date("2026-07-19T10:00:05.000Z"));
    const second = recordLogCall(USER);
    expect(first?.xp.regularite).toBe(1);
    expect(second?.xp.regularite).toBe(1);
  });

  it("recordSessionComplete computes and persists streaks + newly unlocked badges", () => {
    const result = recordSessionComplete(USER, {
      sessionId: 42,
      startedAt: "2026-01-15T06:00:00.000Z", // 07:00 Europe/Paris (CET) — avant 9h
      rdvCount: 3,
      callsCount: 25,
      contactsCompletedCount: 10,
      npaCount: 2,
    });

    expect(result?.streaks).toEqual({ classique: 1, productif: 1, intense: 1 });
    expect(result?.newBadges).toEqual(["premier_pas", "trois_banderilles", "leve_tot"]);

    expect(loadStreaks(USER)).toEqual({ classique: 1, productif: 1, intense: 1 });
    expect(loadXp(USER).badges).toEqual(["premier_pas", "trois_banderilles", "leve_tot"]);
  });

  it("recordSessionComplete does not re-award an already-unlocked badge", () => {
    const input = {
      sessionId: 1,
      startedAt: "2026-01-15T12:00:00.000Z",
      rdvCount: 0,
      callsCount: 0,
      contactsCompletedCount: 0,
      npaCount: 0,
    };
    const first = recordSessionComplete(USER, input);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-16T12:00:01.000Z"));
    const second = recordSessionComplete(USER, { ...input, sessionId: 2 });

    expect(first?.newBadges).toEqual(["premier_pas"]);
    expect(second?.newBadges).toEqual([]);
    expect(loadXp(USER).badges).toEqual(["premier_pas"]);
  });

  it("recordSessionComplete is idempotent within the same second for the same session", () => {
    const input = {
      sessionId: 7,
      startedAt: "2026-01-15T12:00:00.000Z",
      rdvCount: 0,
      callsCount: 0,
      contactsCompletedCount: 0,
      npaCount: 0,
    };
    const first = recordSessionComplete(USER, input);
    const second = recordSessionComplete(USER, input);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
