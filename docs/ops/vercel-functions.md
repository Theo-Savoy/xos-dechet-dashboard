# Ops — Fonctions Vercel (plafond Hobby = 12 ; 6/12 utilisées)

**Constat 2026-07-11** : le plan Hobby Vercel limite à **12 Serverless Functions**.

**Mise à jour** : consolidations **B** et **C** appliquées (`search` + `log` → `launcher`, `sso-bridge` + `auth/salesforce` → `auth`).

## Inventaire actuel (handlers HTTP) — après cutover Labo Task 10

| #    | Fichier           | Rôle                                             | Touché par     |
| ---- | ----------------- | ------------------------------------------------ | -------------- |
| 1    | `api/cleaner.js`  | Workspace, analytics, history, preview, execute  | Labo natif     |
| 2    | `api/launcher.js` | SOSL + `/log` + `/create`                        | Cmd+K          |
| 3    | `api/auth.js`     | Bridge cookie + liaison OAuth SF par utilisateur | Login / compte |
| 4    | `api/calls.js`    | Sessions + list_contacts + presets               | Calls app      |
| 5    | `api/status.js`   | Statut Hub, réglages équipe et rôles             | Hub 2.3        |
| 6    | `api/perf.js`     | Agrégats Weekly Perf (Pulse, Pipeline, Effort)   | Lot 3.1        |
| 7–12 | **libres**        | Réserve                                          | —              |

Helpers **non exposés** (importés seulement) : `api/_auth.js`, `api/_crm/*`, `api/_calls/*`, `api/_config/*`.

### Activation OAuth utilisateur (lot 8.1b)

- ✅ Migration `supabase/migrations/015_salesforce_user_oauth.sql` appliquée en Production le 2026-07-11.
- ✅ `SF_TOKEN_ENCRYPTION_KEY` ajoutée à Vercel Production (32 octets aléatoires, base64).
- `SF_REFRESH_TOKEN` : optionnel, réservé aux scripts legacy / fallback explicite (`allowOrgFallback`). Le runtime produit utilise uniquement l’OAuth utilisateur.
- Callback Connected App : `https://xos.hellotheo.fr/api/auth?flow=salesforce-callback`.
- Authorize URL : `SF_INSTANCE_URL` (My Domain org), pas `login.salesforce.com`.
- Ne jamais faire tourner la clé de chiffrement sans relier ensuite tous les comptes Salesforce.
- Le login Salesforce synchronise automatiquement `provider_refresh_token`; la route dédiée sert de reliaison/secours.

### Routes `/api/launcher`

| Méthode   | Route                          | Rôle                                               |
| --------- | ------------------------------ | -------------------------------------------------- |
| `GET`     | `?q=`                          | SOSL multi-objet (ancien `/api/search`)            |
| `POST`    | `{ action: "log_call" }`       | Création de Task Salesforce (ancien `/api/log`)    |
| `POST`    | `{ action: "create_contact" }` | Création de Contact Salesforce (ancien `/api/log`) |
| `OPTIONS` | —                              | CORS : `GET, POST, OPTIONS`                        |

### Routes `/api/auth`

| Méthode   | Route                       | Rôle                                                                                   |
| --------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `POST`    | —                           | Vérifie le JWT puis pose le cookie `xos_auth` (ancien `/api/sso-bridge`)               |
| `POST`    | `?flow=salesforce-link`     | Démarre la liaison OAuth SF du user JWT ; retourne `authorization_url`                 |
| `GET`     | `?flow=salesforce-callback` | Callback SF, validation identité et stockage chiffré du refresh token                  |
| `GET`     | `?flow=salesforce`          | Stub OAuth : redirection `/?auth_error=sf_coming_soon` (ancien `/api/auth/salesforce`) |
| `GET`     | sans flux reconnu           | `400 { error: "invalid_flow" }`                                                        |
| `OPTIONS` | —                           | CORS : `GET, POST, OPTIONS`                                                            |

### Actions / resources sur `/api/calls`

| Méthode      | Route                                                             | Remplace                  |
| ------------ | ----------------------------------------------------------------- | ------------------------- |
| `POST`       | `{ action: "list_contacts", filters, limit? }`                    | `POST /api/calls-list`    |
| `GET`        | `?resource=presets`                                               | `GET /api/presets`        |
| `POST`       | `{ action: "save_preset", name, filters, shared }`                | `POST /api/presets`       |
| `POST`       | `{ action: "delete_preset", id }`                                 | —                         |
| `DELETE`     | `?resource=presets&id=`                                           | `DELETE /api/presets?id=` |
| _(existant)_ | sessions, log_call, log_event, skip, complete, follow-up, context | inchangé                  |

## Besoins futurs

| Endpoint prévu     | Phase | Slot                             |
| ------------------ | ----- | -------------------------------- |
| `status` (Hub)     | 2.3   | livré (`api/status.js`)          |
| `perf` (Weekly)    | 3.1   | livré (`api/perf.js`)            |
| `business-review`  | 6.1   | réserve / consolidation C        |
| `arena/*`          | 5.1   | Pro ou consolidation C           |
| `chat` + `slack/*` | 7.x   | Pro ou consolidation C           |
| callback OAuth SF  | 8.1   | idéalement dans `auth.js` unique |

## Stratégie restante

### C — Fait → **−2**

4. **Router Launcher** `api/launcher.js` : `search` + `log`.
5. **Auth router** `api/auth.js` : `salesforce` + `sso-bridge`.

### D — Cutover Labo livré

Les fonctions legacy `refresh.py`, `update.js`, `history.js` et `version.js`, ainsi que `public/dashboard.html`, ont été retirées après la gate de parité. Labo lit et journalise via `api/cleaner.js` et Supabase ; les blobs historiques restent une sauvegarde tant que leur suppression n’a pas reçu d’accord explicite.

## Règles pour les agents

1. **Avant d'ajouter un fichier sous `api/`** : vérifier ce compteur ; préférer une `action` sur un router existant.
2. Pas de nouveau nested `api/foo/bar.js` sauf si on accepte +1 fonction.
3. Helpers uniquement sous `api/_…` (import only).
4. Documenter tout merge dans la PR (avant/après inventaire).

## Décision produit

- **Fait** : consolidations **B** et **C**, Hub 2.3, Weekly 3.1 et Labo natif → **6 fonctions**, soit **6 slots libres**.
- **Moyen terme** : conserver les six slots pour les lots futurs ; aucune fonction legacy Cleaner ne doit être réintroduite.
