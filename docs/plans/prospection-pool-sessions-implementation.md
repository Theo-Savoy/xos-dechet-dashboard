# Plan d’implémentation — Pool de prospection et séances découpées

**Date :** 2026-07-14  
**Statut :** plan proposé, aucune implémentation commencée  
**Périmètre :** Combo / Call Manager, création de séances de prospection

## 1. Décision produit

Une audience filtrée produit un pool de contacts disponibles. La création d’une séance prend un lot borné de ce pool, au maximum 100 contacts. Un contact est retiré du pool pendant tout son cycle de prospection : séance initiale active, relances et reports. Il redevient disponible uniquement lorsque le cycle est explicitement terminé ou libéré.

L’interface ne propose pas un générateur complexe de N séances. Elle propose une action répétable : **Créer une séance**, puis **Créer la prochaine séance** avec le même filtre et la même taille. Chaque séance reste un objet indépendant, avec son propre nom, sa date et son historique.

### Règles métier

- Taille de séance autorisée : entier de 1 à 100 ; défaut recommandé : 60.
- Une séance est un snapshot : les filtres peuvent évoluer sans modifier les séances déjà créées.
- Un contact engagé dans une séance active ou dans une relance active est indisponible dans toute nouvelle audience.
- Une relance conserve le même cycle et ne libère pas le contact.
- Un report vers une autre séance transfère l’engagement sans fenêtre de disponibilité.
- Une séance annulée libère les contacts non traités ; les contacts déjà traités restent régis par leur résultat.
- La clôture du cycle est explicite ou dérivée d’un résultat terminal. Elle libère le contact.
- Un contact ne peut avoir qu’un seul cycle actif à la fois, même si plusieurs utilisateurs créent des séances simultanément.

## 2. État actuel à préserver

Le système possède déjà :

- `call_sessions`, avec les statuts `active` et `completed` ;
- `call_session_contacts`, avec `pending`, les résultats, `attempt_count`, les informations de contact et l’ordre ;
- `create_follow_up_session` dans `api/_calls/sessionsWrite.js` ;
- `defer_contacts`, qui reporte des contacts vers une autre séance ;
- `filterContactsForFollowUp`, qui détermine les contacts pouvant entrer en relance ;
- `NewSessionView.tsx`, avec filtres, compteur, aperçu, limite et déduplication actuelle ;
- `sessionsRead.js` et les vues de suivi des séances.

Le nouveau mécanisme doit devenir la source serveur de l’éligibilité. Le frontend ne doit plus décider seul qu’un contact est disponible à partir de son aperçu local.

## 3. Architecture retenue

### 3.1 Table de cycle et réservation

Ajouter une migration Supabase, par exemple `supabase/migrations/029_prospection_contact_cycles.sql`, avec une table `call_contact_cycles` :

```text
id                  bigint generated always as identity primary key
sf_contact_id       text not null
status              text not null -- active | completed | released
origin_session_id   bigint not null references call_sessions(id)
current_session_id  bigint not null references call_sessions(id)
started_at          timestamptz not null default now()
completed_at        timestamptz null
closed_reason       text null
metadata            jsonb not null default '{}'
```

Ajouter une contrainte d’unicité partielle :

```sql
unique (sf_contact_id) where status = 'active'
```

Ajouter des index sur `(status, sf_contact_id)` et `current_session_id`.

Le cycle est distinct de la séance : une séance initiale et ses relances partagent le même `cycle_id` logique. Cette distinction évite de confondre « contact déjà dans une séance » et « contact définitivement traité ».

### 3.2 Création atomique

Créer une fonction SQL/RPC transactionnelle, par exemple `reserve_contacts_for_session`, appelée par l’API. Elle reçoit :

- l’utilisateur propriétaire ;
- le nom et la date de séance ;
- le type de séance ;
- les contacts candidats ordonnés ;
- la limite demandée.

La fonction doit :

