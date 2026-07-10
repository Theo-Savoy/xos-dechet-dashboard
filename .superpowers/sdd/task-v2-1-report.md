# Rapport Lot v2.1 — Ajustements Call Manager

Branche : `Theo-Savoy/xos-cm-v2-1-adjust`. Base : `d2bab01`.

## État RED initial (avant correctifs)

```bash
npm test -- --run
# Test Files  17 passed (17)
# Tests  170 passed (170)
```

Le code de départ passait la suite existante, mais les 9 points du brief étaient absents ou incorrects :
- SOQL `NOT IN (SELECT WhoId FROM Task …)` dans `buildTargetQuery` (HTTP 400 en prod)
- Secteurs en saisie libre (`TagInput`)
- Filtres durée min/max encore actifs
- Pas de presets Fonction
- Aperçu / séance sans `title`, `linkedin_url`, sélection, limite, date
- Erreur `contacts_creation_failed` ambiguë

Tests ciblés ajoutés d'abord → RED observé sur les assertions v2.1, puis implémentation → GREEN.

## Cycle TDD RED → GREEN

### 1. [Critical] Filtres relance — SOQL Task anti/semi-jointure

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls-list.test.js -t "fetches wide when relance predicates"` | SOQL contenait `LAST_N_DAYS` / `NOT IN (SELECT … Task)` | Sous-requêtes Task supprimées ; `LIMIT 2000` si filtre relance actif |
| `api/calls-list.test.js -t "applies relance predicates from Tasks"` | `jamais_appele` / `dernier_appel_*` non filtrés en JS | `filterTargetContacts` applique les 3 prédicats sur l'enfant `Tasks` |
| `scripts/call-target-query.check.js` | Assertions `LAST_N_DAYS` | Assertions JS + `LIMIT 2000`, pas de `NOT IN Task` |

### 2. Secteurs — picklist multi-sélection

| Test ciblé | RED | GREEN |
|---|---|---|
| `CallManagerFixes.test.tsx -t "uses CRM-generic copy"` | `TagInput` libre, pas de recherche | `PicklistMultiSelect` sur `SECTEUR_VALUES` (51 valeurs, filtre + cases) |
| `mapping.js` / `src/crm/index.ts` | Pas de liste org | `industries` backend + miroir front |

### 3. Suppression durée min/max

| Test ciblé | RED | GREEN |
|---|---|---|
| `CallManagerFixes.test.tsx -t "Durée min"` | Inputs visibles | Champs retirés de `FilterBuilder` et `FilterTree` |
| `api/calls-list.test.js -t "ignores legacy duration keys"` | Filtrage par durée | `filterTargetContacts` ignore `duree_*` des vieux presets |

### 4. Filtre Fonction par presets

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls-list.test.js -t "fonction preset clauses"` | Pas de clause `Title` | `fonctionPresets` dans mapping + SOQL `(LIKE … OR IN …)` groupé par OR |
| `FilterBuilder` section Contact | Absent | `ChipGroup` sur les 4 presets |

### 5. Aperçu enrichi + persistance séance

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls-list.test.js -t "contacts and dedup"` | DTO sans `title`/`linkedin_url`/email/mobile | SELECT SOQL + `normalizeContacts` enrichi |
| `api/calls.test.js -t "persists title and linkedin_url"` | Colonnes non insérées | `create_session` persiste `title`, `linkedin_url` |
| `CallManagerFixes.test.tsx -t "shows title and LinkedIn"` | Runner sans poste/lien | `RunnerView` affiche poste + lien `_blank` |

### 6. Sélecteur limite contacts

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls-list.test.js -t "boundedLimit accepts up to"` | Cap 500 | `boundedLimit` → 2000 (`SOQL_FETCH_CAP`) |
| `FilterBuilder` footer | Pas de sélecteur | 50…500 + « Pas de limite (max 2000) » |

### 7. Sélection contacts avant création

| Test ciblé | RED | GREEN |
|---|---|---|
| `CallManagerFixes.test.tsx -t "deselect contacts"` | Tous les contacts envoyés | Cases à cocher, tout sélectionner/désélectionner, compteur X/Y |

