import { defineConfig, devices } from "@playwright/test";
import { FAKE_SUPABASE_ANON_KEY, FAKE_SUPABASE_URL } from "./e2e/helpers/env";

// E2E smoke suite — voir /e2e. Lance `npm run dev` automatiquement (webServer)
// et n'a besoin d'aucun backend Supabase/Salesforce réel : les specs mockent
// les appels réseau via page.route (voir e2e/helpers/auth.ts).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  // Baseline visuelle stockée à un chemin fixe (pas de suffixe OS/projet) —
  // voir e2e/visual-baseline.spec.ts.
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Valeurs factices : aucune requête Supabase/Salesforce réelle n'est
      // faite, tout est mocké côté test via page.route.
      VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: FAKE_SUPABASE_ANON_KEY,
    },
  },
});
