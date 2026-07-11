# Ops — Fonctions Vercel (plafond Hobby = 12 ; 8/12 utilisées)

**Constat 2026-07-11** : le plan Hobby Vercel limite à **12 Serverless Functions**.

**Mise à jour** : consolidations **B** et **C** appliquées (`search` + `log` → `launcher`, `sso-bridge` + `auth/salesforce` → `auth`).

## Inventaire actuel (handlers HTTP) — post lot Hub 2.3

| # | Fichier | Rôle | Touché par |
|---|---|---|---|
| 1 | `api/refresh.py` | Cache Cleaner SF | Cleaner legacy |
| 2 | `api/update.js` | Actions lot Cleaner | Cleaner legacy |
| 3 | `api/history.js` | Journal Blob Cleaner | `dashboard.html` |
| 4 | `api/version.js` | Clé cache Cleaner | `dashboard.html` |
| 5 | `api/launcher.js` | SOSL + `/log` + `/create` | Cmd+K |
| 6 | `api/auth.js` | Cookie legacy + OAuth SF (stub → 8.1) | Login |
| 7 | `api/calls.js` | Sessions + list_contacts + presets | Calls app |
| 8 | `api/status.js` | Statut Hub, réglages équipe et rôles | Hub 2.3 |
| 9–12 | **libres** | Weekly `perf`, réserve | — |

Helpers **non exposés** (importés seulement) : `api/_auth.js`, `api/_crm/*`, `api/_calls/*`, `api/_config/*`.

### Routes `/api/launcher`

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `?q=` | SOSL multi-objet (ancien `/api/search`) |
| `POST` | `{ action: "log_call" }` | Création de Task Salesforce (ancien `/api/log`) |
| `POST` | `{ action: "create_contact" }` | Création de Contact Salesforce (ancien `/api/log`) |
| `OPTIONS` | — | CORS : `GET, POST, OPTIONS` |

### Routes `/api/auth`

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | — | Vérifie le JWT puis pose le cookie `xos_auth` (ancien `/api/sso-bridge`) |
| `GET` | `?flow=salesforce` | Stub OAuth : redirection `/?auth_error=sf_coming_soon` (ancien `/api/auth/salesforce`) |
| `GET` | sans flux reconnu | `400 { error: "invalid_flow" }` |
| `OPTIONS` | — | CORS : `GET, POST, OPTIONS` |

### Actions / resources sur `/api/calls`

| Méthode | Route | Remplace |
|---|---|---|
| `POST` | `{ action: "list_contacts", filters, limit? }` | `POST /api/calls-list` |
| `GET` | `?resource=presets` | `GET /api/presets` |
| `POST` | `{ action: "save_preset", name, filters, shared }` | `POST /api/presets` |
| `POST` | `{ action: "delete_preset", id }` | — |
| `DELETE` | `?resource=presets&id=` | `DELETE /api/presets?id=` |
| *(existant)* | sessions, log_call, log_event, skip, complete, follow-up, context | inchangé |

## Besoins futurs

| Endpoint prévu | Phase | Slot |
|---|---|---|
| `status` (Hub) | 2.3 | livré (`api/status.js`) |
| `perf` (Weekly) | 3.1 | libre |
| `business-review` | 6.1 | réserve / consolidation C |
| `arena/*` | 5.1 | Pro ou consolidation C |
| `chat` + `slack/*` | 7.x | Pro ou consolidation C |
| callback OAuth SF | 8.1 | idéalement dans `auth.js` unique |

## Stratégie restante

### C — Fait → **−2**

4. **Router Launcher** `api/launcher.js` : `search` + `log`.
5. **Auth router** `api/auth.js` : `salesforce` + `sso-bridge`.

### D — Ne pas toucher sans lot dédié

- `refresh.py` / `update.js` — cœur Cleaner.
- `history` / `version` — `dashboard.html` intouchable sauf lot Cleaner.

## Règles pour les agents

1. **Avant d'ajouter un fichier sous `api/`** : vérifier ce compteur ; préférer une `action` sur un router existant.
2. Pas de nouveau nested `api/foo/bar.js` sauf si on accepte +1 fonction.
3. Helpers uniquement sous `api/_…` (import only).
4. Documenter tout merge dans la PR (avant/après inventaire).

## Décision produit

- **Fait** : consolidations **B** et **C**, puis Hub 2.3 → **8 fonctions**, soit **4 slots libres** pour Weekly + marge.
- **Moyen terme** : la consolidation **D** reste intouchable hors lot Cleaner ; envisager Vercel Pro si les besoins dépassent ces 5 slots.
