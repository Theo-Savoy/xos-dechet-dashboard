# Contrat Call Manager (Phase 4)

**Statut** : figé le 2026-07-10 — contrat partagé par les 3 lots parallèles. Ne pas dévier des formes de requête/réponse ci-dessous sans accord du coordinateur (Théo / Claude Code orchestrateur).

## But produit

Outil **opérationnel** de prospection téléphonique (pas un dashboard analytique) :
1. **Créer** une liste d'appels (séance de prospection) à partir de contacts Salesforce.
2. **Exécuter** la séance : parcourir les contacts un par un, appeler, **logguer l'appel en 1 clic** (crée une Task SF), passer au suivant.
3. **Suivre ses stats** : appels loggés (jour / semaine), séances terminées.

## Découpage en 3 lots (fichiers disjoints)

| Lot | Agent | Fichiers | Rôle |
|---|---|---|---|
| **4.A — Moteur de séances** | Command Code / DeepSeek V4 Pro | `supabase/migrations/004_call_sessions.sql`, `api/calls.js`, `api/calls.test.js` | DB + cycle de vie séance + log d'appel → Task SF + stats |
| **4.B — Créer les listes** | Cursor | `api/calls-list.js`, `api/calls-list.test.js` | SOQL : sourcer les contacts à appeler |
| **4.C — UI** | Antigravity | `src/apps/calls/**`, entrée dans `src/os/registry.ts` | Interface : création + runner + stats |

Chacun ne touche **que** ses fichiers. Le seul point de contact code est `registry.ts` (uniquement 4.C).

## Conventions du repo (à respecter)

- **Auth** : `import { verifyJWT, respond } from "./_auth.js"`. Tout endpoint vérifie le JWT en premier ; 401 si absent. Voir `api/log.js` et `api/search.js`.
- **Salesforce** : token via refresh-token flow (copier `fetchSFToken()` de `api/log.js` — convention : chaque endpoint est autonome, pas de helper SF partagé). API SF `v67.0`. `SF_INSTANCE_URL` en env.
- **Écritures + journal** : après une écriture SF, insérer dans `action_journal` (voir `journalAction()` dans `api/log.js`). Service role Supabase (`SUPABASE_SERVICE_ROLE_KEY`).
- **Validation** : `SF_ID = /^[a-zA-Z0-9]{15,18}$/` pour tout id Salesforce ; rejeter les corps malformés (`invalid_json`, `invalid_body`, `missing_action`) avant tout appel réseau — comme `api/log.js`.
- **Cache** : `Cache-Control: no-store` sur les endpoints d'écriture et sur `api/calls.js`. `api/calls-list` : `no-store` (données live).
- **Front** : apps sous `src/apps/<id>/`, enregistrées dans `src/os/registry.ts`. Design system : `src/components/ui/` (`GlassCard`, `Button`, `Tag`). Suivre le pattern de `src/apps/cleaner/CleanerApp.tsx` (token session Supabase → header `Authorization: Bearer`).
- **Tests** : vitest, à côté du fichier (`*.test.js` / `*.test.tsx`), comme l'existant. Build/tsc/eslint doivent passer.

---

## Schéma DB — migration `004_call_sessions.sql` (lot 4.A)

Suivre exactement le style de `001_initial_schema.sql` (RLS activée, select = `authenticated`, write = `service_role`).

```sql
-- call_sessions : une séance de prospection
create table public.call_sessions (
  id           bigint generated always as identity primary key,
  owner        uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  status       text not null default 'active' check (status in ('active','completed')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_call_sessions_owner on public.call_sessions (owner, created_at desc);

-- call_session_contacts : contacts de la séance, ordonnés
create table public.call_session_contacts (
  id             bigint generated always as identity primary key,
  session_id     bigint not null references public.call_sessions(id) on delete cascade,
  position       int not null,
  sf_contact_id  text not null,
  sf_account_id  text,
  contact_name   text not null,
  account_name   text,
  phone          text,
  status         text not null default 'pending' check (status in ('pending','called','skipped')),
  outcome        text,
  comments       text,
  sf_task_id     text,
  called_at      timestamptz
);
create index idx_call_session_contacts_session on public.call_session_contacts (session_id, position);
```

