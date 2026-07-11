# Contrat Weekly Perf — Cockpit hebdomadaire

**Statut** : prêt pour implémentation (2026-07-11). S'appuie sur l'audit `docs/audits/lot-3.0-metriques-activite.md`.  
**Lots** : 3.1 (`api/perf` ou action consolidée) → 3.2 (`src/apps/weekly/`).

---

## 1. Intention produit

Weekly Perf est le **cockpit manager** du rythme commercial : voir en un coup d'œil qui pousse (Pulse), ce qui entre / sort du pipeline (Généré vs Gagné), et si le pipeline avance (Effort).

Ce n'est **pas** un outil de saisie (Call Manager) ni un challenge (Arena) : lecture seule, agrégats Salesforce, cache 15 min.

---

## 2. Décisions actées (validation 2026-07-11)

| Sujet | Décision |
|---|---|
| Rôles managers | Jérôme Bosio, Paul Rathouin → `manager` |
| Admin | Théo Savoy → `admin` |
| Commerciaux dans le classement | Tous les `profiles` avec activité SF sur la fenêtre **sauf exclusion settings** ; défaut = inclure les commerciaux même à conversion 0 (ex. Yanis) |
| Managers dans le classement « équipe » | **Inclus** dans Pulse (leurs RDV comptent) mais **badge rôle** ; filtre UI « Commerciaux seulement » **ON par défaut** (exclut manager + admin du classement Pulse/Pipeline) |
| Taux d'effort | Afficher **nombre de progressions** en primaire + **taux %** en secondaire (lisible malgré % bas) |
| Étape propositions | `Proposition envoyée` (OpportunityHistory.StageName) |
| Stages perdus fantômes | Ignorer `Perdu` ; n'utiliser que `Fermée / Perdue` / `Fermée / Gagnée` via `IsWon` / `IsClosed` |
| Fenêtre | 8 semaines glissantes, semaine ISO (lundi–dimanche), timezone Europe/Paris |

Clarification « point 1 » de l'audit : la question « Jérôme / Yanis ? » portait sur **l'inclusion dans les comparaisons**.  
- **Jérôme** = manager → visible en vue équipe si on désactive « Commerciaux seulement », pas dans le classement commercial par défaut.  
- **Yanis** = commercial → **toujours inclus** ; une perf basse est un signal, pas un bug de filtre.

---

## 3. Définitions métriques (figées)

### 3.1 Pulse — activité hebdomadaire

Par **owner Salesforce** × **semaine** :

| Composante | Source | Filtre | Clé owner |
|---|---|---|---|
| **calls** | `Task` | `TaskSubtype = 'Call'` AND `ActivityDate` ∈ semaine | `OwnerId` |
| **meetings** | `Event` | `ActivityDate` ∈ semaine (tous ; `Type` est null en org) | `OwnerId` |
| **proposals** | `OpportunityHistory` | `StageName = 'Proposition envoyée'` AND `CreatedDate` ∈ semaine | `CreatedById` |

**Exclus du Pulse** : emails (`TaskSubtype = 'Email'`), sync Outlook.

**Date de référence Events/Tasks** : `ActivityDate` (pas `CreatedDate`) — l'org crée souvent des events rétroactifs.

### 3.2 Pipeline Généré vs Gagné

| Composante | Source | Filtre |
|---|---|---|
| **generated_count / generated_amount** | `Opportunity` | `CreatedDate` ∈ semaine — count + sum(`Amount`) |
| **won_count / won_amount** | `Opportunity` | `IsWon = true` AND `CloseDate` ∈ semaine |
| **closing_rate_count** | Calculé | `won_count / generated_count` (null si généré = 0) |
| **closing_rate_amount** | Calculé | idem sur montants |

Le taux n'est **pas** une conversion same-week : une opp gagnée en S peut avoir été créée en S−n.

### 3.3 Effort — progressions de pipeline

**Primaire UI** : `progressions` = nombre d'opps ayant **avancé d'étape** (SortOrder croissant) dans la semaine, via `OpportunityHistory`.

**Secondaire** : `effort_rate = progressions / open_opps_at_start`  
où `open_opps_at_start` = opps `IsClosed = false` AND `StageName != 'Suspect enlisé'` au lundi 00:00 Europe/Paris (approximation acceptable v1 : snapshot « maintenant » hors fermées / enlisé si historique début de semaine trop cher — **préférer** requête History + dénominateur courant documenté en limitation v1).

Post-traitement JS : pour chaque opp, ordonner l'historique ; compter un passage SortOrder↑ comme 1 progression (max 1 par opp par semaine en v1 pour éviter le bruit).

---

## 4. Contrat API

### Endpoint

Préférer **ne pas** créer un 13ᵉ fichier Hobby : soit `GET /api/perf`, soit après consolidation calls → slot libre (voir `docs/ops/vercel-functions.md`).

```
GET /api/perf?weeks=8
Authorization: Bearer <supabase jwt>
Cache-Control: public, s-maxage=900, stale-while-revalidate=60
```

### Authz

