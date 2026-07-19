// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NUDGE_LEARNING_KEY_PREFIX,
  __resetNudgeLearningInternals,
  __setLocalStorage,
  __setSessionStorage,
  loadLearningState,
  markAdopted,
  markNudgeSeen,
  registerMouseClick,
  resetLearning,
  shouldShowNudge,
  type ShortcutId,
  type StorageLike,
} from "./nudgeLearning";

const USER_ID = "user-test-1";
const SHORTCUT: ShortcutId = "K";
const OTHER_SHORTCUT: ShortcutId = "J";

function installStorage() {
  const local: Record<string, string> = {};
  const session: Record<string, string> = {};

  const makeStore = (store: Record<string, string>): StorageLike => ({
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  });

  __setLocalStorage(makeStore(local));
  __setSessionStorage(makeStore(session));
  return { local, session };
}

let localStore: Record<string, string> = {};

function clickTimes(shortcutId: ShortcutId, count: number) {
  let last = registerMouseClick(shortcutId, USER_ID);
  for (let i = 1; i < count; i += 1) {
    last = registerMouseClick(shortcutId, USER_ID);
  }
  return last;
}

describe("nudgeLearning", () => {
  beforeEach(() => {
    const stores = installStorage();
    localStore = stores.local;
    __resetNudgeLearningInternals();
  });

  afterEach(() => {
    resetLearning(SHORTCUT, USER_ID);
    resetLearning(OTHER_SHORTCUT, USER_ID);
    __setLocalStorage(null);
    __setSessionStorage(null);
    __resetNudgeLearningInternals();
  });

  it("starts in intensive phase with shouldShow false", () => {
    const state = loadLearningState(SHORTCUT, USER_ID);
    expect(state.phase).toBe("intensive");
    expect(state.nudgesSeen).toBe(0);
    expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);
  });

  it("shows intensive nudge after 5 mouse clicks", () => {
    const fourth = clickTimes(SHORTCUT, 4);
    expect(fourth.shouldShow).toBe(false);

    const fifth = registerMouseClick(SHORTCUT, USER_ID);
    expect(fifth.shouldShow).toBe(true);
    expect(fifth.state.phase).toBe("intensive");
    expect(fifth.state.mouseCount).toBe(5);
  });

  it("moves to reguliere after markNudgeSeen and stays hidden until 10 more clicks", () => {
    clickTimes(SHORTCUT, 5);
    markNudgeSeen(SHORTCUT, USER_ID);

    const state = loadLearningState(SHORTCUT, USER_ID);
    expect(state.phase).toBe("reguliere");
    expect(state.nudgesSeen).toBe(1);
    expect(state.mouseCount).toBe(0);
    expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);

    const afterNine = clickTimes(SHORTCUT, 9);
    expect(afterNine.shouldShow).toBe(false);

    const afterTen = registerMouseClick(SHORTCUT, USER_ID);
    expect(afterTen.shouldShow).toBe(true);
    expect(afterTen.state.phase).toBe("reguliere");
  });

  it("moves to espacee after second nudge and shows at 30 cumulative clicks, not 45 (BUG-05)", () => {
    clickTimes(SHORTCUT, 5);
    markNudgeSeen(SHORTCUT, USER_ID);
    clickTimes(SHORTCUT, 10);
    markNudgeSeen(SHORTCUT, USER_ID);

    const state = loadLearningState(SHORTCUT, USER_ID);
    expect(state.phase).toBe("espacee");
    expect(state.nudgesSeen).toBe(2);
    expect(state.totalMouseCount).toBe(15);
    expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);

    // 15 déjà cumulés (5 + 10) ; il en faut 15 de plus pour atteindre 30 au
    // total, pas 30 de plus (ce qui donnerait 45).
    const afterFourteenMore = clickTimes(SHORTCUT, 14);
    expect(afterFourteenMore.shouldShow).toBe(false);
    expect(afterFourteenMore.state.totalMouseCount).toBe(29);

    const afterThirtieth = registerMouseClick(SHORTCUT, USER_ID);
    expect(afterThirtieth.shouldShow).toBe(true);
    expect(afterThirtieth.state.phase).toBe("espacee");
    expect(afterThirtieth.state.totalMouseCount).toBe(30);
  });

  it("enters acceptee after 3 nudges seen and never shows again", () => {
    clickTimes(SHORTCUT, 5);
    markNudgeSeen(SHORTCUT, USER_ID);
    clickTimes(SHORTCUT, 10);
    markNudgeSeen(SHORTCUT, USER_ID);
    clickTimes(SHORTCUT, 30);
    markNudgeSeen(SHORTCUT, USER_ID);

    const state = loadLearningState(SHORTCUT, USER_ID);
    expect(state.phase).toBe("acceptee");
    expect(state.nudgesSeen).toBe(3);

    const burst = clickTimes(SHORTCUT, 100);
    expect(burst.shouldShow).toBe(false);
    expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);
  });

  it("persists state in localStorage", () => {
    clickTimes(SHORTCUT, 5);
    markNudgeSeen(SHORTCUT, USER_ID);

    const raw = localStore[`${NUDGE_LEARNING_KEY_PREFIX}${USER_ID}`];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.K).toMatchObject({
      nudgesSeen: 1,
      phase: "reguliere",
      mouseCount: 0,
    });

    const reloaded = loadLearningState(SHORTCUT, USER_ID);
    expect(reloaded.nudgesSeen).toBe(1);
    expect(reloaded.phase).toBe("reguliere");
  });

  it("tracks each shortcut independently", () => {
    const kFifth = clickTimes(SHORTCUT, 5);
    expect(kFifth.shouldShow).toBe(true);

    const jFourth = clickTimes(OTHER_SHORTCUT, 4);
    expect(jFourth.shouldShow).toBe(false);
    expect(loadLearningState(OTHER_SHORTCUT, USER_ID).mouseCount).toBe(4);

    markNudgeSeen(SHORTCUT, USER_ID);
    expect(loadLearningState(SHORTCUT, USER_ID).nudgesSeen).toBe(1);
    expect(loadLearningState(OTHER_SHORTCUT, USER_ID).nudgesSeen).toBe(0);
  });

  it("handles 100 clicks at once for intensive phase", () => {
    let sawShow = false;
    for (let i = 0; i < 100; i += 1) {
      const result = registerMouseClick(SHORTCUT, USER_ID);
      if (result.shouldShow) sawShow = true;
    }

    const state = loadLearningState(SHORTCUT, USER_ID);
    expect(sawShow).toBe(true);
    expect(state.mouseCount).toBe(100);
    expect(state.phase).toBe("intensive");
    expect(state.nudgesSeen).toBe(0);
  });

  it("does not re-show until dismissed after threshold is reached", () => {
    const fifth = clickTimes(SHORTCUT, 5);
    expect(fifth.shouldShow).toBe(true);

    const sixth = registerMouseClick(SHORTCUT, USER_ID);
    expect(sixth.shouldShow).toBe(false);
    expect(sixth.state.mouseCount).toBe(6);
  });

  describe("BUG-04: per-shortcut intensive thresholds", () => {
    it("shows the intensive nudge for L after 3 clicks, not 5", () => {
      const second = clickTimes("L", 2);
      expect(second.shouldShow).toBe(false);

      const third = registerMouseClick("L", USER_ID);
      expect(third.shouldShow).toBe(true);
    });

    it("shows the intensive nudge for F after 3 clicks, not 5", () => {
      const second = clickTimes("F", 2);
      expect(second.shouldShow).toBe(false);

      const third = registerMouseClick("F", USER_ID);
      expect(third.shouldShow).toBe(true);
    });

    it("still requires 5 clicks for K/J/digits/cmd-enter/?", () => {
      for (const id of ["K", "J", "1", "2", "3", "4", "5", "cmd-enter", "?"] as const) {
        const fourth = clickTimes(id, 4);
        expect(fourth.shouldShow).toBe(false);
        const fifth = registerMouseClick(id, USER_ID);
        expect(fifth.shouldShow).toBe(true);
        resetLearning(id, USER_ID);
      }
    });
  });

  describe("BUG-06: markAdopted on keyboard use", () => {
    it("clic clavier après 2 rappels vus → nudges suivants silencieux", () => {
      clickTimes(SHORTCUT, 5);
      markNudgeSeen(SHORTCUT, USER_ID);
      clickTimes(SHORTCUT, 10);
      markNudgeSeen(SHORTCUT, USER_ID);
      expect(loadLearningState(SHORTCUT, USER_ID).phase).toBe("espacee");

      markAdopted(SHORTCUT, USER_ID);

      const state = loadLearningState(SHORTCUT, USER_ID);
      expect(state.phase).toBe("acceptee");
      expect(state.nudgesSeen).toBe(3);

      const burst = clickTimes(SHORTCUT, 100);
      expect(burst.shouldShow).toBe(false);
      expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);
    });

    it("does not reset mouse counters on adoption", () => {
      clickTimes(SHORTCUT, 5);
      markAdopted(SHORTCUT, USER_ID);
      const state = loadLearningState(SHORTCUT, USER_ID);
      expect(state.mouseCount).toBe(5);
      expect(state.totalMouseCount).toBe(5);
    });

    it("silences nudges immediately even from the very first keyboard use", () => {
      clickTimes(SHORTCUT, 2);
      markAdopted(SHORTCUT, USER_ID);
      expect(shouldShowNudge(SHORTCUT, USER_ID)).toBe(false);
      expect(loadLearningState(SHORTCUT, USER_ID).phase).toBe("acceptee");
    });
  });
});
