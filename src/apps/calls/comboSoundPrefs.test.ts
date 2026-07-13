// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMBO_SOUND_PREFS_KEY,
  DEFAULT_SOUND_PREFS,
  LOG_ONLY_SOUND_PREFS,
  isSoundGroupEnabled,
  readSoundPrefs,
  writeSoundPrefs,
} from "./comboSoundPrefs";
import { COMBO_SOUNDS_KEY, writeSoundsEnabled } from "./comboKeyboard";

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

describe("comboSoundPrefs", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    window.localStorage?.removeItem(COMBO_SOUND_PREFS_KEY);
    window.localStorage?.removeItem(COMBO_SOUNDS_KEY);
  });

  it("defaults all groups to enabled", () => {
    expect(readSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
  });

  it("persists partial overrides", () => {
    writeSoundPrefs({ ...DEFAULT_SOUND_PREFS, navigation: false, result: false });
    expect(readSoundPrefs().navigation).toBe(false);
    expect(readSoundPrefs().log).toBe(true);
  });

  it("respects the global mute", () => {
    writeSoundsEnabled(false);
    writeSoundPrefs(DEFAULT_SOUND_PREFS);
    expect(isSoundGroupEnabled("log")).toBe(false);
  });

  it("supports log-only preset semantics", () => {
    writeSoundPrefs(LOG_ONLY_SOUND_PREFS);
    expect(isSoundGroupEnabled("log")).toBe(true);
    expect(isSoundGroupEnabled("rdv")).toBe(true);
    expect(isSoundGroupEnabled("result")).toBe(false);
    expect(isSoundGroupEnabled("navigation")).toBe(false);
  });
});
