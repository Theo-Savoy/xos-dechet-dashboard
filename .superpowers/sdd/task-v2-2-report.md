# Rapport Lot v2.2 — Presets fonction élargis + opacité fenêtres

Branche : `Theo-Savoy/xos-cm-v2-2-adjust`. Base : `6aca2bf` (main avec v2.1).

## État RED initial (avant correctifs)

```bash
npm test -- --run api/calls-list.test.js -t "responsable_rh"
# FAIL — preset responsable_rh absent du mapping, aucune clause SOQL Title LIKE
```

Les 7 nouveaux presets RH/org, les enrichissements v2.1 et l'opacité du contenu fenêtre étaient absents.

## Cycle TDD RED → GREEN

### 1. Presets Fonction élargis + enrichissement v2.1

| Test ciblé | RED | GREEN |
|---|---|---|
| `api/calls-list.test.js -t "mirrors front FONCTION_PRESETS"` | 4 presets seulement | 11 presets synchrones backend ↔ `src/crm/index.ts` |
| `api/calls-list.test.js -t "responsable_rh preset clauses"` | Pas de clause `%responsable rh%` / IN RRH,HRBP | `fonctionPresets` enrichi dans `mapping.js` + miroir front |
| `api/calls-list.test.js -t "unknown fonction presets"` | (passait déjà — comportement documenté) | `buildFonctionConditions` ignore les ids inconnus sans crash |
| `scripts/call-target-query.check.js` | Pas d'assertions RH | Assertions `responsable_rh`, `directeur_rh`, preset inconnu |

**Nouveaux presets** : `responsable_rh`, `developpement_rh`, `directeur_rh`, `pedagogie`, `sirh`, `recrutement`, `direction_generale`.

**Enrichissements v2.1** :
- `charge_formation` : +5 likes (`training project manager`, `coordinat%formation%`, etc.)
- `directeur_formation` : + `%training director%`, `%head of learning%`
- `digital_learning_manager` : + exact `DLM`

Variantes accentuées/non accentuées fournies pour SOQL (ex. `%développement rh%` + `%developpement rh%`, `%pédagogique%` + `%pedagogique%`).

### 2. Fenêtres XOS — contenu opaque, titlebar verre

| Aspect | Avant (v2.1) | Après (v2.2 final) |
|---|---|---|
| `.xos-window` | `background: rgba(5,9,31,0.9)` + `backdrop-filter: blur(24px)` sur toute la fenêtre | **Inchangé sur la coque** : `--xos-window-shell-bg` (= `rgba(5,9,31,0.9)`) + `backdrop-filter` — le verre reste actif sur la titlebar |
| `.xos-window__titlebar` | `background: rgba(255,255,255,0.035)` (translucide, blur hérité du parent) | **Inchangé** : même fond léger ; le blur du parent `.xos-window` floute le wallpaper visible à travers |
| `.xos-window__content` | Héritait la transparence (wallpaper visible, lisibilité faible) | `background: var(--xos-window-content-bg)` (#0a1129, 100 % opaque) — masque le fond, le blur parent ne s'applique pas visuellement au contenu |
| Variables | — | `--xos-window-shell-bg` (coque translucide), `--xos-window-content-bg` (zone contenu) dans `theme.css` |

Pas de changement DOM. `overflow: hidden` et `border-radius` conservés. États **focus** (`.xos-rnd-window:focus-within .xos-window` → bordure plus claire) et **maximisé** (`.xos-rnd-window--maximized .xos-window` → `border-radius: 0`, pas de bordure) : aucune règle de fond modifiée, comportement identique.

## Commandes gate de sortie (GREEN final)

```bash
node scripts/call-target-query.check.js          # OK
node scripts/calls-v2-logic.check.js             # OK
npm test -- --run                                # 17 files, 252 tests, 0 échec
npx tsc --noEmit                                 # 0 erreur
npx eslint .                                     # 1 warning préexistant react-refresh/only-export-components
npm run build                                    # succès
git diff --check                                 # succès
```

## Fichiers modifiés

- `api/_crm/mapping.js` — 7 nouveaux presets + enrichissements v2.1
- `src/crm/index.ts` — miroir `FONCTION_PRESETS` (11 entrées)
- `api/calls-list.test.js` — sync mirror, responsable_rh SOQL, preset inconnu
- `scripts/call-target-query.check.js` — assertions presets RH
- `src/os/theme.css` — variables fond fenêtre
- `src/os/desktop.css` — opacité contenu, verre titlebar

## Préoccupations restantes

- Les presets `pedagogie`, `sirh`, `recrutement`, `direction_generale` sont identifiés dans les données org mais non validés en usage réel — à ajuster si des intitulés fréquents manquent.
- Le fond opaque `#0a1129` est une approximation du rendu perçu de `rgba(5,9,31,0.9)` sur le wallpaper ; affiner si le contraste titlebar/contenu semble trop marqué en prod.

## Correctifs post-revue (I1 / M1 / M2)

### I1 — Fond opaque sur `.xos-window` tuait le verre de la titlebar

| Problème | Correctif |
|---|---|
| Première implémentation posait `--xos-window-content-bg` (opaque) sur `.xos-window` entier → `backdrop-filter` de la titlebar sans wallpaper visible derrière | Coque restaurée : `--xos-window-shell-bg` translucide + `backdrop-filter` sur `.xos-window` ; opacité 100 % uniquement sur `.xos-window__content` |

### M1 — Double fond redondant

Résolu par I1 : plus de `--xos-window-content-bg` sur le conteneur, seule la zone contenu porte le fond opaque.

### M2 — Rapport avant/après inexact

Tableau §2 mis à jour pour décrire le rendu réel (coque translucide + blur parent, contenu opaque isolé).