1. verrouiller les candidats dans un ordre déterministe (`sf_contact_id`) ;
2. exclure les contacts possédant déjà un cycle `active` ;
3. prendre au plus `limit` contacts ;
4. créer la séance ;
5. créer les cycles actifs ;
6. insérer les `call_session_contacts` ;
7. retourner la séance, les contacts réservés, le nombre disponible restant et le nombre exclu.

La fonction doit être idempotente vis-à-vis d’un `request_id` fourni par l’API, afin qu’un retry réseau ne crée pas une deuxième séance.

Si l’environnement Supabase ne permet pas de fournir le candidat complet à la fonction, encapsuler dans une fonction serveur l’obtention des IDs puis transmettre la liste à la RPC. La réservation et l’insertion restent dans une seule transaction.

### 3.3 Compatibilité des données existantes

La migration doit initialiser les cycles actifs à partir des données existantes :

- pour chaque contact appartenant à une séance `active`, créer un cycle `active` pointant vers cette séance ;
- pour les séances `completed`, ne pas créer de cycle actif ;
- en cas de doublon historique dans plusieurs séances actives, conserver la séance la plus récente comme `current_session_id`, journaliser le conflit et ne pas faire échouer toute la migration.

Ajouter une requête de diagnostic post-migration qui vérifie :

- aucun contact n’a deux cycles actifs ;
- tous les cycles actifs pointent vers une séance existante ;
- tous les contacts de la séance courante existent dans `call_session_contacts`.

## 4. Backend

### 4.1 Nouveau service métier

Créer un module dédié, par exemple `api/_calls/prospectionPool.js`, plutôt que d’ajouter la logique dans `sessionsWrite.js`.

Responsabilités :

- `getAudienceAvailability` : total filtré, engagés, disponibles ;
- `reserveAudienceBatch` : création atomique d’une séance depuis les candidats ;
- `transferCycle` : changement de séance lors d’un report ou d’une relance ;
- `closeCycle` : libération terminale ;
- `releaseSessionContacts` : libération lors d’une annulation contrôlée.

Le service ne doit pas appeler Salesforce pour décider si un contact est engagé. La vérité de réservation est dans Supabase ; Salesforce reste la source des données CRM et des filtres d’audience.

### 4.2 Éligibilité des audiences

Faire évoluer l’endpoint de preview de création de séance pour retourner :

```text
match_count
engaged_count
disponible_count
match_count_capped
preview
excluded_summary
```

`preview` ne contient par défaut que les contacts disponibles. `excluded_summary` contient uniquement des compteurs par raison, pas une seconde liste volumineuse.

Le calcul doit être serveur-side :

1. récupérer les contacts correspondant aux filtres Salesforce ;
2. dédupliquer les IDs Salesforce ;
3. joindre les IDs actifs de `call_contact_cycles` ;
4. appliquer les règles de limite et de priorité ;
5. renvoyer le résultat borné.

### 4.3 Création d’une séance

Faire évoluer `create_session` pour accepter :

```json
{
  "name": "Prospection — Secteur X — vague 2",
  "contacts": ["003...", "003..."],
  "scheduled_for": "2026-07-14",
  "session_type": "prospection",
  "request_id": "uuid"
}
```

Le serveur ne doit pas faire confiance à la liste frontend comme preuve d’éligibilité. Il la traite comme une demande de candidats et revalide/réserve atomiquement.

Retourner :

```json
{
  "session": {},
  "contacts": [],
  "reserved_count": 60,
  "available_remaining": 60,
  "skipped_already_engaged": 3
}
```

Si certains candidats ont été pris entre le preview et la création, la séance est créée avec les candidats encore disponibles et l’interface affiche le delta. Elle ne doit pas échouer silencieusement.

### 4.4 Relances et reports

Adapter `create_follow_up_session` :

- reprendre les contacts éligibles par `filterContactsForFollowUp` ;
- créer une nouvelle séance ;
- transférer `current_session_id` vers la relance ;
- conserver le même cycle ;
- ne jamais créer un nouveau cycle pour une relance.

Adapter `defer_contacts` :

