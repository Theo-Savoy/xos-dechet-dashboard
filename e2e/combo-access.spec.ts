import { expect, test } from "@playwright/test";
import { mockAuthenticatedSession } from "./helpers/auth";

// Smoke test : depuis le bureau authentifié (session Supabase + statut
// Salesforce "lié" mockés), cliquer l'icône Combo dans le dock ouvre bien la
// fenêtre de l'app (WindowManager). Ne teste pas les données Combo elles-mêmes
// (sessions, stats…) — juste que la fenêtre se monte sans crasher l'app.
test("Combo window opens from the dock", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Ouvrir Combo" }).click();

  const comboWindow = page.getByRole("dialog", { name: "Combo" });
  await expect(comboWindow).toBeVisible();
  await expect(comboWindow.locator(".xos-window__titlebar")).toBeVisible();
});
