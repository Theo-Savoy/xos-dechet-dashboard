import { expect, test } from "@playwright/test";

// Smoke test : l'écran de connexion s'affiche pour un visiteur non authentifié.
// Ne teste PAS le login effectif (lien magique / OAuth Salesforce) — juste que
// la page se charge et propose les deux entrées de connexion.
test("login screen renders for an unauthenticated visitor", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: /se connecter avec salesforce/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /recevoir un lien de connexion/i })).toBeVisible();
  await expect(page.getByPlaceholder(/nom@xos-learning\.fr/i)).toBeVisible();

  // Capture pour revue visuelle rapide (pas une comparaison de régression —
  // voir visual-baseline.spec.ts pour ça).
  await test.info().attach("login-screen", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