- verrouiller les lignes de cycles concernées ;
- valider que les contacts sont bien `pending` dans la séance source ;
- transférer la réservation vers la séance cible ou la nouvelle séance dans la même transaction ;
- empêcher un transfert vers une séance qui n’est pas active ;
- rendre l’opération idempotente.

### 4.5 Fin de cycle et annulation

Centraliser la décision de libération dans une fonction métier unique. Les résultats terminaux et les actions manuelles doivent appeler cette fonction, pas modifier directement les cycles depuis plusieurs routes.

Prévoir les raisons suivantes, extensibles sans changer le contrat :

```text
completed_no_follow_up
rdv_booked
refused
invalid_contact
manual_close
session_cancelled
```

Une séance terminée ne doit pas automatiquement libérer tous ses contacts : ceux dont le résultat déclenche une relance restent dans le cycle actif.

## 5. Interface

### 5.1 Composer une séance

Conserver le `FilterBuilder` actuel. Remplacer la lecture ambiguë du compteur par un bloc de disponibilité compact :

```text
237 contacts correspondent
117 déjà engagés dans une séance ou une relance
120 disponibles
```

Puis :

```text
Taille de la séance   [60]
```

Contraintes UI :

- champ ou sélecteur design system, jamais un `<select>` natif ;
- valeurs rapides `25`, `50`, `60`, `100` ;
- saisie personnalisée bornée entre 1 et 100 si le composant le permet ;
- bouton désactivé si aucun contact disponible ;
- message clair si le compteur change pendant la préparation.

### 5.2 Aperçu

L’aperçu montre les contacts disponibles qui seront proposés. Les contacts engagés sont masqués par défaut.

Ajouter une section repliable :

```text
117 contacts exclus — voir pourquoi
```

Elle affiche des compteurs et, si nécessaire, quelques exemples, mais jamais une deuxième table complète par défaut.

Chaque contact doit indiquer une raison d’exclusion lisible :

- `Déjà dans « Relance grands comptes »` ;
- `Cycle de prospection actif` ;
- `Cycle terminé` n’est pas une exclusion et ne doit pas apparaître dans ce compteur.

### 5.3 Après création

Afficher un résultat court :

```text
Séance créée avec 60 contacts.
Il reste 60 contacts disponibles dans cette audience.

[Créer la prochaine séance de 60] [Retour aux séances]
```

Le bouton suivant réutilise les filtres et la taille, mais ouvre une nouvelle création avec un nouveau nom suggéré. Il ne crée pas silencieusement plusieurs séances.

### 5.4 États d’erreur

Prévoir explicitement :

- audience vide ;
- audience entièrement engagée ;
- taille supérieure à 100 ;
- candidats devenus indisponibles entre preview et création ;
- échec de réservation transactionnelle ;
- session annulée ou relance déjà créée par un autre onglet.

Les messages doivent expliquer l’action possible, pas exposer une erreur SQL ou un identifiant interne.

## 6. Tests

### Backend unitaire

Ajouter des tests dans `api/_calls/prospectionPool.test.js` et compléter `sessionsWrite.test.js` :

1. une audience de 237 contacts réserve 60 contacts ;
2. la deuxième création réserve les 60 suivants ;
3. la dernière séance ne dépasse pas le reliquat ;
4. un contact dans une séance active est exclu ;
5. un contact dans une relance active est exclu ;
6. un cycle complété rend le contact disponible ;
7. une séance annulée libère les contacts non traités ;
8. un contact traité avec relance reste bloqué ;
9. un report transfère le cycle sans le libérer ;
10. deux réservations concurrentes ne partagent aucun contact ;
11. un retry avec le même `request_id` ne crée pas de doublon ;
12. la limite 100 est appliquée côté serveur, même si le client envoie 101.

### Frontend

Compléter les tests de `NewSessionView.tsx` :

- affiche séparément total, engagés et disponibles ;
- borne la taille à 100 ;
- désactive la création quand le pool est vide ;
- affiche le bouton de séance suivante après création ;
- conserve les filtres et la taille pour la séance suivante ;
- n’affiche pas une seconde table intrusive des exclus ;
- affiche un état de concurrence compréhensible.

