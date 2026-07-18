# Audit mutualisation — post Lot 1 + Lot 2 — 2026-07-18

**Objectif** : mesurer l'avancement du chantier mutualisation vs l'[audit initial du 2026-07-17](../xos-dechet-dashboard/docs/audits/audit-consolidation-2026-07-17.md), après merge de Lot 1 (apiClient/dates/tokens) et Lot 2 (Button v2/Modal unifié/5 composants promus/règle ESLint).
**Méthode** : lecture directe + grep reproductible (mêmes commandes que l'annexe B de l'audit initial, adaptées) + `eslint`/`vitest`/`tsc` réels. Read-only, aucune modification de code.
**HEAD** : `366416b` (958 tests verts / 1 échec préexistant sans lien avec l'audit, lint 0 erreur / 118 warnings dont 116 attendus).

---

## 1. TL;DR

**Lot 1 est fait à ~95 %, Lot 2 est réel mais partiel.** Le client HTTP et les dates sont mutualisés côté frontend (12/12 call-sites migrés vers `apiFetch`). Les composants promus existent tous et sont réellement importés depuis `components/ui` (pas de doublon local pour Button/Modal/DatePicker/ProgressBar/EmptyState/SegmentedControl) — mais **3 des 7 composants du vivier (`EmptyState`, `Skeleton`, `SegmentedControl`) n'ont quasiment aucun call-site réel**, et `Skeleton` reste ré-implémenté localement dans calls (`ContextSideSkeleton`) et weekly (`Skeleton()` inline). Les boutons natifs sont passés de 134 à **116** (-13 %) : la règle ESLint anti-`<button>` est bien active (116 warnings mesurés, cohérent) mais elle est en `warn`, pas en `error` — rien n'empêche techniquement d'en ajouter.

| Constat | Avant (17/07) | Après (18/07) | Delta |
|---|---|---|---|
| `<button>` natifs (calls+cleaner+os+weekly+hub+auth) | 134 | **116** | -18 (-13 %) |
| `Button` partagé utilisé (fichiers) | 23 | **32** | +9 |
| Header `Authorization: Bearer` fait main (frontend) | 12 | **1** (`crm/usePicklistValues.ts`) | -11 |
| `apiFetch` (apiClient) — call-sites | 0 | **12** | +12 |
| `api/_lib/dates.js` — fichiers consommateurs | 0 (n'existait pas) | **3** | +3 |
| rgba/hex durs CSS (calls/cleaner/weekly) | 162 (99/47/16) | **183** (120/47/16) | +21 (calls seul, gamification récente) |
| `var(--xos-*)` usages (calls+cleaner+weekly+os+ui) | non mesuré tel quel | **996** | — |

---

## 2. Adoption des composants partagés

### 2.1 Éléments natifs restants (hors `components/ui`, hors tests)

| Élément | calls | cleaner | weekly | hub | os | auth | Total |
|---|---|---|---|---|---|---|---|
| `<button>` | 65 | 26 | 1 | 0 | 24 | 0 | **116** |
| `<select>` | 3 (`FilterBuilder.tsx`) | 2 (`OpportunitiesHistoryView.tsx`) | 0 | 1 (`HubApp.tsx`) | 0 | 0 | **6** |
| `<input type="checkbox">` | 1 (`filterControls.tsx:132`) | 0 | 0 | 0 | 0 | 0 | **1** |
| `<input type="date"\|"time">` | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

La règle « no-native » (`docs/design/no-native-elements.md`) est presque respectée pour `date`/`time`/`checkbox` (1 seule fuite : la checkbox de filtre dans `calls/filterControls.tsx`). `<select>` a 6 fuites réparties sur 3 apps.

Vs audit initial (134 `<button>`, 35+6+5=46 `<input>` tous types confondus non détaillés par type) : progrès net sur les boutons, mais le detail select/checkbox n'avait pas été mesuré avant — pas de delta comparable.

### 2.2 Score d'adoption par composant promu

Méthode : un composant compte comme « utilisé » sur un call-site s'il consomme, directement ou via un ré-export/shim local (`export { X } from "../../components/ui/X"`), la version de `components/ui`. Une implémentation **locale et indépendante** (pas de ré-export) compte comme non-migrée.

| Composant | Call-sites réels | Ré-implémentations locales trouvées | Verdict |
|---|---|---|---|
| **Button** | 32 fichiers (calls 16, cleaner 9, weekly 1, hub 2, os 2, auth 1) | 116 `<button>` natifs encore à côté (65 calls, 26 cleaner, 24 os, 1 weekly) | Adoption réelle mais partielle — le vivier et l'improvisation coexistent toujours dans les mêmes fichiers |
| **Modal** | 3 fichiers (`ConfirmDialog.tsx`, `SessionsView.tsx`, `OpportunitiesTable.tsx`) + `useComboOverlay` (fusionné dans `components/ui/useComboOverlay.ts`, 4 call-sites calls via shim `comboOverlay.ts` marqué `@deprecated`) | Aucune trouvée | **Fait** — l'unification Modal/overlay de l'audit initial (§3.3.2) est réalisée |
| **DatePicker** | 7 fichiers calls (via shim `calls/formControls.tsx` → `components/ui/DatePicker`) | Aucune (le doublon `formControls.tsx` a été supprimé, cf commit `eefff75`) | **Fait pour calls** — 0 usage hors calls (cleaner/weekly n'ont pas de date-picker à migrer actuellement) |
| **ProgressBar** | 2 fichiers calls (via shim `calls/ProgressBar.tsx`) | Aucune | **Fait pour calls** — pas de call-site ailleurs |
| **EmptyState** | 1 fichier (`calls/RunnerView.tsx`, via shim `calls/EmptyState.tsx`) | 1 (`cleaner/OpportunitiesCleaningView.tsx` a son propre bloc JSX inline pour l'état vide, n'importe pas `EmptyState`) | **Partiel** — composant promu mais quasi pas adopté hors calls |
| **SegmentedControl** | 3 fichiers via l'alias `ChipGroup` (`calls/filterControls.tsx`, `AccountSearchView.tsx`, `FilterBuilder.tsx`) | Aucune trouvée | **Fait pour calls** — 0 usage cleaner/weekly/os |
| **Skeleton** | **0** | 2 : `calls/ContextSideSkeleton.tsx` (composant GlassCard + texte "Chargement…", pattern maison) et `weekly/WeeklyApp.tsx` fonction `Skeleton()` locale (154 caractères de JSX inline, classes `weekly-skeleton*`) | **Non migré** — composant promu dans `components/ui/Skeleton.tsx` mais jamais consommé |

**Lecture** : 4 composants sur 7 (Button, Modal, DatePicker, ProgressBar, SegmentedControl) montrent une adoption réelle sans doublon local. `EmptyState` est à moitié fait. `Skeleton` est le seul composant du Lot 2 resté lettre morte — sa promotion n'a pas été suivie de migration.

---

## 3. Adoption de `apiClient`

- `Authorization:.*Bearer` construit à la main :
  - **Frontend (`src/`)** : **1 fichier** — `src/apps/crm/usePicklistValues.ts:146` (fetch nu, non migré). C'est aussi le seul fichier avec un test qui échoue actuellement (`usePicklistValues.test.ts`, échec préexistant sur HEAD, sans rapport avec ce fetch — voir §6).
  - **Backend (`api/`)** : 7 fichiers (`status.js`, `auth.js`, `_auth.js`, `launcher.js`, `crm/picklists.js`, `_crm/salesforceOAuth.js`, `_crm/salesforce.js`) — **hors périmètre `apiClient.ts`**, ce sont des appels serveur→Salesforce (OAuth), pas des appels client→API xOS. Non concernés par le Lot 1.
- `import.*apiFetch` : **12 fichiers** — correspond exactement aux 12 call-sites listés dans l'audit initial (§Annexe A). Migration Lot 1 frontend **complète** à l'exception de `usePicklistValues.ts` qui n'était pas dans la liste d'origine (fichier ajouté/modifié après l'audit initial, jamais migré).
- `api/_lib/dates.js` : utilisé par **3 fichiers** (`api/perf.js`, `api/_calls/prospectionCockpit.js`, `api/_calls/http.js`). `src/lib/dates.ts` (frontend) utilisé par **4 fichiers** (`components/ui/DatePicker.tsx`, `calls/PilotageView.tsx`, `calls/formControls.helpers.ts`, `calls/sessionLifecycle.ts`).

**Score Lot 1 (client HTTP + dates) : 12/13 call-sites frontend migrés (92 %), backend dates adopté sur les 3 fichiers qui en avaient besoin.**

---

## 4. Adoption des tokens sémantiques

- `var(--xos-*)` : calls 417, cleaner 220, weekly 149, hub 25, os 97, components/ui 88 — **996 usages** au total. La palette est largement utilisée partout où du CSS existe.
- Nouveaux tokens sémantiques ajoutés au Lot 1 (`--xos-surface-1`, `--xos-surface-2`, `--xos-success`, `--xos-danger`, `--xos-warning`, `--xos-glass-*`, définis dans `src/os/theme.css`) : **adoption très faible** — 1 fichier consommateur pour `surface-1`/`surface-2`/`success`/`glass`, 2 pour `danger`, **0 pour `warning`**. Les tokens existent mais n'ont pas encore été poussés dans les apps.
- rgba/hex codés en dur restants (hors `theme.css`, qui définit légitimement les tokens) :
  - calls **120** (vs 99 à l'audit initial — en hausse, portée par le CSS gamification récent : XP/badges/streaks, commits `767fae4`/`3488ca6`, couleurs de médailles/tiers non tokenisées)
  - cleaner **47** (inchangé)
  - weekly **16** (inchangé)
  - os **120** hors `theme.css` (non mesuré à l'audit initial), concentré dans `desktop.css` (77), `launcher.css` (26), `controlCenter.css` (13)

**Lecture** : le remplacement « au fil de l'eau » annoncé au Lot 1 n'a pas eu lieu — les rgba/hex n'ont pas diminué, ils ont même augmenté côté calls avec les nouvelles features. Les tokens sémantiques ajoutés (success/danger/warning/surfaces) sont sous-exploités.

---

## 5. Règle ESLint anti-`<button>` natif

- Scope : `src/apps/**`, `src/os/**`, `src/auth/**` (bien aligné avec le périmètre de l'audit).
- Niveau : `"warn"` (pas `"error"`) → n'échoue pas le build/CI, n'empêche pas un commit.
- Mesure réelle (`npm run lint`) : **116 warnings `no-restricted-syntax`** sur 118 warnings totaux (2 autres = `react-refresh/only-export-components`), 0 erreur. Cohérent avec le comptage grep du §2.1.
- La règle verrouille la *régression* (visible dans les warnings) mais ne bloque rien tant qu'elle reste en `warn`.

---

## 6. Autres observations

- `INEFFECTIVE_DYNAMIC_IMPORT` sur `RecettesModule` (item 12 du Lot 3 de l'audit initial, §2.3.3) : **toujours présent** au build (`vite build` l'affiche encore). Pas dans le périmètre Lot 1/2, mais c'est un fix d'une ligne resté en attente.
- Test unitaire en échec sur HEAD (`src/apps/crm/usePicklistValues.test.ts`, `958 passed / 1 failed`) : le test attend un `fetch` avec `Content-Type` et sans `cache: "no-store"`, alors que le code produit l'inverse. Pré-existant, sans lien avec des modifications faites pendant cet audit (aucune, celui-ci est read-only) — probablement une dérive introduite par un commit récent sur `usePicklistValues.ts` (le même fichier qui n'a jamais été migré vers `apiFetch`, cf §3). À investiguer séparément.

---

## 7. Top 5 fichiers à migrer en priorité (quick wins)

| # | Fichier | Pourquoi en priorité |
|---|---|---|
| 1 | `src/apps/calls/SessionsView.tsx` | 16 `<button>` natifs — le plus gros foyer restant, alors que le fichier importe déjà `Button`/`Modal`/`GlassCard`/`Tag` depuis `components/ui` : migration mécanique, pas de nouveau pattern à inventer |
| 2 | `src/apps/calls/PilotageView.tsx` | 12 `<button>` natifs, déjà consommateur de `src/lib/dates.ts` — cohérent avec l'effort Lot 1/2 en cours sur ce fichier |
| 3 | `src/os/ControlCenter.tsx` | 9 `<button>` natifs — os n'a que 2 fichiers sur `Button` partagé (`os` est la app la moins migrée en proportion) |
| 4 | `src/apps/crm/usePicklistValues.ts` | **Seul** fetch frontend encore hors `apiClient` (header Bearer fait main) — 1 ligne à changer, referme le Lot 1 à 100 %, et corrige probablement le test en échec au passage |
| 5 | `src/apps/weekly/WeeklyApp.tsx` | Réimplémentation locale de `Skeleton()` — seul gros morceau bloquant l'adoption de `components/ui/Skeleton`, qui est à 0 call-site aujourd'hui |

---

## 8. Prochaines actions pour finir Lot 1 + Lot 2

1. Migrer `crm/usePicklistValues.ts` vers `apiFetch` → ferme le Lot 1 (0 header Bearer fait main côté frontend).
2. Migrer `Skeleton` dans `weekly/WeeklyApp.tsx` et `calls/ContextSideSkeleton.tsx` vers `components/ui/Skeleton` (ou documenter pourquoi ces deux cas restent des variantes maison si le composant partagé ne couvre pas leur besoin — sinon le composant promu reste mort).
3. Migrer `EmptyState` dans `cleaner/OpportunitiesCleaningView.tsx` (le bloc JSX inline existe déjà, remplacement direct).
4. Attaquer les 3 fichiers du top 5 à forte densité de `<button>` natifs (`SessionsView`, `PilotageView`, `ControlCenter`) — à eux seuls ils représentent 37 des 116 boutons restants (32 %).
5. Passer la règle ESLint `no-restricted-syntax` de `"warn"` à `"error"` une fois le stock résiduel sous un seuil raisonnable (ex. <20), pour verrouiller réellement la régression.
6. Pousser les nouveaux tokens sémantiques (`--xos-success`, `--xos-danger`, `--xos-warning`, `--xos-surface-*`) dans le CSS gamification récent (calls) qui a ajouté 21 rgba/hex durs au lieu de les consommer.
7. Fix d'une ligne : import statique de `RecettesModule` dans `CleanerShell` (Lot 3, item resté ouvert).

---

## Annexe — Commandes reproductibles

```bash
# Boutons natifs par app
for d in src/apps/calls src/apps/cleaner src/apps/weekly src/apps/hub src/os src/auth; do
  grep -rE '<button' $d --include='*.tsx' | grep -v '\.test\.' | wc -l
done

# Adoption Button (import direct depuis components/ui)
grep -rlE "import.*\bButton\b.*from.*components/ui" src/apps src/os src/auth --include='*.tsx' | grep -v '\.test\.'

# Header Authorization fait main (frontend)
grep -rln "Authorization.*Bearer" src --include='*.ts*' | grep -v '\.test\.'

# apiFetch call-sites
grep -rln "import.*apiFetch" src --include='*.ts*' | grep -v '\.test\.'

# Tokens vs rgba/hex durs
grep -roE "var\(--xos-[a-z0-9-]+" src/apps/calls --include='*.css' | wc -l
grep -roE "rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b" src/apps/calls --include='*.css' | wc -l

# Warnings ESLint réels
npm run lint
```