| Rôle | Réponse |
|---|---|
| `commercial` | Uniquement **sa** série (`sf_user_id` / email mappé) ; pas de liste équipe |
| `manager` / `admin` | Toutes les séries + meta owners |

Sans `sf_user_id` : 200 avec séries vides + `warning: "sf_user_unmapped"`.

### Réponse 200

```jsonc
{
  "weeks": 8,
  "timezone": "Europe/Paris",
  "range": { "from": "2026-05-18", "to": "2026-07-12" }, // lundis ISO inclus
  "view": "team" | "self",
  "owners": [
    {
      "sf_user_id": "005…",
      "name": "Christophe Hirtz",
      "email": "…@xos-learning.fr", // si mappé profiles
      "role": "commercial" | "manager" | "admin" | null
    }
  ],
  "pulse": [
    { "sf_user_id": "005…", "week": "2026-W28", "week_start": "2026-07-06", "calls": 2, "meetings": 5, "proposals": 1 }
  ],
  "pipeline": [
    {
      "sf_user_id": "005…",
      "week": "2026-W28",
      "week_start": "2026-07-06",
      "generated_count": 3,
      "generated_amount": 42000,
      "won_count": 1,
      "won_amount": 15000,
      "closing_rate_count": 0.33,
      "closing_rate_amount": 0.36
    }
  ],
  "effort": [
    {
      "sf_user_id": "005…",
      "week": "2026-W28",
      "week_start": "2026-07-06",
      "progressions": 2,
      "open_opps_at_start": 47,
      "effort_rate": 0.043
    }
  ]
}
```

### Erreurs

| Status | Code | Quand |
|---|---|---|
| 401 | `unauthorized` | JWT manquant / invalide |
| 400 | `invalid_weeks` | `weeks` hors 1–16 |
| 502 | `sf_*` | Auth / query Salesforce |

### Mapping CRM

Ajouter dans `api/_crm/mapping.js` (pas en dur dans perf) :

- stages : `proposalSent: "Proposition envoyée"`, `stalledSuspect: "Suspect enlisé"`
- opportunity fields déjà présents ; task subtype Call déjà dans mapping Call Manager

---

## 5. Plan de design UI (lot 3.2)

### Principes (charte X OS)

- Même shell que Call Manager : `.calls-app`-like → `.weekly-app` (tokens `--xos-*`, glass cards, Brockmann)
- **Une composition par viewport** : pas un dashboard dense de 12 widgets
- Desktop-first ; mobile = stack vertical lisible

### Structure des écrans

```
Weekly Perf
├── Header : tag « Performance » + titre + sélecteur période (8 / 4 semaines)
├── Toggle vue (manager+) : [ Moi | Équipe ]   — commercial : Moi only
├── Filtre (vue Équipe) : ☑ Commerciaux seulement (défaut)
│
├── Section 1 — Pulse (job : « qui a bougé cette semaine ? »)
│     Cards par personne (ou une card « moi ») : appels · RDV · propositions
│     Sparkline 8 semaines sous chaque métrique (léger)
│
├── Section 2 — Pipeline (job : « ce qui entre vs ce qui se gagne »)
│     Graphique barres groupées Généré € vs Gagné € (Recharts)
│     Sous-texte : taux closing nb / € pour la semaine sélectionnée
│
└── Section 3 — Effort (job : « le pipeline avance-t-il ? »)
      Nombre de progressions (gros chiffre) + taux % muted
      Liste courte des semaines à 0 progression (état normal, pas alerte rouge)
```

### Hiérarchie visuelle

1. **Semaine courante** mise en avant (card accent)
2. Historique 8 semaines en densités plus faibles
3. Pas de stats strips hors métriques définies ; pas de cards décoratives

### États

| État | UI |
|---|---|
| Loading | Skeleton cards (pas de spinner plein écran) |
| Vide (aucune activité) | Empty state calme + lien Call Manager |
| `sf_user_unmapped` | Bandeau : « Compte Salesforce non lié — Hub / login SF » |
| Erreur API | GlassCard erreur + Réessayer |
| Manager sans filtre | Badge « Manager » sur les lignes Jérôme / Paul |

### Motion (2–3 intentions)

1. Entrée staggered des cards Pulse
2. Transition douce Moi ↔ Équipe
3. Highlight semaine au survol du graphique

### Hors scope v1

- Drill-down opp par opp
- Export Excel
- Objectifs / quotas chiffrés (Arena)
- Comparaison YoY (Business Review)

---

## 6. Fichiers cibles

| Lot | Fichiers |
|---|---|
| 3.1 | `api/perf.js` **ou** action sur router consolidé ; `api/_crm/mapping.js` (stages) ; tests `api/perf.test.js` ; check script optionnel |
| 3.2 | `src/apps/weekly/*` ; entrée `registry.ts` ; dépendance `recharts` ; CSS tokens |

Registry : visible tous rôles ; la vue équipe est gardée dans l'UI selon `profiles.role`.

---

## 7. Critères d'acceptation

