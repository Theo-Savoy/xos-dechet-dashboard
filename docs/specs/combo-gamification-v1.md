# Combo — Gamification, Nudges & Mécaniques d'engagement (V1)

**Statut** : draft — à figer après retours test utilisateur.
**Cible** : Combo (`src/apps/calls/`) + système de notifications centralisé (`src/os/notifications.ts`).
**Voir aussi** : `docs/xos_implementation_plan.md` Phase 5 (Arena), `docs/xos_portal_plan.md` §5. Cette spec couvre **uniquement la couche personnelle** (XP, badges, streaks, nudges, mur des réussites local). Le moteur de challenges d'équipe (Arena Phase 5 lots 5.1/5.2) reste dans son propre chantier — voir §11.

---

## 0. Principes directeurs (non négociables)

1. **Le canal de notification est découplé du contenu.** Combo déclenche des événements ; le système de notifs (`/api/notifications` + `notificationsStore` + `DesktopToasts`) décide du rendu (toast desktop, centre de notifs, push futur). Combo ne s'auto-toast pas.
2. **Aucun mécanisme ne harcèle.** Pas de rappel intrusif après X jours d'inactivité. Pas de popup "Tu n'as pas ouvert Combo !". Si le canal notifs est coupé par l'utilisateur, l'expérience reste fonctionnelle — la gamification disparaît avec.
3. **Un seul défi collectif actif à la fois.** La surcharge cognitive tue la gamification.
4. **Le local-first prévaut.** Tous les compteurs personnels (raccourcis, streaks, badges one-timer) vivent en `localStorage` indexé par `user_id`. Pas de migration Supabase pour les compteurs.
5. **Les achievements ne sont JAMAIS compétitifs.** Pas de leaderboard. Pas de rang. Si l'utilisateur veut apparaître nommé, c'est opt-in explicite.

---

## 1. Système d'XP et de badges

### 1.1 Modèle : badges + XP, pas de niveaux numériques

**Décision tranchée** : pas de "Niveau 12, 2450 XP". On a un système de **badges débloqués** qui donnent de l'XP, et des **paliers par axe** qui se franchissent sur l'XP cumulé.

Chaque badge = **événement vérifiable** dans l'app. L'XP est **affichée comme un compteur cumulatif par axe**, jamais comme une barre RPG.

### 1.2 Les 3 axes d'XP

| Axe | Nom terrain | Source XP | Badge emblématique | Affichage |
|---|---|---|---|---|
| **Vitesse** | "Boss du clavier" | 1 XP / raccourci utilisé | ⌨️ Boss du clavier (200 XP) | Compteur dans command bar |
| **Impact** | "Cador du RDV" | 10 XP / RDV planifié | 🎯 Centurion (10 RDV = 100 XP) | Compteur dans récap séance |
| **Régularité** | "Infernal" | 1 XP / jour de streak (≥ 1 log_call) | 🔥 30 jours d'affilée (30 XP) | Compteur dans command bar |

**Règles anti-abus** :
- Raccourci compté une seule fois par jour par action (toggle-recall spam-exclu).
- RDV compté si `outcome = "RDV planifié"` ET `log_call` réussi (Task SF créée).
- Streak = jour calendaire Europe/Paris où ≥ 1 log_call validé.

### 1.3 Paliers par axe (Bronze → Challenger)

Affichés **uniquement** comme un indicateur de progression (ex. "Bronze vitesse · 30/75"), jamais comme un titre ("Tu es Bronze vitesse").

| Palier | Vitesse (raccourcis cumulés) | Impact (RDV cumulés) | Régularité (streak jours) |
|---|---|---|---|
| Bronze | 10 | 3 | 3 |
| Argent | 30 | 7 | 7 |
| Or | 75 | 15 | 14 |
| Platine | 150 | 30 | 30 |
| Diamant | 300 | 60 | 60 |
| Challenger | 500 | 100 | 100 |

**Pas de palier global.** Chaque axe a sa progression indépendante.

### 1.4 Badges one-timer (mécanique variée)

