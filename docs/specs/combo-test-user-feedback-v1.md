# Combo + Lundi — Retours 1ʳᵉ session test utilisateur (2026-07-17)

**Statut** : draft, à figer avant découpe en lots.
**Origine** : premier test utilisateur enthousiaste de Combo + Lundi (Weekly Perf). Remarques notées par Théo en séance.
**Cible** : `src/apps/calls/` (Combo) + `src/apps/weekly/` (Lundi) + `src/apps/cleaner/` (Labo, point #6).

---

## Synthèse priorités

| # | Retour | App | Effort | Impact | Priorité | Lot |
|---|---|---|---|---|---|---|
| 1 | Sticky section nom à la création de séance | Combo | XS | Fort | **P0** | **F.1** |
| 2 | Prévisualisation live des filtres (sans clic "Actualiser") | Combo | S | Fort | **P0** | **F.2** |
| 3 | Superposition visuel historique d'appels sur RDV du compte | Combo | M | Fort | **P1** | **F.3** |
| 4 | Séance ABM : sélecteur de date | Combo | S | Moyen | **P1** | **F.4** |
| 5 | Contacts non contactés : retrait lent, séance 2 peu claire | Combo | M | Fort | **P0** | **F.5** |
| 6 | Picklist raison de perte Labo (champ libre actuellement) | Labo | S | Moyen | **P2** | **F.6** |
| 7 | Forecast sur le Pace ? | Lundi | XS | Faible | **P3** | **F.7** (skip probable) |
| 8 | Graphique CA Lundi par type produit : montant n'apparaît pas | Lundi | XS | Bloquant | **P0** | **F.8** |

---

## F.1 — Sticky section nom à la création de séance (P0)

### Diagnostic

`AccountSearchView.tsx:274` a déjà la classe `calls-name-form--sticky`. La structure existe, mais elle n'est probablement pas appliquée au bon endroit / pas testée en scroll.

### Travail

- Vérifier que `calls-name-form--sticky` est positionnée correctement dans le flux de `NewSessionView` (parfois c'est `PreSessionFlow` qui héberge les deux modes).
- Test : sur viewport 800px de hauteur, scroller la section filtres — la zone "Nom + Lancer" doit rester visible.
- Si la sticky actuelle est mauvaise, **réutiliser le pattern existant**, ne pas réinventer.

### Critère d'acceptation

- [ ] Sur écran 1280×800, scroller à mi-parcours de la section filtres → le champ nom + bouton "Lancer la séance" restent visibles (sticky).
- [ ] Tab order cohérent : nom → filtres → bouton Lancer (ordre de lecture naturel).

### Fichiers

`src/apps/calls/NewSessionView.tsx`, `src/apps/calls/PreSessionFlow.tsx`, `src/apps/calls/calls.css` (vérif sticky).

---

## F.2 — Prévisualisation live des filtres (P0)

### Diagnostic

`AccountSearchView.tsx:113` : `const data = await fetchAccountsSearch(token, { q, filters })` est déclenché seulement sur action utilisateur (probablement clic bouton ou Enter). L'utilisateur veut la mise à jour **temps réel à chaque modification de filtre**.

### Travail

- Debounce 300ms sur modification filtre (`setFilters`).
- Tant que le compteur précédent est valide, ne **pas** re-fetch si seul l'ordre des filtres change (impact UX : instantanéité perçue).
- Indicateur léger "X comptes trouvés" mis à jour sans flash.
- Si un filtre est modifié < 200ms après le précédent, **annuler le fetch précédent** (AbortController).

### Critère d'acceptation

- [ ] Modifier un filtre (secteur, effectif…) → la liste se met à jour sans clic "Actualiser".
- [ ] Aucune requête réseau excessive (max 1 requête / 300ms par session de modification).
- [ ] Indicateur "X comptes trouvés" cohérent.

### Fichiers

`src/apps/calls/AccountSearchView.tsx`, `src/apps/calls/api.ts` (vérifier signature `fetchAccountsSearch`).

---

## F.3 — Superposition historique d'appels sur RDV compte (P1)

### Diagnostic

Le commercial veut voir, en un coup d'œil, **quels appels ont déjà eu lieu** avec un contact donné quand il s'apprête à appeler ou à fixer un RDV. Aujourd'hui l'historique est sans doute accessible mais **pas visualisé au bon moment**.

### Travail (à confirmer avec Théo en spec détaillée)

- Dans `RunnerView` ou la fiche contact, afficher un **timeline horizontal** des appels passés pour ce contact :
  - Date
  - Résultat (5 valeurs SF)
  - Durée si disponible
  - Indicateur rappel
- Limiter aux N derniers (5-10) pour rester lisible.
- Source de données : déjà présente via `recallQueue` ou endpoint à créer (`GET /api/contacts/:id/calls`).

### Critère d'acceptation

- [ ] Sur la fiche contact d'un contact ayant ≥ 1 appel passé, un mini-timeline affiche les N derniers appels.
- [ ] Aucune dégradation des perfs perçues (chargement < 300ms, ou lazy-load).

### Fichiers

`src/apps/calls/RunnerView.tsx`, possiblement `api/calls.js` (nouvelle action `get_contact_history`).

---

## F.4 — Séance ABM : sélecteur de date (P1)

### Diagnostic

Aujourd'hui, en mode ABM, l'utilisateur ne peut pas planifier une séance ABM pour **une date future** (ex. "appeler ces 20 comptes mercredi prochain"). La séance est implicitement "maintenant".

### Travail

- Ajouter un champ `scheduled_for` (date ISO, nullable) dans la création de séance ABM.
- Si défini, la séance apparaît dans les séances mais **n'est pas démarrée** automatiquement — l'utilisateur la lance à la date choisie.
- Affichage : vue séances avec un onglet "Planifiées" en plus de "Actives" / "Terminées".

### Critère d'acceptation

- [ ] Possibilité de créer une séance ABM avec date future.
- [ ] Cette séance est listée dans un état "planifiée" visible dans la liste.
- [ ] Aucune séance planifiée ne se lance automatiquement à sa date.

### Fichiers

`src/apps/calls/AccountSearchView.tsx`, `api/calls.js` (nouvelle colonne `scheduled_for`), migration Supabase si nécessaire.

---

## F.5 — Contacts non contactés : retrait lent + séance 2 confuse (P0)

### Diagnostic (à confirmer en implémentation)

**Bug de performance** (confirmé code en main, ligne `CallManagerApp.tsx:1149-1172`) :
- `handleRemoveContacts` fait bien les removes en `Promise.allSettled` (parallèle ✓)
- Mais **refetch TOUTE la séance** après chaque batch via `fetchSession(token, activeSession.id)` — réseau + render complet à chaque remove.

**Confusion UX** (à investiguer utilisateur) :
- Le bouton "Créer une séance de relance" existe (`createFollowUpSession` dans `CallManagerApp.tsx:1270`) mais son déclenchement et son label sont probablement peu visibles.
- Le flow actuel : "Retirer les contacts" → "Créer séance 2". L'utilisateur ne comprend pas que les deux sont liés.

### Travail

**Côté perfs** :
- Mettre à jour le state local `setContacts(prev => prev.filter(...))` sans refetch.
- Garder un seul refetch en fin d'opération pour la sync (et seulement si nécessaire).
- Si l'utilisateur retire 5 contacts d'affilée, ne faire qu'1 refetch final (debounce 500ms).

**Côté UX** :
- Renommer / repositionner le bouton "Créer une séance de relance" pour qu'il soit **proche** de la liste des non-contactés.
- Pré-remplir le nom de la séance 2 avec une suggestion lisible (ex. `Lyon — Relance {date_lendemain}`).
- Permettre de **sélectionner la date** de la séance 2 (lien avec F.4 : mutualiser le DatePicker).

### Critère d'acceptation

- [ ] Retirer 5 contacts d'affilée = 1 seul refetch au lieu de 5.
- [ ] Temps perçu de l'opération "retirer" < 200ms (au lieu de > 1s actuel).
- [ ] Le bouton "Créer séance 2" est visuellement adjacent à la liste des non-contactés.
- [ ] Le nom de séance 2 est pré-rempli avec une suggestion claire.
- [ ] Date de séance 2 sélectionnable.

### Fichiers

`src/apps/calls/CallManagerApp.tsx`, `src/apps/calls/RunnerView.tsx`, `src/apps/calls/RecapView.tsx`.

---

## F.6 — Picklist raison de perte Labo (P2)

### Diagnostic

Le Labo (`src/apps/cleaner/`) accepte actuellement une raison de perte en **champ libre**. Manque de qualité de données + reporting impossible par motif.

### Travail

- Définir une liste fermée de raisons (à figer avec Théo, suggestion : "Prix · Timing · Concurrence · Pas de budget · Mauvais fit · Autre (préciser)").
- Si "Autre" → champ texte libre conservé, sinon valeur figée.
- Côté Salesforce, ajouter un picklist sur Opportunity (probable champ custom `Raison_perte__c` à confirmer).
- Migration côté front pour aligner.

### Critère d'acceptation

- [ ] Liste de raisons fermée présentée à l'utilisateur.
- [ ] Le motif est envoyé à Salesforce dans le champ custom prévu.
- [ ] Reporting possible par motif côté Labo.

### Fichiers

`src/apps/cleaner/`, `api/_crm/mapping.js`, migration Salesforce à appliquer par admin.

---

## F.7 — Forecast sur le Pace ? (P3 — probablement skip)

### Diagnostic

Le test utilisateur a demandé si le forecast ne devrait pas être ajouté au graphique **Pace**.

### Décision

**Ne pas faire.** Le forecast est déjà sur la 1ʳᵉ section KPI (forecast + réalisé), le Pace est un graphe de tendance temporelle. Ajouter le forecast dedans crée un overlap visuel et de la confusion sémantique (Pace = vitesse, Forecast = projection).

### Critère d'acceptation

- [ ] Décision archivée dans la spec pour traçabilité.
- [ ] Aucun code touché.

### Fichiers

Aucun.

---

## F.8 — Graphique CA Lundi par type produit : montant absent (P0)

### Diagnostic (hypothèse principale)

`src/apps/weekly/WeeklyApp.tsx:721-736` — composant `Breakdown({ wonByType, wonAmount })` :

```tsx
<span className={`weekly-breakdown-${type}`} style={{ width: wonAmount ? `${value / wonAmount * 100}%` : "0%" }} />
```

Classes CSS existantes (`weekly.css:991-993`) : `catalogue`, `sur_mesure`, `conseil`. ✓

**Causes probables du bug "montant n'apparaît pas"** :

1. **`value === 0`** → barre 0% = invisible. Norm.
2. **`wonAmount === 0`** → toutes les barres à 0% (pas de CA signé cette semaine). Mais dans ce cas, le composant n'est probablement pas rendu (à vérifier le parent).
3. **Incohérence de données** : `wonByType.sur_mesure + .catalogue + .conseil !== wonAmount` → si la somme est < wonAmount, certaines barres font 0% même avec valeur non-nulle (à cause d'arrondi ou d'un 4ᵉ type non mappé). À vérifier en runtime.
4. **Bug de classe** : si la classe CSS ne match pas la clé (ex. underscore vs tiret), la barre n'a pas de `background`. **Vérifié : classes CSS utilisent `sur_mesure` (underscore) qui matche la clé.** Probablement pas ça.
5. **Tooltip masqué** : `won_by_type` arrive peut-être avec des nombres > 0 mais le tooltip légende ligne 732 affiche correctement le montant (`money.format(wonByType[type])`). Si le tooltip marche mais pas la barre, c'est #1 ou #3.

### Travail

1. Ajouter un test unitaire sur `Breakdown` avec un dataset où `wonByType` est non-nul mais `wonAmount === 0` (edge case).
2. Vérifier en runtime via console navigateur sur la page Lundi avec un user DG.
3. Si l'incohérence de données est confirmée, ajouter une vérification : `const totalByType = sum(Object.values(wonByType))` ; si `totalByType < wonAmount`, logger un warning + afficher une barre "Autres" pour la différence.
4. Si le tooltip légende s'affiche mais pas la barre, c'est un bug CSS (vérifier `display`, `height`, `min-height` sur `.weekly-breakdown > span`).

### Critère d'acceptation

- [ ] Pour un user DG ayant du CA signé cette semaine, le composant `Breakdown` affiche les 3 barres (Catalogue, Sur-mesure, Conseil) avec leur % respectif.
- [ ] La somme des % est cohérente à ±1% près avec `wonAmount`.
- [ ] Si wonAmount === 0, le composant n'est pas rendu (pas de barre vide).

### Fichiers

`src/apps/weekly/WeeklyApp.tsx` (l. 721-736), `src/apps/weekly/WeeklyApp.test.tsx` (ajouter cas de test), `src/apps/weekly/weekly.css` (audit).

---

## Découpage final pour Foederati

| Lot Foederati | Tâches | Risque | task_class |
|---|---|---|---|
| **F.1** | Sticky nom séance | Faible | bugfix |
| **F.2** | Preview live filtres | Moyen | feature |
| **F.5** | Remove optimisé + UX séance 2 | Moyen | feature |
| **F.8** | Bug Breakdown Lundi | Faible | bugfix |

**F.3, F.4, F.6, F.7** restent en attente de précisions utilisateur ou sont trop petits / flous pour dispatcher en parallèle (F.3 et F.6 demandent des choix UX/business à Théo d'abord ; F.4 et F.7 sont P1/P2-P3).

## Questions ouvertes

1. **F.3** : N derniers appels à afficher ? 5 ou 10 ? Source de données = endpoint existant ou nouveau ?
2. **F.4** : Les séances planifiées sont-elles visibles par toute l'équipe (partage) ou strictement perso ?
3. **F.6** : Liste exacte des raisons de perte à figer ? Validation manager OK avant dev ?
4. **F.8** : Confirmer que c'est bien le composant `Breakdown` (l. 721) qui est visé, ou un autre (ex. graphique `BarChart` dans MetricTable). Screenshot serait idéal pour trancher.
