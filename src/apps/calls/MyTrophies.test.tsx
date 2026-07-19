// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyTrophies } from "./MyTrophies";
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

describe("MyTrophies", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("renders nothing when closed", () => {
    render(<MyTrophies open={false} onClose={vi.fn()} userId="user-1" />);
    expect(screen.queryByRole("dialog", { name: "Mes réussites" })).toBeNull();
  });

  it("renders the personal wall with XP axes, an empty-badges state, and streaks", () => {
    render(<MyTrophies open onClose={vi.fn()} userId="user-1" />);
    expect(screen.getByRole("dialog", { name: "Mes réussites" })).toBeTruthy();
    expect(screen.getByText(/Vitesse · 0/)).toBeTruthy();
    expect(screen.getByText(/Impact · 0/)).toBeTruthy();
    expect(screen.getByText(/Régularité · 0/)).toBeTruthy();
    expect(screen.getByText("Aucun badge débloqué pour l'instant.")).toBeTruthy();
    expect(screen.getByText(/Streak classique/)).toBeTruthy();
  });

  it("shows unlocked badges most-recent-first, personal wall only", () => {
    window.localStorage.setItem(
      comboXpStorageKey("user-1"),
      JSON.stringify({ vitesse: 1, impact: 0, regularite: 1, badges: ["premier_pas", "eclair"], lastSeen: "" }),
    );
    render(<MyTrophies open onClose={vi.fn()} userId="user-1" />);
    const items = screen.getAllByText(/Badge débloqué/);
    expect(items[0].textContent).toContain("Éclair");
    expect(items[1].textContent).toContain("Premier pas");
  });
});
