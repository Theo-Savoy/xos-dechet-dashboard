# Contrat Business Review — Cockpit macro & partage d'analyses

> Contrat v1 rédigé le 2026-07-11. **Décisions actées le même jour** : (a) **deux apps** — Weekly Perf reste le rituel micro hebdo, Business Review porte le macro (pas de all-in-one à onglets) ; (b) **partage d'analyses** manager/admin → commercial inclus au périmètre. Les définitions et seuils passent par l'audit 6.0 + validation Théo avant l'UI (invariant du plan).

## 1. Intention produit

Le cockpit **macro** du pilotage : sessions d'analyse manager/direction sur période longue, là où Weekly Perf répond au rituel hebdo. Portage X OS du **dashboard V6** construit côté Hermes (référence : `/Users/theosavoy/xos-dashboard`, skill `xos-salesforce-reporting` — spec V6 validée le 2026-06-25), en remplaçant le pipeline Python/cron par l'API Vercel cachée.

**Ce que Business Review n'est pas** : pas un outil de saisie ; pas un deuxième Weekly Perf (les définitions d'activité restent celles de `docs/specs/weekly-perf.md`) ; pas de LLM.

## 2. Périmètre fonctionnel

### 2.1 Sélecteur de période & comparaisons
- **Granularité** : Année / Trimestre / Mois / Semaine (l'annuel est obligatoire).
- **Navigation historique** : toute période sélectionnable (FY, trimestre, mois, semaine ISO) ; défaut en vue semaine = **dernière semaine complète** (jamais la semaine en cours).
- **Comparaison automatique** : même période **N-1** (primaire) et **N-2** (secondaire, si les données SF couvrent la profondeur — à vérifier en 6.0). Toujours same-period-last-year, jamais une baseline fixe.
- **Tous les KPIs suivent la période sélectionnée** (aucune tuile figée sur le FY).

### 2.2 Contenu (hérité du V6, re-scopé X OS)
- **Filtre commercial** : Global / par commercial — liste pilotée par `profiles` + `sf_user_map`, **jamais de prénoms en dur**.
- **KPIs adaptatifs** : CA signé, pipeline généré, taux de closing (nb et €), activité (appels/RDV — définitions Weekly Perf).
- **Répartition du CA par type de vente** (`Type_de_vente__c` via le mapping CRM) : donut avec nb, % **et montants**.
- **Funnel SDR** (`Resultat_call__c`) : entonnoir décroché → argumenté → RDV planifié.
- **Opportunités à l'attention** : opps sans action (score de pertinence = ancienneté × montant × probabilité, top 15 + modale « Voir tout »), opps clés / chaudes (top 10 + modale).
- **Vues par rôle** (V6 « dashboard-management-principles ») : lecture macro → pilotage → décision ; le détail par personne reste filtrable, pas de classement public (Arena).

### 2.3 Partage d'analyses *(nouveau — acté 2026-07-11)*
Un manager/admin peut **partager une analyse avec un commercial** :
- Une **analyse partagée** = la **configuration de vue** (granularité, période, filtre commercial, sections visibles) + une **note du manager** (contexte, consigne). V1 : les données sont **recalculées à l'ouverture** (pas de snapshot figé — rien des données SF n'est copié en Postgres ; l'option snapshot jsonb est notée pour plus tard si le besoin « photo au moment T » se confirme).
- **Destinataire** : un profil (ou « toute l'équipe »). Le commercial voit l'analyse **telle que configurée par le manager** — le partage explicite vaut autorisation de lecture sur ce périmètre précis (c'est le manager qui décide d'exposer une vue équipe ou re-scopée sur le destinataire).
- **Accès** : l'app est visible de tous les rôles ; un commercial n'a **que** l'onglet « Partagées avec moi » (pas d'explorateur macro libre). Manager/admin ont tout + bouton « Partager cette analyse » sur la vue courante.
- **Notification v1** : badge sur l'icône dock + entrée à l'ouverture de l'app. Deep link `?open=review&shared=<id>` (pattern existant). Pas d'email/Slack en v1.

## 3. Données & pièges hérités du V6 (obligations, vérifiées en revue)

- **Owner, pas créateur** : toute attribution d'activité par `OwnerId` (`CreatedById` peut être un admin qui saisit pour un commercial — cas réel Paul/Théo).
- **Semaine ISO vérifiée** contre une date réelle (un helper décalé d'une semaine corrompt tout).
- **Pas de double comptage** : « Global » inclut déjà chaque commercial — ne jamais sommer Global + individus.
- **Sur-mesure 6 mois glissants** : `CloseDate ∈ [aujourd'hui, +180 j]`, jamais de CloseDate passées dans le prévisionnel.
- **RDV** : date de référence `ActivityDate` (events rétroactifs fréquents dans l'org) — cohérent Weekly Perf.
- Stages fantômes : uniquement `IsWon`/`IsClosed`, pas de libellés en dur.

## 4. Contrat API (draft — figé au lot 6.1 après l'audit)

**Endpoint** : `GET /api/review?resource=…` — routeur unique (pattern `api/calls.js`), helpers `api/_review/`. Fonction Vercel supplémentaire (plafond Hobby 12 — inventaire `docs/ops/vercel-functions.md` à mettre à jour).

| Resource | Contenu | Params |
|---|---|---|
| `kpis` | KPIs + comparaisons N-1/N-2 | `granularity`, `period`, `owner?` |
| `breakdown` | CA par type de vente | idem |
| `funnel` | funnel SDR | idem |
| `attention` | opps sans action / clés / chaudes | `owner?`, `limit` |
| `shared` | analyses partagées avec moi / par moi | — |

- `POST /api/review` `{action: "share", config, note, recipient_id|all}` — réservé manager/admin ; `{action: "unshare", id}` idem ; lecture d'une analyse partagée : autorisée au destinataire (config resservie telle quelle, données recalculées).
- **Authz** : JWT requis ; `granularity/period/owner` libres pour manager/admin ; pour un commercial, **uniquement** via une analyse partagée dont il est destinataire (la config vient de la table, pas du client).
- **Cache** : `s-maxage=3600` (macro = fraîcheur horaire suffisante, quota API SF préservé) ; `shared` : pas de cache CDN (données par utilisateur, header `private`).
- **Erreurs** : 401 / 403 (commercial hors analyse partagée) / 400 période invalide / 502 SF.

## 5. Persistance (migration Supabase)

Table `shared_analyses` : `id`, `created_by` (profile), `recipient_id` (profile, **null = toute l'équipe**), `config jsonb`, `note text`, `created_at`, `revoked_at` (null = actif). RLS : lecture destinataire/créateur/admin ; écriture service-role only (pattern existant). Pas de `read_at` en v1 (YAGNI — le badge front suffit).

## 6. UI (`src/apps/review/` — lot 6.2)

- Fenêtre X OS (`id: "review"`, dock visible tous rôles), charte glassmorphism, graphiques Recharts (dépendance posée au lot 3.2).
- **Manager/admin** : barre période (granularité + navigation + rappel comparatif « vs N-1 »), barre filtres commercial, sections V6 (KPIs → CA/donut → funnel → attention), bouton « Partager cette analyse ».
- **Commercial** : liste « Partagées avec moi » (note du manager en tête, config en lecture seule).
- Wording des comparatifs **explicite** (« T2 FY26 vs T2 FY25 »), pas de « +12 % » sans référence.
- États : skeleton / vide / erreur + Réessayer (patterns Weekly).

## 7. Découpage en lots (remplace les lots 6.x initiaux)

- **6.0 Audit** — étendu : ~~FY XOS~~ **acté : juillet–juin** (2026-07-11, cf. `weekly-perf.md` § 9.1), définitions CA signé, profondeur d'historique pour N-2, valeurs réelles `Type_de_vente__c` (vérifiées 2026-07-11 : Catalogue, Sur-mesure, Conseil, LMS, XOS+) / `Resultat_call__c`, volumétrie/coût SOQL des requêtes longues. **Validation Théo** — bloque la suite.
- **6.1 `api/review.js`** + migration `shared_analyses` + mapping (types de vente si absents).
- **6.2 UI** `src/apps/review/` + registry + partage bout en bout.

## 8. Critères d'acceptation

1. Changer granularité/période met à jour **tous** les KPIs ; vue semaine par défaut = dernière semaine complète.
2. Comparaison N-1 exacte sur une période pilote recoupée vs SOQL manuel (±5 %) ; N-2 si profondeur disponible.
3. Filtre commercial piloté par les profils (aucun prénom en dur dans le code).
4. Partage : manager partage une vue → le commercial la voit avec la note ; un commercial sans partage n'accède à aucune donnée macro (403) ; révocation effective.
5. Donut CA : nb + % + montants ; funnel avec les vraies valeurs picklist du mapping.
6. Cache 1 h sur les resources macro ; `shared` en `private`.
7. Gate QC standard (tsc, eslint, build, non-régression Cleaner) + tests API des règles d'authz.
