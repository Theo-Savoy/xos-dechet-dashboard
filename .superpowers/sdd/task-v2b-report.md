# Rapport correctifs QC — Call Manager v2.A/v2.B

Commit de départ : `06e052a`. Branche : `Theo-Savoy/xos-cm-v2b-log`.

## État RED initial (avant correctifs)

```bash
npm test -- --run
# Test Files  4 failed | 11 passed (15)
# Tests  28 failed | 163 passed (191)
```

Échecs principaux :
- `api/calls.test.js` : contrat v1 (`outcome`, `success`, fetch SF inline) vs v2 (`resultat`, `ok`, adapter)
- `api/calls-list.test.js` : imports v1 supprimés (`buildSoqlQuery`, `parseFilters`, …)
- `scripts/call-target-query.test.js` et `scripts/calls-v2-logic.test.js` : collectés par Vitest sans `describe/it`

## Cycle TDD RED → GREEN

### 1. Persistance Supabase (`api/calls.js`)

| Test ciblé | RED (attendu) | GREEN |
|---|---|---|
| `npm test -- api/calls.test.js -t "compensates when contact insert fails"` | absent → ajouté, échoue sans rollback | `contacts_creation_failed` + delete compensatoire |
| `npm test -- api/calls.test.js -t "local persistence fails after SF success"` | absent → 200 malgré update error | `contact_update_failed` 500 + `sf_task_id` |
| `npm test -- api/calls.test.js -t "session lookup DB error"` | absent → 404 masqué | `session_lookup_failed` 500 |
| `npm test -- api/calls.test.js -t "follow-up contact lookup fails"` | absent → 200/400 incorrect | `session_contacts_lookup_failed` 500 |

### 2. Presets strict + erreurs DB (`api/presets.js`)

| Test ciblé | RED | GREEN |
|---|---|---|
| `npm test -- api/presets.test.js -t "rejects partial or non-integer strings"` | `parsePresetId("1abc")` → 1 | `null` → 400 `invalid_id` |
| `npm test -- api/presets.test.js -t "lookup fails"` | 404 masqué | 500 `preset_lookup_failed` |

### 3. Validation Event + succès partiel

| Test ciblé | RED | GREEN |
|---|---|---|
| `npm test -- api/calls.test.js -t "invalid start datetime"` | accepte `"tomorrow"` | 400 `invalid_start` via `isValidEventStart` |
| `npm test -- api/calls.test.js -t "partial invitee failure"` | `{ok:true}` | 502 `event_invitee_failed` + `sf_event_id` persisté |

### 4. Mapping sémantique

| Test ciblé | RED | GREEN |
|---|---|---|
| `node scripts/calls-v2-logic.check.js` | literals en dur dans `calls.js` | `mapping.objects.task.resultSemantic.{rdv,followUpNoAnswer,followUpVoicemail}` |

### 5. Tests v2 réécrits

| Fichier | RED | GREEN |
|---|---|---|
| `api/calls.test.js` | 7 échecs contrat v1 | 29 tests v2 (adapter mocké) |
| `api/calls-list.test.js` | 21 échecs imports v1 | 9 tests adapter + POST v2 |
| `api/presets.test.js` | absent | 11 tests ajoutés |
| Scripts renommés `*.check.js` | 2 fichiers Vitest vides en échec | exclus de Vitest, exécutables via `node` |

## Commandes gate de sortie (GREEN final)

```bash
node scripts/calls-v2-logic.check.js          # OK
node scripts/call-target-query.check.js         # OK
npm test -- --run                               # 14 files, 170 tests, 0 échec
npx tsc --noEmit                                # 0 erreur
npx eslint .                                    # 0 erreur
npm run build                                   # succès
git diff --check                                # succès
```

## Fichiers modifiés