1. Commercial ne voit que sa série ; manager/admin voient l'équipe.
2. Filtre « Commerciaux seulement » exclut Jérôme & Paul du classement par défaut.
3. Pulse : appels = TaskSubtype Call ; pas d'emails.
4. Pipeline : chiffres d'une semaine pilote recoupés à ±5 % vs SOQL manuel (gate QC).
5. Effort : progressions ≥ 0 ; semaines à 0 sans erreur UI.
6. Cache `s-maxage=900`.
7. QA visuelle charte X OS (glass, typo, pas de palette hors tokens).
8. Aucune nouvelle fonction Vercel si le plafond n'a pas été libéré (sinon consolidation B d'abord).

---

## 8. Dépendances & ordre

```
Consolidation Vercel B (calls-list + presets → calls, −auth-test)
    → 3.1 api/perf
    → 3.2 UI weekly
```

Bootstrap rôles (`access.js` + migration 008) utile pour le filtre manager mais **pas bloquant** pour 3.1 si le mapping owner se fait via SF User ; le filtre « Commerciaux seulement » utilise `profiles.role` quand l'email est mappé.

---

## 9. Extension v2 — le rituel équipe *(2026-07-11, remplace le Google Sheet de suivi hebdo/trimestre)*

Weekly Perf doit permettre de **retrouver toutes les infos du tableur de suivi actuel** (métrique × semaines par commercial, photo du 2026-07-11), présentées UX-friendly. Lot dédié **3.3** (API + UI), après le socle 3.2.

### 9.1 Mapping tableur → données

| Ligne du tableur | Source | Statut |
|---|---|---|
| Nombre de RDV effectués | `pulse.meetings` (Events, `ActivityDate`) | ✅ déjà en 3.1 |
| Nombre d'opportunités détectées | `pipeline.generated_count` (Opportunity `CreatedDate`) | ✅ déjà en 3.1 |
| Montant HT signé sur la semaine | `pipeline.won_amount` (`IsWon`, `CloseDate` ∈ semaine) | ✅ déjà en 3.1 |
| Montant sur-mesure / catalogue / conseil / ventes exceptionnelles | breakdown du signé par `Type_de_vente__c` (picklist vérifiée 2026-07-11 : Catalogue, Sur-mesure, Conseil, LMS, XOS+). **Défaut proposé** : « ventes exceptionnelles » = LMS + XOS+ regroupés (véto Théo possible) | 🆕 3.3 |
| Dont ventes ARR | **acté 2026-07-11** : `Type_de_vente__c = 'Catalogue'` AND `Type_de_commission__c ∈ {'Abonnement 2 ans','Abonnement 3 ans','Abonnement 4 ans','Abonnement 5 ans'}` (picklist vérifiée ; « Abonnement 1 an » exclu) | 🆕 3.3 |
| Forecast sur le trimestre | **acté 2026-07-11** : signé du **trimestre fiscal en cours** (FY juillet–juin) + Σ(`Amount` × `Probability`/100) des opps **ouvertes** avec `CloseDate` ∈ trimestre fiscal courant | 🆕 3.3 |
| Montant de pipe sur-mesure | opps ouvertes `Type_de_vente__c = Sur-mesure`, somme `Amount` (règle V6 : `CloseDate ∈ [aujourd'hui, +180 j]`) | 🆕 3.3 |
| Target | **acté 2026-07-11** : **Supabase `settings`** (clé `weekly_targets`, map `sf_user_id → { "FY26-Q1": montant }`), **éditable Hub** (manager+admin, CRUD settings existant) ; valeurs **mock** au départ | 🆕 3.3 |
| Total / Moyenne | calculés côté client sur la fenêtre affichée | 🆕 3.3 (UI) |

**Année fiscale XOS : juillet → juin** (acté 2026-07-11) — Q1 = juil–sept, Q2 = oct–déc, Q3 = janv–mars, Q4 = avr–juin. Vaut aussi pour Business Review.

### 9.2 API (extension `api/perf`)

- `GET /api/perf?weeks=N` enrichi : `pipeline[].won_by_type` (map type → montant), `won_arr_amount` (une fois le champ acté), + resource trimestre : `quarter: { signed_to_date, forecast, custom_pipe, target }` par owner. Même cache, même authz.
- Aucun nom de champ/valeur picklist en dur : tout passe par `api/_crm/mapping.js`.

### 9.3 UI (principes)

- **Vue Équipe = le rituel du lundi** : une card par commercial — RDV & opps détectées de la semaine (vs moyenne 8 s), CA signé de la semaine avec mini-breakdown par type (barres empilées), **jauge trimestre** réalisé cumulé vs forecast vs target.
- **Toggle « Tableau »** : grille métrique × semaines fidèle au tableur (totaux + moyennes calculés, zéro `#DIV/0!`), pour une transition douce depuis Sheets.
- Les métriques spec v1 (propositions, effort) restent, visuellement secondaires par rapport aux métriques du rituel.

### 9.4 Questions ouvertes — ✅ résolues 2026-07-11 (réponses Théo intégrées au § 9.1)

Seul reste ouvert (non bloquant, défaut posé) : « ventes exceptionnelles » = LMS + XOS+ regroupés — véto possible.