Ajoutées pour diversifier — pas seulement de la progression cumulée. **Chaque badge one-timer = un comportement exceptionnel, pas une accumulation.**

| Badge | Critère | Type |
|---|---|---|
| 🐣 Premier pas | 1ʳᵉ séance complétée | One-timer |
| ⚡ Éclair | 50 raccourcis en une seule journée | One-timer |
| 🎯 Trois banderilles | 3 RDV dans une même séance | One-timer |
| 🌅 Lève-tôt | 1 séance démarrée avant 9h | One-timer |
| 🏁 Marathon | 1 séance ≥ 50 contacts terminée | One-timer |
| 🧊 Sang-froid | 10 NPA posées | One-timer |
| 🤝 Relais | A contribué à un défi collectif atteint | One-timer (collectif) |
| 🏆 Mur des réussites | A signé (opt-in) une réussite qu'un manager a épinglée | One-timer |

**Limite** : 8 badges one-timer max en V1. Au-delà, on perd la lisibilité. Si on en veut plus, c'est un lot dédié.

### 1.5 Stockage et détection

**Source unique de vérité** : événements observés côté front, pas de re-calcul a posteriori depuis la DB.

- `localStorage["xos-combo-xp:<user_id>"]` → `{ vitesse: number, impact: number, regularite: number, badges: string[], lastSeen: ISO }`
- Recalculable depuis les events de la journée si besoin (cleared storage).
- Détection de palier = diff `previousXp < palier && newXp >= palier`.
- Détection de badge one-timer = `if (!badges.includes(badgeId) && criteria(...))`.

### 1.6 Affichage (où, quand, combien)

| Endroit | Quoi | Pourquoi |
|---|---|---|
| **Command bar** (`⌘K`) | 3 lignes "Vitesse 30 · Impact 7 · Régularité 14" + dernier badge one-timer | L'utilisateur qui cherche à aller vite voit son état |
| **Récap de séance** | 1 ligne par axe + palier actuel + badge one-timer gagné dans la séance | Célébration sobre post-effort |
| **Au moment du déblocage** | Toast desktop 6s via `notificationsStore` ("Argent vitesse · 30/75 raccourcis cumulés") | Le bon moment |
| **Centre de notifications** | Historique des badges débloqués | Persistance |

**Jamais affiché** :
- ❌ Home du bureau XOS
- ❌ Titre de la fenêtre Combo
- ❌ Popup bloquante au démarrage
- ❌ Badge permanent dans la barre latérale

---

## 2. Nudges — 5 mécanismes, sobres

### 2.1 Nudge de cadrage (pré-séance)

**Canal** : `PreSessionFlow.tsx`, dans l'UI uniquement (pas de notif externe).
**Déclencheur** : ouverture de Combo et présence de données contextuelles.

| Condition | Affichage | Source |
|---|---|---|
| ≥ 1 rappel dû aujourd'hui | "Commence par les rappels : X dûs aujourd'hui" (encart surligné léger, lien direct) | `recallQueue.ts` |
| Dernière séance > 7 jours | "Ça fait une semaine — on reprend avec tes presets ?" | `localStorage` lastSession |
| Défi collectif actif en cours | Affichage du compteur équipe ("47/100 RDV cette semaine") | notif push dédiée |
| Aucune condition vraie | Rien | — |

**Règle** : si rien à suggérer → silence. Pas de phrase vide de remplissage.

### 2.2 Nudge de saisie (pendant le runner)

**Canal** : `RunnerView.tsx`, dans l'UI, intégré au formulaire de log.
**Déclencheur** : choix d'un résultat.

- **Templates de note** : 5 chips cliquables sous le champ commentaire, contextualisés par résultat.
- **Templates communs** :
  - *Intérêt produit A / B / C* (boutons toggle)
  - *Temporalité* : "Décision ce trimestre" / "Décision Q+1" / "Pas de projet"
  - *Niveau de maturité* : "Curieux" / "Évalue" / "Compare"
  - *Mini MEDDIC lite* : "Métrique identifiée", "Champion identifié", "Décideur connu"
