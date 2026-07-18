import type { Page } from "@playwright/test";
import { FAKE_SUPABASE_STORAGE_KEY } from "./env";

// Helpers de mock pour les smoke tests Playwright. Aucune dépendance
// Supabase/Salesforce réelle : on injecte une fausse session Supabase dans
// localStorage (lue par supabase-js au boot) et on intercepte toutes les
// requêtes réseau que le dashboard émet ensuite.

const FAKE_USER_ID = "e2e-fake-user-id";
const FAKE_EMAIL = "e2e@xos-learning.fr";

function fakeSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: "e2e-fake-access-token",
    refresh_token: "e2e-fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSeconds + 3600,
    user: {
      id: FAKE_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: FAKE_EMAIL,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/** Injecte une session Supabase valide dans localStorage avant le premier chargement de page. */
export async function injectFakeSession(page: Page) {
  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: FAKE_SUPABASE_STORAGE_KEY, session: fakeSession() },
  );
}

/** Intercepte le trafic PostgREST/GoTrue de supabase-js (rôle profil, raccourcis, etc). */
async function mockSupabaseRoutes(page: Page) {
  await page.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, json: {} }));
}

/** Intercepte les endpoints backend maison (/api/*) : bridge auth, statut Salesforce, hub Combo. */
async function mockBackendApi(page: Page) {
  // Fallback générique — évite tout échec réseau brut sur un endpoint non listé ci-dessous.
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, json: {} }));

  await page.route("**/api/auth", (route) => route.fulfill({ status: 200, json: {} }));

  await page.route("**/api/status", (route) =>
    route.fulfill({
      status: 200,
      json: { salesforce: { connected: true, orgConnected: true, userLinked: true } },
    }),
  );

  // Payload attendu par fetchComboHub (voir src/apps/calls/api.ts).
  await page.route("**/api/calls**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        sessions: [],
        stats: { calls_today: 0, calls_week: 0, sessions_active: 0, sessions_completed: 0 },
        recall_count: 0,
      },
    }),
  );
}

/** Mock complet : session Supabase + Salesforce "lié" + API backend neutralisée. Usage: avant page.goto("/"). */
export async function mockAuthenticatedSession(page: Page) {
  await injectFakeSession(page);
  await mockSupabaseRoutes(page);
  await mockBackendApi(page);
}