- `api/_crm/mapping.js` — `resultSemantic` (rdv + relance)
- `api/calls.js` — erreurs Supabase, validation ISO, succès partiel Event, mapping sémantique
- `api/presets.js` — `parsePresetId` strict, erreurs DB explicites
- `api/calls.test.js` — réécriture contrat v2
- `api/calls-list.test.js` — réécriture contrat arbre filtres v2
- `api/presets.test.js` — nouveau
- `scripts/calls-v2-logic.check.js` — renommé depuis `.test.js`
- `scripts/call-target-query.check.js` — renommé depuis `.test.js`

## Auto-revue du diff

- Aucune traduction v1→v2 des anciens `outcome` ; les tests utilisent les 5 valeurs `mapping.objects.task.results`.
- `OwnerId` toujours passé via `sf_user_id` ; refus SF remonté en 502 sans retry silencieux.
- `ActivityDate` non ajouté à `logCall` (hors contrat v2).
- Journalisation conservée en best-effort (échec journal ne bloque pas la réponse HTTP).
- Préoccupation restante : vérification prod OwnerId et intégration UI v2.C avant push/déploiement.

---

## Seconde boucle QC — commit `fe4988d` → correctifs fix2

### État RED initial (re-revue)

Points bloquants identifiés :
- `assertSessionOwner`/`assertSessionContact` : `.single()` transformait PGRST116 en 500 au lieu de 404
- `skip_contact`/`complete_session` : update sans contrôle d'erreur → 200 fantôme
- GET `/api/calls` : erreurs DB masquées (listes/stats vides)
- `isValidEventStart` : acceptait dates impossibles (`2026-02-30`) et heures invalides
- `parsePresetId` : pas de garde `Number.isSafeInteger` / chaînes démesurées
- Couverture tests insuffisante vs contrat v2 (isolation, validations, GET erreurs, dedup calls-list)

### Cycle TDD RED → GREEN (fix2)

| Zone | Test RED ajouté | GREEN |
|---|---|---|
| assert maybeSingle + PGRST116 | `returns 404 when session absent (PGRST116)` log_call + GET detail | `isNotFoundError` + `.maybeSingle()` |
| skip/complete update | `returns 500 when skip/complete update fails` | `contact_update_failed` / `session_update_failed` |
| GET stats/list/detail | `returns 500 when sessions/contacts lookup fails` | erreurs explicites `*_lookup_failed` |
| ISO strict | `rejects impossible dates and invalid offsets` | validation calendrier + bornes heure/minute/offset |
| parsePresetId safe | `rejects unsafe integers` presets.test + check.js | `Number.isSafeInteger` + longueur chaîne |
| Couverture calls-list | dedup, invalid limit/preset, SF query error, cache header | 18 tests POST + adapter |
| Couverture calls | invalid JSON/body/action, create_session validations, isolation owner/contact, log_event validations | 58 tests calls |
| Couverture presets | creation/delete errors, safe integer | 20 tests presets |

### Commandes gate de sortie (GREEN fix2)

```bash
node scripts/calls-v2-logic.check.js          # OK (ISO + safe integer)
node scripts/call-target-query.check.js         # OK
npm test -- --run                               # 14 files, 214 tests, 0 échec
npx tsc --noEmit                                # 0 erreur
npx eslint .                                    # 0 erreur
npm run build                                   # succès
git diff --check                                # succès
```

### Fichiers modifiés (fix2)

- `api/calls.js` — maybeSingle/PGRST116, GET error paths, skip/complete update checks, ISO strict
- `api/presets.js` — `Number.isSafeInteger` dans `parsePresetId`
- `api/calls.test.js` — couverture v2 restaurée (58 tests)
- `api/calls-list.test.js` — couverture v2 restaurée (18 tests)
- `api/presets.test.js` — couverture étendue (20 tests)
- `scripts/calls-v2-logic.check.js` — assertions ISO + safe integer

### Préoccupations restantes

- Vérification prod OwnerId (gate post-déploiement, inchangée).
- Intégration UI v2.C avant push/déploiement atomique.