- **Comportement** : clic sur un chip → ajoute le tag au commentaire avec une virgule de séparation. Pas de wizard, pas de popover.

**Pourquoi c'est mieux qu'un MEDDIC complet** : MEDDIC complet = friction, abandon. Les chips = 1 clic = information collectée.

**Pourquoi je retire ma proposition précédente (pré-remplissage du commentaire)** : tu as raison, ça supprime la liberté d'écriture. Les **chips** sont un compromis : l'utilisateur écrit ce qu'il veut, mais a des raccourcis pour les champs répétitifs.

### 2.3 Nudge de fin de séance (post-séance)

**Canal** : `RecapView.tsx`, dans l'UI, plus une notif si palier/badge débloqué.
**Déclencheur** : `complete_session`.

**Affichage dans le récap** (sobre, jamais moralisateur) :

| Métrique | Affichage | Condition |
|---|---|---|
| Rythme | "4,8 appels/min · 6 min/appel en moyenne" | Toujours |
| Record | "Nouveau record hebdo : 124 appels cette semaine" | Si vrai, jamais "tu n'as pas battu" |
| Top résultat | "70% des appels décrochés — au-dessus de ta moyenne (52%)" | Si au-dessus de la médiane 4 dernières |
| Séance 2 suggérée | "5 contacts non contactés — créer la séance de relance du {date_lendemain} ?" | Si ≥ 1 contact pending/skipped |
| Séance abandonnée | "Séance clôturée sans être terminée — X contacts à trancher" | Si status passée à completed avec > 0 pending |

**Règle** : les suggestions positives uniquement. Pas de "Tu aurais pu faire mieux". Si la métrique est dans la moyenne, on l'affiche aussi ("Tu es dans ta moyenne, 47 appels/min") — pas de frustration.

### 2.4 Nudge de streak (inter-séances, opt-in)

**Canal** : command bar (toujours) + notif toast au franchissement de palier.
**Déclencheur** : `log_call` réussi.