RLS : `select to authenticated using (true)` ; insert/update/delete `to service_role`. (L'isolation par owner est faite dans `api/calls.js`, comme le reste du repo.)

---

## API — `api/calls.js` (lot 4.A)

Toujours vérifier le JWT. Pour toute opération sur une séance existante : lire la séance en service-role et **vérifier `session.owner === user.id`** (sinon `404 not_found`, ne pas divulguer).

### `GET /api/calls`
Liste les séances de l'utilisateur courant, avec compteurs de progression.
```json
{ "sessions": [
  { "id": 12, "name": "Prospection Lyon", "status": "active",
    "created_at": "...", "total": 20, "called": 7, "skipped": 1, "pending": 12 }
] }
```

### `GET /api/calls?session_id=<id>`
Une séance + ses contacts ordonnés par `position`.
```json
{ "session": { "id": 12, "name": "...", "status": "active", "created_at": "..." },
  "contacts": [
    { "id": 101, "position": 0, "sf_contact_id": "003...", "sf_account_id": "001...",
      "contact_name": "Marie Dupont", "account_name": "ACME", "phone": "+33...",
      "status": "pending", "outcome": null, "comments": null, "sf_task_id": null, "called_at": null }
  ] }
```

### `GET /api/calls?stats=1`
Stats de l'utilisateur courant (depuis `call_session_contacts` + `call_sessions`).
```json
{ "stats": { "calls_today": 12, "calls_week": 47, "sessions_active": 1, "sessions_completed": 5 } }
```

### `POST /api/calls` — `action: "create_session"`
```json
{ "action": "create_session",
  "name": "Prospection Lyon",
  "contacts": [
    { "sf_contact_id": "003...", "sf_account_id": "001...", "contact_name": "Marie Dupont", "account_name": "ACME", "phone": "+33..." }
  ] }
```
- Valide : `name` non vide ; `contacts` tableau non vide ; chaque `sf_contact_id` matche `SF_ID` ; `contact_name` non vide ; `sf_account_id` si présent matche `SF_ID`.
- Insère la séance + les contacts (`position` = index du tableau, `status='pending'`).
- Réponse : `{ "session": { "id": 12, ... }, "contacts": [ ... ] }` (même forme que le GET).

### `POST /api/calls` — `action: "log_call"`  ← **le cœur du 1-clic**
```json
{ "action": "log_call", "session_id": 12, "contact_id": 101,
  "outcome": "answered", "comments": "RDV fixé mardi" }
```
- Valide : `session_id`/`contact_id` entiers ; le contact appartient bien à la séance de l'utilisateur ; `outcome` ∈ `["answered","no_answer","callback","not_interested","wrong_number"]` ; `comments` string (peut être vide → sujet par défaut).
- Crée une **Task SF** (réutiliser la logique `log_call` de `api/log.js`) : `Subject: "Appel — <outcome lisible>"`, `Description: comments + "\n\n[via X OS par <nom>]"`, `Status: "Completed"`, `ActivityDate: today (Europe/Paris)`, `WhoId = sf_contact_id`, `WhatId = sf_account_id` si présent.
- Met à jour le `call_session_contacts` : `status='called'`, `outcome`, `comments`, `sf_task_id`, `called_at=now()`.
- Journalise (`action_type: "call_session_log"`, targets = le contact).
- Réponse : `{ "success": true, "taskId": "00T...", "contact_id": 101 }`.

### `POST /api/calls` — `action: "skip_contact"`
`{ "action": "skip_contact", "session_id": 12, "contact_id": 101 }` → `status='skipped'`. Réponse `{ "success": true }`.

### `POST /api/calls` — `action: "complete_session"`
`{ "action": "complete_session", "session_id": 12 }` → `status='completed'`, `completed_at=now()`. Réponse `{ "success": true }`.

**Codes d'erreur** : `unauthorized` (401), `invalid_json`/`invalid_body`/`missing_action`/`invalid_*` (400), `not_found` (404), `sf_*` (502).

---

## API — `api/calls-list.js` (lot 4.B)

Endpoint **lecture seule** SF qui source les contacts à appeler. Sort exactement la forme consommée par `create_session`.

### `POST /api/calls-list`
```json
{ "filters": { "ownerOnly": true, "accountId": "001...", "hasPhone": true, "limit": 50 } }
```
- JWT requis. `fetchSFToken()` autonome (copier de `log.js`).
- `ownerOnly` (défaut `true`) : ne renvoyer que les contacts dont le compte/owner correspond au `sf_user_id` du profil courant. Récupérer `sf_user_id` en lisant `profiles` (service role) pour l'utilisateur JWT.
- `hasPhone` (défaut `true`) : `Phone != null`.
- `accountId` (optionnel, `SF_ID`) : filtrer sur un compte.
- `limit` (défaut 50, max 200).
- SOQL sur `Contact` : `Id, Name, Phone, Account.Id, Account.Name`. Échapper les entrées (voir `escapeSOSL`/paramétrage SOQL de `search.js`).
- Réponse :
```json
{ "contacts": [
  { "sf_contact_id": "003...", "sf_account_id": "001...", "contact_name": "Marie Dupont", "account_name": "ACME", "phone": "+33..." }
] }
```
- **La forme de chaque élément est identique à `contacts[]` de `create_session`** : l'UI passe la liste telle quelle.
- Erreurs : `unauthorized` (401), `invalid_body`/`invalid_filters` (400), `sf_*` (502).

**Hors périmètre v1** (ponytail) : exclusion des contacts déjà appelés récemment, scoring/priorisation. Filtres simples suffisent pour la v1.

---

## UI — `src/apps/calls/` (lot 4.C)

App React enregistrée dans `registry.ts` : `{ id: "calls", title: "Call Manager", icon: "☎", component: lazy(() => import("../apps/calls/CallManagerApp")), defaultSize: { w: 960, h: 620 } }`.

Auth : récupérer le token de session Supabase et l'envoyer en `Authorization: Bearer` (comme `CleanerApp.tsx`).

Trois vues dans une seule fenêtre :

1. **Séances** (accueil) : liste des séances (`GET /api/calls`) avec barre de progression (`called/total`) ; bouton **« Nouvelle séance »**.
2. **Nouvelle séance** : filtres simples (mes contacts / avec téléphone / compte) → `POST /api/calls-list` → aperçu de la liste → champ nom → **« Lancer la séance »** (`create_session`) → ouvre le runner.
3. **Runner** (exécution) : carte du contact courant (nom, compte, **téléphone en lien `tel:` + bouton Appeler**), formulaire de log **pré-rempli** (select `outcome` + `comments`), bouton **« Logguer & suivant »** (1 clic → `log_call` puis avance au contact `pending` suivant), bouton **« Passer »** (`skip_contact`), barre de progression. Fin de liste → `complete_session` + écran récap.

Charte : dark glassmorphism existante (`theme.css`, `components/ui`). Cohérence visuelle avec le Cleaner. États loading/erreur/vide gérés.

**Découplage** : l'UI est développée contre ce contrat (formes figées). L'intégration réelle avec les endpoints se fait au merge par l'orchestrateur.
