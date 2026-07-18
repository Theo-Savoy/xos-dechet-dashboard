import { expect, test } from "@playwright/test";
import { mockAuthenticatedSession } from "./helpers/auth";

// Smoke test : une fois authentifié (session Supabase mockée via localStorage,
// aucun backend réel appelé), le bureau X OS se monte — menubar, dock avec
// les icônes d'apps, et le launcher sont présents.
test("desktop shell renders after mocked auth", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.goto("/");

  // Dock + icônes d'app.
  await expect(page.getByRole("navigation", { name: "Applications X OS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Combo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Labo" })).toBeVisible();
  await expect(page.getByText("e2e@xos-learning.fr")).toBeVisible();

  // Launcher (palette de commandes cmdk, masquée par défaut — ouverte via Ctrl/Cmd+K).
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder(/rechercher un compte, contact, opportunité/i)).toBeVisible();
});