### Intégration

Tester le flux complet :

```text
filtres → preview → création séance 1 → création séance 2 → relance → clôture cycle → retour dans le pool
```

Vérifier également les permissions existantes : propriétaire, membre partagé, manager et admin.

## 7. Ordre d’exécution

### Phase 1 — contrat et migration

- confirmer les statuts exacts utilisés par `call_sessions` et `call_session_contacts` ;
- écrire la migration et ses contraintes ;
- ajouter la migration des cycles historiques ;
- ajouter le diagnostic SQL ;
- tester rollback logique et idempotence.

### Phase 2 — service serveur

- créer `prospectionPool.js` ;
- implémenter disponibilité ;
- implémenter réservation atomique ;
- brancher `create_session` ;
- ajouter les tests backend et concurrency.

### Phase 3 — continuité des cycles

- brancher relances ;
- brancher reports ;
- centraliser clôture/libération ;
- couvrir annulation et résultats terminaux.

### Phase 4 — interface

- afficher les compteurs de disponibilité ;
- ajouter la taille bornée ;
- ajouter la section d’exclusions repliable ;
- ajouter le bouton de séance suivante ;
- traiter les états de concurrence et d’erreur.

### Phase 5 — validation

- tests backend ciblés ;
- tests frontend ciblés ;
- suite complète ;
- build, lint et format ;
- vérification manuelle avec une audience de plus de 100 contacts ;
- vérification multi-onglets ;
- vérification d’un cycle initial → relance → clôture.

## 8. Alternatives écartées

### Générer N séances automatiquement

Écarté pour la V1 : cela surcharge l’interface, rend les noms/dates difficiles à gérer et donne une illusion de contrôle sur des contacts qui peuvent devenir indisponibles pendant l’opération.

### Exclure définitivement les contacts déjà vus

Écarté : un contact placé dans une séance mais jamais traité, ou demandant une relance, doit rester géré par son cycle et non disparaître définitivement.

### Dédupliquer uniquement dans le frontend

Écarté : deux onglets ou deux utilisateurs peuvent créer des séances concurrentes. La garantie doit être transactionnelle côté base.

### Réutiliser seulement `call_session_contacts` sans table de cycle

Écarté pour la nouvelle règle : cela mélange la séance et le cycle, complique les relances et rend la libération difficile à garantir. Les données historiques seront néanmoins migrées vers la nouvelle représentation.

## 9. Critères d’acceptation

La feature est considérée prête lorsque :

- une audience peut être découpée en séances successives de 1 à 100 contacts ;
- aucune création concurrente ne donne le même contact dans deux cycles actifs ;
- les séances et relances retirent le contact du pool ;
- la clôture du cycle le rend à nouveau disponible ;
- l’utilisateur comprend en moins d’un écran pourquoi le pool contient moins de contacts que l’audience ;
- créer une deuxième séance demande un clic, pas une reconfiguration complète ;
- aucun KPI ou écran de pilotage existant n’est ajouté au parcours de création ;
- les tests du flux complet passent avec données historiques et données nouvelles.

## 10. Fichiers cibles probables

- `supabase/migrations/029_prospection_contact_cycles.sql`
- `api/_calls/prospectionPool.js`
- `api/_calls/prospectionPool.test.js`
- `api/_calls/sessionsWrite.js`
- `api/_calls/sessionsRead.js`
- `api/_calls/http.js`
- `api/_calls/sessionsWrite.test.js`
- `src/apps/calls/NewSessionView.tsx`
- `src/apps/calls/CallManagerApp.tsx`
- `src/apps/calls/types.ts`
- `src/apps/calls/api.ts` ou l’adaptateur API existant
- tests frontend correspondants

Aucun changement Salesforce n’est requis pour la réservation : Salesforce reste la source des filtres et des données de contact ; Supabase porte l’état opérationnel du cycle.
