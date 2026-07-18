// Valeurs Supabase factices partagées entre playwright.config.ts (webServer.env)
// et les helpers de mock (auth.ts). Aucun backend réel n'est contacté : tout
// le trafic /rest, /auth et /api est intercepté via page.route.
export const FAKE_SUPABASE_URL = "https://xos-e2e-fake.supabase.co";
export const FAKE_SUPABASE_ANON_KEY = "e2e-fake-anon-key";

// supabase-js dérive la clé de localStorage du premier label du hostname :
// `sb-${hostname.split(".")[0]}-auth-token`.
export const FAKE_SUPABASE_STORAGE_KEY = "sb-xos-e2e-fake-auth-token";
