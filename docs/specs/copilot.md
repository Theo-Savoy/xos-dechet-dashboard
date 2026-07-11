# Contrat Copilot — Pilotage du pipeline & assistant d'action

> Contrat v1 rédigé le 2026-07-11 (périmètre validé par Théo le jour même). **Les seuils et la liste des champs critiques sont des défauts proposés, à caler par l'audit 9.0 puis validation Théo avant l'UI** — invariant du plan : audit avant tout dashboard.

## 1. Intention produit

Le cockpit **prescriptif** du commercial. Weekly Perf regarde en arrière (ce qui s'est passé), Call Manager exécute (les appels du jour) ; Copilot répond à la question quotidienne : **« sur quoi je dois agir maintenant ? »**.

Quatre volets :
1. **Pipeline de travail** — mes opportunités ouvertes, triées par urgence.
2. **Alertes & prochaines actions** — détection de risques + action en 1 clic.
3. **Stratégies de prospection** — suggestions de ciblage concrètes (presets Call Manager).
4. **Adoption & qualité CRM** — le CRM est-il bien utilisé ? (volumes d'activité loggée, créations, complétude des champs critiques).

**Ce que Copilot n'est pas** : pas de LLM dans le repo (décision d'architecture actée — le volet conversationnel est Hermes, Phase 7, qui pourra consommer ces mêmes endpoints) ; pas de nouveau chemin d'écriture Salesforce (les actions 1-clic délèguent aux endpoints existants) ; pas un deuxième Weekly Perf (les métriques d'activité réutilisent les définitions actées de `docs/specs/weekly-perf.md`).

## 2. Périmètre fonctionnel

### 2.1 Pipeline de travail
- Liste des opps **ouvertes** dont l'utilisateur est Owner, triée par urgence : CloseDate dépassée, puis CloseDate ≤ `closing_window_days` (défaut 30 j), puis le reste (tri secondaire : montant décroissant).
- Bandeau « À clôturer sous 30 jours » en tête (compte + montant total).
- CloseDate dépassée = signal d'hygiène → lien « traiter dans le Cleaner » (`?open=cleaner`, pré-filtre si supporté).
- Manager/admin : sélecteur de commercial (même modèle d'authz que `api/perf`).

### 2.2 Alertes & prochaines actions (le cœur)

Moteur de **règles déterministes** calculées depuis Tasks, Events, `OpportunityHistory` et les champs d'opp. Chaque alerte = `{rule_id, sévérité, référence (opp/contact/compte), explication courte, action suggérée}`.

| `rule_id` | Condition (opp ouverte sauf mention) | Seuil défaut *(à caler 9.0)* | Action 1-clic suggérée |
|---|---|---|---|
| `opp_dormante` | aucune Task/Event lié depuis N jours | `dormant_days` = 21 | Task de relance (`OwnerId` = commercial) |
| `opp_bloquee` | aucune progression d'étape depuis N semaines (logique `OpportunityHistory` de 3.1) | `stuck_weeks` = 6 | revue de l'opp : planifier Task ou Event |
| `proposition_sans_suite` | entrée en étape « Proposition envoyée » il y a > N jours, sans activité postérieure ni Task ouverte | `proposal_followup_days` = 10 | Task de relance à J+0 |
| `rdv_sans_next_step` | Event passé sans Task ouverte ni Event futur sur l'opp/le contact | fenêtre = 3 j après l'Event | créer la Task de suivi ou le prochain RDV |
| `close_date_depassee` | CloseDate < aujourd'hui | — | mettre à jour dans SF / pont Cleaner |
| `montant_manquant` | Amount vide ou 0 | — | compléter la fiche (deep link SF) |
| `champs_critiques_manquants` | champs critiques vides (voir § 5) sur opp/contact/compte dont l'utilisateur est Owner | — | compléter la fiche (deep link SF / Launcher) |

**Actions 1-clic** : réutilisent les chemins d'écriture existants — logging Call Manager (`log_call`, follow-up, `log_event`), Launcher `/log`, ouverture d'une séance Call Manager pré-ciblée. Attribution niveau 1 garantie (`OwnerId` = commercial connecté) ; niveau 2 si son refresh token SF est lié (8.1b). Copilot lui-même n'écrit **jamais** dans SF.

### 2.3 Stratégies de prospection
- Analyse du portefeuille : segments (secteur × effectif) à meilleur taux de gain, comptes à opp perdue ré-attaquables, contacts jamais appelés dans les segments porteurs.
- Chaque suggestion = un **preset de séance Call Manager pré-rempli** (payload de filtres v2 existant) : « 20 contacts secteur X jamais appelés » → bouton « Lancer la séance ». On capitalise sur le moteur de ciblage v2, rien de nouveau côté écriture.

### 2.4 Adoption & qualité CRM *(ajout validé 2026-07-11)*
Répond à : **le CRM est-il bien utilisé ?**
- **Volumes d'usage par commercial**, fenêtre glissante (semaine courante + `adoption_window_weeks` = 4 semaines) : appels loggés (Tasks type appel — **définition Weekly Perf**), RDV (Events), **contacts créés**, **comptes créés**. Comparaison : sa propre période précédente + médiane équipe.
- **Complétude des champs critiques** : % de remplissage par objet, sur les enregistrements dont le commercial est Owner (opps ouvertes, contacts, comptes actifs). Liste des champs dans le **mapping CRM** (§ 5), jamais en dur.
- **Vues** : « Moi » (tous) / « Équipe » (manager+admin) — même modèle que Weekly Perf. La vue équipe donne un mini-score d'adoption par commercial (volumes + complétude), sans classement public (la gamification, c'est Arena — ces indicateurs alimenteront ses challenges, lot 5.1).
- ⚠️ **Attribution des créations à trancher à l'audit 9.0** : `CreatedById` = utilisateur d'intégration sur les chemins X OS (avant liaison OAuth 8.1b) → probablement compter par `OwnerId`, à vérifier sur les données réelles.

