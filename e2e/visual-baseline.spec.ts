import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { mockAuthenticatedSession } from "./helpers/auth";

// Régression visuelle : capture le bureau X OS vide (aucune fenêtre ouverte)
// et le compare à e2e/baselines/desktop-empty.png (tolérance 0.5%, via
// playwright.config.ts#snapshotPathTemplate).
//
// Si la baseline n'existe pas encore (premier run, ou après un changement de
// design volontaire), Playwright la génère automatiquement : dans ce cas on
// avertit au lieu de faire échouer le test. Un vrai écart contre une
// baseline existante fait toujours échouer le test.
//
// Note : la baseline est sensible au rendu (police, OS). Génère-la depuis le
// même environnement que la CI (Linux headless) pour éviter les faux positifs.
const BASELINE_FILE = fileURLToPath(new URL("./baselines/desktop-empty.png", import.meta.url));

test("desktop empty state matches visual baseline", async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Applications X OS" })).toBeVisible();

  if (!fs.existsSync(BASELINE_FILE)) {
    // Pas de comparaison possible : on génère la baseline nous-mêmes (hors du
    // mécanisme toHaveScreenshot, qui échoue toujours au premier run même en
    // mode "création automatique") et on avertit au lieu de faire échouer.
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    await page.screenshot({ path: BASELINE_FILE });
    console.warn(
      `[visual-baseline] Baseline absente — générée à ${BASELINE_FILE}. Relance le test pour valider la comparaison.`,
    );
    return;
  }

  await expect(page).toHaveScreenshot("desktop-empty.png", { maxDiffPixelRatio: 0.005 });
});