- Compteur = jours calendaires Europe/Paris où ≥ 1 log_call validé.
- Reset si journée vide (pas d'exception week-end, le commercial décide).
- Opt-in : dans les préférences Combo, toggle "Suivi du streak (recommandé)" — défaut ON.

**Affichage streak** :
- Tag compact dans la command bar : "🔥 14 jours"
- Si streak en danger (pas encore loggué aujourd'hui, hier comptait) → **pas de notif push** pour ne pas culpabiliser. Juste l'affichage command bar.

**Streaks composites (variation de mécanique)** :

| Streak | Critère | Affichage |
|---|---|---|
| Streak classique | X jours d'affilée avec ≥ 1 log_call | 🔥 |
| Streak "productif" | X séances avec ≥ 3 RDV chacune | 🎯 |
| Streak "intense" | X séances à ≥ X appels | ⚡ |

Affichés **simultanément** dans la command bar (3 lignes max). Chacun a son propre palier Bronze → Challenger.

### 2.5 Nudge d'apprentissage (progressif, récurrent)

**Canal** : notif toast desktop (court) + UI dans le formulaire si pertinent.
**Déclencheur** : compteur d'actions souris vs clavier, avec **décroissance contrôlée**.

**Modèle de décroissance** (ta proposition, validée) :

Pour chaque raccourci `R` non encore adopté par l'utilisateur :

| Phase | Condition d'affichage | Fréquence |
|---|---|---|
| **Intensive** | 5 actions souris consécutives sur la cible | À chaque occurrence |
| **Régulière** | ≥ 10 actions souris depuis dernier nudge `R` | 1 fois / session |
| **Espacée** | ≥ 30 actions cumulées | 1 fois / semaine |
| **Acceptée** | ≥ 3 rappels vus sans adoption | Plus jamais (l'utilisateur a fait un choix, on respecte) |

**Implémentation** : état persistant `localStorage["xos-combo-nudge-learning:<user_id>"]` =
```
{
  [shortcutId]: { mouseCount, lastNudgeAt, nudgesSeen, phase }
}
```

**Exemple** :
- L'utilisateur clique 5 fois sur "Suivant" → toast : "Tu peux faire ça avec `K` · tape `?` pour la liste"
- Il clique encore 5 fois → re-toast
- À 30 clics cumulés → 1 fois cette semaine max
- À 3 rappels vus → silence, l'utilisateur a tranché

**Texte type** (terrain, jamais condescendant) :
> "Tu peux passer au contact suivant avec `K` — c'est 0,3s au lieu de 0,8s à la souris."

**Liste des raccourcis ciblés** (V1) :

| Action souris | Raccourci | Jauge min (intensive) |
|---|---|---|
| Bouton "Suivant" | `K` | 5 clics |
| Bouton "Précédent" | `J` | 5 clics |
| Bouton "Vue liste" | `L` | 3 clics |
| Bouton "Vue fiche" | `F` | 3 clics |
| Bouton "Logguer & suivant" | `⌘↵` | 5 clics |
| Bouton "Aide raccourcis" | `?` | 5 clics |
| Clic résultat 1-5 | `1`-`5` | 5 clics |

**Pas de nudge apprentissage pour** :
- Command bar (`⌘K`) — l'utilisateur le découvrira naturellement
- Toggle sons — niche
- Replay démo — opt-in volontaire

---

## 3. Nudges envoyés via le système de notifications

**Tous les événements ci-dessous passent par `/api/notifications`** avec un `kind` discriminant. Combo déclenche l'événement, le système de notifs décide du canal (toast desktop, centre, futur push).

### 3.1 Kinds de notifications à ajouter

| `kind` | Émetteur | Condition | Payload |
|---|---|---|---|
| `xp_palier_atteint` | Combo (front) | `newXp >= palier && previousXp < palier` | `{ axe: "vitesse" \| "impact" \| "regularite", palier: "bronze" \| ... }` |
| `badge_one_timer` | Combo (front) | Critère rempli une fois | `{ badgeId: string }` |
| `streak_palier_atteint` | Combo (front) | Idem XP | `{ type: "classique" \| "productif" \| "intense", jours: number }` |
| `rappels_du_jour` | Système (cron supabase) | À 9h30 Europe/Paris si ≥ 1 rappel dû aujourd'hui pour le user | `{ count: number }` |
| `seance_a_trancher` | Système (cron supabase) | Séance `status=active` > 48h sans log | `{ sessionId, pendingCount }` |
| `defi_collectif_atteint` | Système (cron supabase hebdo) | Compteur équipe atteint l'objectif | `{ defiId, total }` |
| `mur_reussite_signee` | Manager (action manuelle) | Manager épingle une réussite avec opt-in | `{ authorName, badgeId }` |

### 3.2 Comportement attendu par le système de notifs

Le système de notifs actuel (`DesktopToasts.tsx`, `notifications.ts`) doit :

1. **Étendre `isToastNotification()`** pour couvrir les nouveaux kinds.
2. **Mapper chaque kind à une icône/tag** dans le toast.
3. **Respecter `prefers-reduced-motion`** pour les célébrations (déjà géré).
4. **Garder la durée de toast à 6s** par défaut (pas de rallonge pour la gamification).
5. **Permettre la réaction emoji** sur les kinds célébratoires (`xp_palier_atteint`, `badge_one_timer`, `streak_palier_atteint`, `defi_collectif_atteint`, `mur_reussite_signee`) — réutilise l'infrastructure `goal_reaction` existante.

### 3.3 Anti-pattern notif

- ❌ Pas de notif "Tu n'as pas ouvert Combo aujourd'hui"
- ❌ Pas de notif si streak en danger (silence, l'utilisateur a la command bar)
- ❌ Pas de notif "Tu n'as pas battu ton record"
- ❌ Pas de notif pour chaque raccourci utilisé (saturation)
- ❌ Pas de cumul de plusieurs notifs dans la même journée sur le même axe

---

## 4. UX Writing — modale de pré-séance

### 4.1 Diagnostic

La modale actuelle (`PreSessionFlow.tsx`) charge trop l'utilisateur. Trois problèmes :

1. **Trop de sections empilées** (mode ABM, mode ciblage, mode rappel, mode nouveau) sans hiérarchie claire.
2. **Le champ nom est noyé** au milieu des autres inputs — l'utilisateur ne sait pas où focaliser son attention.
3. **Vocabulaire technico-produit** ("engagement", "presets", "audience") là où on attend du terrain.

### 4.2 Principes de réécriture

- **Terrain, jamais technico-fonctionnel.**
- **Une section active à la fois** (étapes claires).
- **Sticky le bloc critique** (nom + lancer).
- **Verbes d'action en première position.**

### 4.3 Nouvelle structure (proposition)

```
┌──────────────────────────────────────────┐
│  Préparer ta séance                      │
├──────────────────────────────────────────┤
│                                          │
│  1. Comment on commence ?                 │
│     ○ Rappels à faire aujourd'hui (X)     │
│     ○ Nouvelle cible à prospecter         │
│     ○ Comptes précis (ABM)                │
│     ○ Reprendre une séance précédente     │
│                                          │
├──────────────────────────────────────────┤
│  2. [Section contextuelle au choix]       │
│     [filtres OU presets OU rappels]       │
│                                          │
├──────────────────────────────────────────┤
│  3. Aperçu en direct                      │
│     [Tableau comptes trouvés]             │
│                                          │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │  Nom de la séance                    │ │ ← STICKY
│ │  [_________________________________] │ │
│ │  ▸ 8 contacts · 5 avec téléphone     │ │
│ │  [ Lancer la séance → ]              │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Détails UX writing** :

| Avant | Après |
|---|---|
| "Engage la séance avec un objectif" | "Combien de RDV tu vises aujourd'hui ?" |
| "Mode ABM" | "Comptes précis (ABM)" |
| "Filtres de ciblage" | "Qui tu appelles" |
| "Sauvegarder comme preset" | "Garder ce filtre pour plus tard" |
| "Audience prévisualisée" | "Aperçu — 8 contacts trouvés" |
| "Lancer" | "Lancer la séance" |
| "Terminer sans appeler" | "Reporter à plus tard" |

**Le bloc sticky (point 3)** contient : champ nom, compteur de contacts, bouton primaire. Toujours visible au scroll. La classe `calls-name-form--sticky` existe déjà (`AccountSearchView.tsx:274`) — on l'étend.

---

## 5. Mur des réussites (couche locale V1)

### 5.1 Pourquoi une couche locale, pas Arena

**Arena (Phase 5) est planifiée mais non démarrée** (`docs/xos_implementation_plan.md:153` : `Phase 5 — Arena — ⬜`). Les tables Supabase existent (`challenges`, `challenge_results`, `badges` — migration `001_initial_schema.sql`), mais aucun front ni API.

**Décision V1** :
- Combo expose un **mini mur des réussites local** (dans le menu Aide), limité aux réussites **personnelles** de l'utilisateur connecté.
- Le **mur d'équipe** (réussites signées opt-in + défi collectif atteint) est **différé à Arena Phase 5**.2. Cette spec définit juste le **seam** (§5.4) pour ne pas avoir à refaire l'API plus tard.
- **Pas de leaderboard.** Cohérent avec la décision Arena de plan portail : "le classement reste dans Arena" — on ne le duplique pas dans Combo.

### 5.2 Affichage local V1 (dans Combo)

**Accès** : menu Aide → "Mes réussites".

**Contenu** (V1, personnel uniquement) :
- Liste chronologique inversée des badges one-timer débloqués par l'utilisateur
- Compteurs XP par axe (Vitesse / Impact / Régularité) + palier actuel
- Streaks actifs (3 types)
- **Pas** de feed d'équipe — c'est pour Arena V2

**Pourquoi ce n'est pas un mur vide frustrant** : dès la 1ʳᵉ séance, l'utilisateur a au minimum son badge "🐣 Premier pas" + son compteur Vitesse qui démarre. Le mur n'est jamais vide.

### 5.3 Événements alimentant le mur (personnel)

| Événement | Affichage |
|---|---|
| Palier XP atteint | "Tu viens de passer Or vitesse · 75 raccourcis cumulés" |
| Badge one-timer débloqué | "Badge débloqué : 🎯 Trois banderilles" |
| Streak palier | "30 jours d'affilée · Platine régularité" |

**Toutes les réussites sont à la première personne** : "Tu", "ton", pas de nom, pas d'anonymat à gérer (c'est personnel).

### 5.4 Seam vers Arena (pour ne pas refaire)

Les événements publics (réussites signées, défi équipe) passent par `notificationsStore` avec des `kind` extensibles (§3.1). Quand Arena Phase 5.2 démarre, il consomme ces mêmes kinds :

```ts
// Combo émet
notificationsStore.push({ kind: "defi_collectif_atteint", payload: { defiId, total } })

// Arena Phase 5.2 consomme les mêmes kinds depuis le store
// Aucun changement d'API côté Combo
```

**Aucun composant Arena-dédié n'est créé dans Combo V1.** On prépare juste le terrain via les kinds de notifs.

---

## 6. Place du défi collectif (référence Arena, hors scope cette spec)

**Le défi collectif (cumul équipe, leaderboard, badge partagé) relève d'Arena Phase 5 (lots 5.1 moteur / 5.2 UI)** — voir `docs/xos_implementation_plan.md:153-164` et `docs/xos_portal_plan.md:177-183`.

Tables déjà migrées dans `001_initial_schema.sql` : `challenges`, `challenge_results`, `badges`. Aucune API ni front pour l'instant.

**Ce que Combo V1 prépare pour Arena** (sans rien livrer côté défi) :
- Les `kind` de notifs `defi_collectif_atteint` et `relais` sont **réservés** dans §3.1 mais **pas émis** par Combo. Ils seront émis par le moteur Arena quand il existera.
- Le nudge de cadrage pré-séance (§2.1) mentionne le défi collectif comme un encart optionnel — **cet encart est désactivé tant qu'Arena n'existe pas**. La source de données `défi actif` est simplement absente.
- Le badge "🤝 Relais" existe déjà dans la liste one-timer (§1.4) — il sera décerné par Arena, pas par Combo.

**Aucune implémentation de défi collectif dans cette spec.** Spécifier le moteur Arena = chantier séparé, après Copilot (Phase 9, priorité produit supérieure — `xos_implementation_plan.md:380`).

---

## 7. Tests & critères d'acceptation

### 7.1 Tests unitaires (Vitest)

| Fichier à créer | Couvre |
|---|---|
| `comboXp.test.ts` | Calcul XP, paliers, détection diff |
| `comboBadges.test.ts` | Critères one-timer, état persistent |
| `comboStreaks.test.ts` | Calcul jours consécutifs, reset, paliers composites |
| `nudgeLearning.test.ts` | Machine d'état des phases (intensive → régulière → espacée → acceptée) |
| `nudgeRappels.test.ts` | Condition d'apparition (≥ 1 rappel dû) |

### 7.2 Critères d'acceptation

1. ✅ Aucun raccourci n'est comptabilisé deux fois pour la même action dans la même journée.
2. ✅ Un RDV annulé côté SF ne crédite pas l'XP Impact.
3. ✅ Le streak ne casse pas un jour férié (le commercial décide, on respecte).
4. ✅ Un utilisateur ayant désactivé les notifs ne reçoit **aucune** notif, mais conserve ses XP/badges.
5. ✅ Le nudge d'apprentissage s'arrête définitivement après 3 rappels vus (état "acceptée").
6. ✅ Le palier Bronze s'affiche dès le premier raccourci (test possible en local).
7. ✅ La modale de pré-séance a un bloc sticky visible dès le scroll.
8. ✅ Les templates de note apparaissent uniquement si le champ commentaire est vide.
9. ✅ Le mur local "Mes réussites" n'affiche que des réussites personnelles de l'utilisateur connecté (1ʳᵉ personne).
10. ✅ Aucun défi collectif n'est visible dans Combo tant qu'Arena n'existe pas (source absente, pas de fallback).

### 7.3 Métriques de succès (à mesurer 30j post-livraison)

- % d'utilisateurs actifs hebdo utilisant ≥ 5 raccourcis (objectif : +30%)
- % de séances utilisant les templates de note (objectif : > 40%)
- Taux d'adoption du nudge d'apprentissage (passer de souris à clavier) : > 25%
- Pas d'augmentation du taux de désactivation des notifs (sinon = signal que la gamification est trop agressive)
- NPS post-changement : pas de régression

---

## 8. Découpage en lots (orchestration Combo)

| Lot | Contenu | Fichiers principaux | Risque |
|---|---|---|---|
| **G.1** | Modèle XP + paliers + persistance | `comboXp.ts`, `comboXp.test.ts` | Faible |
| **G.2** | Badges one-timer + détection | `comboBadges.ts`, `comboBadges.test.ts` | Faible |
| **G.3** | Streaks (3 types) | `comboStreaks.ts`, `comboStreaks.test.ts` | Faible |
| **G.4** | Nudge d'apprentissage (machine d'état) | `nudgeLearning.ts`, `nudgeLearning.test.ts` | Moyen (UX) |
| **G.5** | Nudges fin de séance | `RecapView.tsx` (modifs), helpers | Faible |
| **G.6** | Modale pré-séance UX writing + sticky | `PreSessionFlow.tsx`, `AccountSearchView.tsx` | Faible |
| **G.7** | Templates de note (chips MEDDIC lite) | `formControls.tsx` (extension) | Moyen |
| **G.8** | Kinds de notifs + intégration | `notifications.ts`, `notificationsStore.ts`, `DesktopToasts.tsx` | Moyen |
| **G.9** | Mur local "Mes réussites" (V1 Combo) | `MyTrophies.tsx`, intégration menu Aide | Faible |

**Dépendances** : G.8 dépend de G.1-G.7 (pour que les notifs aient du contenu à porter). G.9 dépend de G.8.

**Lot critique de référence** : G.4 (nudge d'apprentissage) car c'est la mécanique la plus risquée côté UX. À tester sur 3 utilisateurs pilotes avant généralisation.

**Hors scope de cette orchestration** :
- **Arena Phase 5.1** (moteur challenges : CRUD + cron + snapshots) → chantier `Phase 5 / Lot 5.1`, post-Copilot.
- **Arena Phase 5.2** (UI leaderboard) → chantier `Phase 5 / Lot 5.2`, après 5.1.
- Ces chantiers consommeront les `kind` de notifs `defi_collectif_atteint` et `relais` définis en §3.1, sans modification de Combo.

---

## 9. Hors scope V1 (à noter pour V2+)

- **Arena Phase 5** (moteur + UI challenges, leaderboard, badges collectifs) — chantier dédié après Copilot
- Power Dialer (auto-dial à la fin du log)
- Call tagging libre (tags jsonb)
- Speed-dial / Hot key
- Live dashboard équipe (Supabase Realtime + Wallboard)
- SMS post-appel automatisé (RGPD first)
- Voicemail drop (intégration SIP)
- Call recording + transcription
- Multi-channel WhatsApp / Messenger

---

## 10. Questions ouvertes

1. **Streak week-end** : on respecte ou on suspend le compteur ? (impacte G.3)
2. **Templates MEDDIC lite** : 5 chips max en V1, tu confirmes la liste ?
3. **Streak "intense"** : seuil "X séances à ≥ X appels" — X appels = combien ? 20 ? 30 ?
4. **Nudges rappel du jour** : le cron 9h30 Europe/Paris doit-il être ajouté à cette spec ou relevé dans la spec du système de notifs ?