## 3. Contrat API (draft — figé au lot 9.1 après l'audit)

**Endpoint** : `GET /api/copilot?resource=…` — routeur unique (pattern `api/calls.js`), helpers dans `api/_copilot/` (non exposés). 8ᵉ fonction Vercel (plafond Hobby 12).

| Resource | Rôle | Params |
|---|---|---|
| `pipeline` | opps ouvertes triées par urgence + bandeau closing | `user` (manager/admin) |
| `alerts` | alertes par règle, triées par sévérité | `user`, `rules` (filtre optionnel) |
| `adoption` | volumes d'usage + complétude champs critiques | `view=me\|team`, `weeks` |
| `strategies` | suggestions {label, explication, preset_payload} | — |

- **Authz** : JWT Supabase requis (`api/_auth.js`) ; `view=team` et `user=` réservés manager+admin (modèle `api/perf`).
- **Cache** : `s-maxage=900` (aligné analytics). Pas d'écriture → pas d'invalidation à gérer.
- **Erreurs** : 401 sans JWT, 403 vue équipe pour un commercial, 502 SF injoignable — pattern des endpoints existants.

## 4. Découpage en lots

Voir `docs/xos_implementation_plan.md` Phase 9 : **9.0 audit SOQL** (volumétrie, calibrage seuils, attribution créations, taux de remplissage actuels — validation Théo, bloque la suite) → **9.1 `api/copilot.js`** → **9.2 UI `src/apps/copilot/`**.

## 5. Config & mapping (rien en dur)

- **Seuils** → table `settings` (Supabase), éditables dans le Hub (manager+admin) : `copilot.dormant_days`, `copilot.stuck_weeks`, `copilot.proposal_followup_days`, `copilot.closing_window_days`, `copilot.adoption_window_weeks`. Défauts en code, valeurs `settings` prioritaires.
- **Champs critiques** → `api/_crm/mapping.js`, nouvelle clé `critical_fields` par objet (les *valeurs* XOS sont de la config mission ; le *format* est du socle). Candidats à valider en 9.0 : Opportunity — Amount, CloseDate, étape cohérente ; Contact — téléphone, fonction/niveau de décision ; Account — secteur, effectif.
- **Étape « Proposition envoyée »**, types de Task appel, etc. : déjà dans le mapping (Weekly Perf / Call Manager) — réutiliser, ne pas dupliquer.
- Un « moteur de recommandations à règles » configurable est un actif du **socle générique** (cf. § Trajectoire produit du plan) : les règles sont agnostiques, les valeurs sont XOS.

## 6. UI (`src/apps/copilot/` — lot 9.2)

- Fenêtre X OS (registre dock, `id: "copilot"`), charte glassmorphism, rôles : tous (vue équipe gated).
- **Structure** : colonne gauche = pipeline trié (cards opp compactes : nom, montant, étape, CloseDate avec code couleur) ; zone principale = file d'alertes groupées par règle, chaque carte porte son bouton d'action 1-clic ; onglet ou panneau « Adoption » (tuiles volumes + jauges de complétude, vues Moi/Équipe) ; panneau « Prospection » (suggestions → bouton « Lancer la séance »).
- **États** : loading squelette, vide (« rien à signaler 🎉 »), erreur SF gracieuse.
- Détail du plan de design à poser au lot 9.2 (comme `weekly-perf.md` § 5), après l'audit.

## 7. Critères d'acceptation

1. Chaque règle du § 2.2 couverte par un test API sur données de test (opp dormante fabriquée → alerte émise ; seuil modifié dans `settings` → comportement change sans redéploiement).
2. Volumes d'adoption cohérents avec `api/perf` sur la même fenêtre (mêmes définitions → mêmes chiffres).
3. Action 1-clic de bout en bout : alerte → Task créée dans SF avec `OwnerId` = le commercial connecté + entrée `action_journal`.
4. Suggestion de prospection → séance Call Manager ouverte avec les bons filtres pré-remplis.
5. Un commercial ne voit ni la vue équipe ni les données d'un collègue (403).
6. `npx tsc --noEmit`, `eslint`, build OK ; non-régression Cleaner (gate QC standard).

## 8. Questions ouvertes pour l'audit 9.0

- Distributions réelles → seuils par défaut (dormance, blocage, relance) qui déclenchent un volume d'alertes utile (ni 0 ni 200).
- Attribution des créations contact/compte (`CreatedById` intégration vs `OwnerId`) sur les données réelles.
- Liste définitive des champs critiques + taux de remplissage actuels (point de départ des jauges).
- La détection « RDV sans next step » est-elle fiable avec la discipline de saisie réelle des Events ?
- Volumétrie SOQL : coût des requêtes alertes (Tasks/Events par opp) — bornage et pagination comme les vagues de stabilisation Call Manager.