### 8. Date de séance

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls.test.js -t "invalid scheduled_for"` | Pas de validation | `isValidScheduledFor` strict → 400 `invalid_scheduled_for` |
| `SessionsView` | Seulement `created_at` | Affiche `scheduled_for` si présent |
| `007_call_manager_v2_1.sql` | — | `scheduled_for date` (écrite, non appliquée) |

### 9. Message d'erreur création liste

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls.test.js -t "contact insert fails"` | `contacts_creation_failed` | `session_contacts_insert_failed` |
| `CallManagerApp` / tests UI | Message générique | « Échec d'enregistrement de la liste d'appels (base de données) » |

## Commandes gate de sortie (GREEN final)

```bash
node scripts/call-target-query.check.js          # OK
node scripts/calls-v2-logic.check.js             # OK
npm test -- --run                                # 17 files, 243 tests, 0 échec
npx tsc --noEmit                                 # 0 erreur
npx eslint .                                     # 1 warning préexistant react-refresh/only-export-components
npm run build                                    # succès
git diff --check                                 # succès
```

## Fichiers modifiés

- `api/_crm/mapping.js` — industries, fonctionPresets, champs contact enrichis
- `api/_crm/salesforce.js` — relance JS, LIMIT 2000, fonctions SOQL, champs SELECT
- `api/calls-list.js` — DTO enrichi, troncature post-filtre relance
- `api/calls.js` — `scheduled_for`, `title`/`linkedin_url`, erreur renommée
- `api/calls-list.test.js`, `api/calls.test.js` — tests v2.1
- `src/crm/index.ts`, `src/crm/index.test.ts` — miroir org + types
- `src/apps/calls/**` — UI filtres, aperçu, sélection, date, runner
- `scripts/call-target-query.check.js` — assertions relance v2.1
- `supabase/migrations/007_call_manager_v2_1.sql` — **écrite, non appliquée**

## Préoccupations restantes

- Migration `007` à appliquer en prod par le coordinateur avant utilisation de `scheduled_for` / `title` / `linkedin_url`.
- Filtres relance avec `LIMIT 2000` : au-delà de 2000 contacts CRM correspondant aux filtres entreprise/contact, la troncature post-JS peut omettre des résultats — comportement documenté et aligné sur le plafond SOQL.

## Correctifs post-revue (I1 / I2 / M3)

### I1 — Presets v2.0 crashent FilterBuilder (`contact.fonctions` undefined)

| Test ciblé | RED | GREEN |
|---|---|---|
| `src/crm/index.test.ts -t "fills missing v2.1 keys"` | `fonctions` absent → crash ChipGroup | `normalizeFilterTree()` fusionne avec `emptyFilterTree()`, ignore `duree_*` |
| `CallManagerFixes.test.tsx -t "normalized v2.0 preset"` | FilterBuilder plante au chargement | `CallManagerApp.handleLoadPreset` normalise avant `setFilters` |

### I2 — Mode dédup « Exclure » neutralisé

| Test ciblé | RED | GREEN |
|---|---|---|
| `CallManagerFixes.test.tsx -t "Avertir mode"` | Tag masqué hors mode avertir | Tag « Déjà en séance » affiché dans les deux modes |
| `CallManagerFixes.test.tsx -t "Exclure mode"` | Doublons cochés malgré Exclure | Décochés par défaut en Exclure, re-cochables à la main |

### M3 — Secteurs texte libre hors picklist invisibles

| Test ciblé | RED | GREEN |
|---|---|---|
| `CallManagerFixes.test.tsx -t "obsolete chips"` | Valeur hors liste invisible | Chips « obsolète » retirables au-dessus de la picklist |

### Gate post-correctifs

```bash
npm test -- --run    # 17 files, 249 tests, 0 échec
npx tsc --noEmit     # 0 erreur
npx eslint .         # 1 warning toléré react-refresh/only-export-components
npm run build        # succès
git diff --check     # succès
```

