// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBar, ShortcutHelp } from "./CommandBar";
import { DEFAULT_SOUND_PREFS } from "./comboSoundPrefs";
import { comboXpStorageKey } from "./comboXp";

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

afterEach(cleanup);

describe("CommandBar XP section", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("shows one line per axis with the current palier when a user is given", () => {
    window.localStorage.setItem(
      comboXpStorageKey("user-1"),
      JSON.stringify({ vitesse: 30, impact: 70, regularite: 14, badges: ["premier_pas"], lastSeen: "" }),
    );
    render(
      <CommandBar
        open
        onClose={vi.fn()}
        onRun={vi.fn()}
        soundsEnabled
        soundPrefs={DEFAULT_SOUND_PREFS}
        onSoundPrefsChange={vi.fn()}
        currentUserId="user-1"
      />,
    );
    expect(screen.getByText(/Vitesse 30 · Argent/)).toBeTruthy();
    expect(screen.getByText(/Impact 70 · Argent/)).toBeTruthy();
    expect(screen.getByText(/Régularité 14 · Or/)).toBeTruthy();
    expect(screen.getByText(/Dernier badge/)).toBeTruthy();
  });

  it("omits the XP section without a current user", () => {
    render(
      <CommandBar
        open
        onClose={vi.fn()}
        onRun={vi.fn()}
        soundsEnabled
        soundPrefs={DEFAULT_SOUND_PREFS}
        onSoundPrefsChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Progression Combo")).toBeNull();
  });
});

describe("ShortcutHelp — Mes réussites entry", () => {
  it("opens My Trophies from the help menu when wired", async () => {
    const onOpenMyTrophies = vi.fn();
    render(<ShortcutHelp open onClose={vi.fn()} onOpenCommandBar={vi.fn()} onOpenMyTrophies={onOpenMyTrophies} />);
    screen.getByRole("button", { name: "Mes réussites" }).click();
    expect(onOpenMyTrophies).toHaveBeenCalledTimes(1);
  });
});
