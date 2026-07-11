# Ops — Fonctions Vercel (plafond Hobby = 12)

**Constat 2026-07-11** : le plan Hobby Vercel limite à **12 Serverless Functions**. On est **au plafond**.

## Inventaire actuel (handlers HTTP)

| # | Fichier | Rôle | Touché par |
|---|---|---|---|
| 1 | `api/refresh.py` | Cache Cleaner SF | Cleaner legacy |
| 2 | `api/update.js` | Actions lot Cleaner | Cleaner legacy |
| 3 | `api/history.js` | Journal Blob Cleaner | `dashboard.html` |
| 4 | `api/version.js` | Clé cache Cleaner | `dashboard.html` |
| 5 | `api/search.js` | Launcher SOSL | Cmd+K |
| 6 | `api/log.js` | `/log` `/create` | Launcher |
| 7 | `api/sso-bridge.js` | Cookie legacy | Login |
| 8 | `api/calls.js` | Sessions Call Manager | Calls app |
| 9 | `api/calls-list.js` | Ciblage contacts | Calls app |
| 10 | `api/presets.js` | Presets filtres | Calls app |
| 11 | `api/auth/salesforce.js` | OAuth SF (stub → 8.1) | Login |
| 12 | `api/auth-test.js` | Smoke JWT | Dev / QC |

Helpers **non exposés** (importés seulement) : `api/_auth.js`, `api/_crm/*`, `api/_config/*` — à garder en `_` / hors entrypoint. Les `*.test.js` ne doivent **pas** être déployés comme fonctions (Vitest only).

## Besoins futurs (sans consolidation = dépassement)

| Endpoint prévu | Phase |
|---|---|
| `status` (Hub) | 2.3 |
| `perf` (Weekly) | 3.1 |
| `business-review` | 6.1 |
| `arena/*` | 5.1 |
| `chat` + `slack/*` | 7.x |
| callback OAuth SF (si fichier séparé) | 8.1 |

Sans regroupement : **impossible** de rester sur Hobby.

## Stratégie de consolidation (risque croissant)

### A — Très faible risque (faire en premier) → **−1 à −2**

1. **Retirer `api/auth-test.js`** du déploiement (garder le test Vitest sur `verifyJWT` ailleurs, ou endpoint admin derrière flag). Libère **1** slot.
2. **Fusionner `version` dans `history`** : `GET /api/history?meta=version` **et** garder un rewrite/proxy `/api/version` → même handler *uniquement si* on peut toucher le routage sans casser `dashboard.html`.  
   - ⚠️ `dashboard.html` appelle `/api/version` et `/api/history` séparément et est **intouchable** sauf lot explicite.  
   - Option sûre : un seul fichier `api/cleaner-meta.js` exportant deux routes **n'est pas supporté** par Vercel (1 fichier = 1 fonction). Donc pour libérer un slot il faut **changer l'URL côté dashboard** (lot Cleaner dédié) ou accepter de garder les 2.

### B — Faible / moyen risque, fort gain → **−2** (recommandé avant Weekly Perf)

Pattern déjà utilisé dans `calls.js` : **un endpoint, plusieurs `action`**.

3. **Absorber `calls-list` + `presets` dans `calls.js`**
   - `POST /api/calls` `{ action: "list_contacts", filters, limit }` (aujourd'hui `POST /api/calls-list`)
   - `GET|POST|DELETE /api/calls?resource=presets` ou `action: "list_presets" | "save_preset" | "delete_preset"`
   - Mettre à jour `src/apps/calls/api.ts` + tests
   - Laisser des **stubs de redirection 308** un sprint si besoin, puis supprimer les fichiers (sinon on ne gagne rien)

Gain net : **2** fonctions → slots pour `status` + `perf`.

### C — Moyen risque → **−2**

4. **Router Launcher** `api/launcher.js` : fusion `search` + `log` (+ éventuellement `sso-bridge` en `action: "bridge"`).  
   - Touche Cmd+K et auth cookie — bien couvrir de tests.
5. **Auth router** `api/auth.js` : `salesforce` start/callback + `sso-bridge` sous le même fichier via query `?step=` ou path parsing manuel.  
   - Attention : Vercel path `/api/auth/salesforce` = fichier nested = **fonction séparée**. Pour 1 seule fonction, tout doit vivre dans **un** fichier (`api/auth.js`) et le front pointe vers `/api/auth?provider=salesforce`.

### D — Ne pas toucher sans lot dédié

- `refresh.py` / `update.js` — cœur Cleaner, Python + Node, auth middleware legacy.
- Ne pas merger analytics lourdes (`perf`) avec Cleaner.

## Cible recommandée post-consolidation B

| # | Fichier | Couvre |
|---|---|---|
| 1–4 | refresh, update, history, version | Cleaner |
| 5–6 | search, log | Launcher *(ou launcher.js plus tard)* |
| 7 | sso-bridge | Auth cookie |
| 8 | calls | sessions + list + presets |
| 9 | auth/salesforce *(ou auth.js)* | OAuth |
| 10 | **status** | Hub 2.3 |
| 11 | **perf** | Weekly 3.1 |
| 12 | réserve (Arena ou slack) | — |

`auth-test` retiré. Marge : **1–2** slots avant Phase 5/7 → prévoir consolidation C ou passage Pro avant Agent/Arena.

## Règles pour les agents

1. **Avant d'ajouter un fichier sous `api/`** : vérifier le compteur (ce doc) ; préférer une `action` sur un router existant.
2. Pas de nouveau nested `api/foo/bar.js` sauf si on accepte +1 fonction.
3. Helpers uniquement sous `api/_…` (import only).
4. Documenter tout merge dans la PR (avant/après inventaire).

## Décision produit

- **Court terme** : consolidation **B** (calls) + retrait **auth-test** avant de coder Hub + Weekly Perf.
- **Moyen terme** : si Agent + Arena partent, soit consolidation **C**, soit **upgrade Vercel Pro** (fonctions illimitées / beaucoup plus hautes).
