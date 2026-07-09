# Plan d'implémentation — Actions en lot sur les opportunités

## Contexte

Dashboard XOS déchet (Vercel) : `dashboard.html` (front vanilla JS, dark theme) +
`api/refresh.py` (Python serverless, SOQL Salesforce, cache CDN 24h). Auth par
cookie via `middleware.js`. On ajoute le **traitement des opportunités depuis le
dashboard** : sélection multiple, modification en lot (propriétaire, date de
clôture, étape), action « Clore en perdue », et un **historique persistant des
opps traitées** (Vercel Blob), affiché dans un onglet « Traitées ».

## Architecture cible

```
dashboard.html ──POST /api/update──▶ api/update.js (Node)
                                      ├─ OAuth refresh SF (comme refresh.py)
                                      ├─ PATCH /composite/sobjects (lot ≤200)
                                      └─ append au journal Blob history.json
dashboard.html ──GET /api/history──▶ api/history.js (Node) ── lit le Blob
api/refresh.py : ajoute "meta" (stages + users actifs) à sa réponse
```

Node pour les 2 nouveaux endpoints car le SDK `@vercel/blob` est indispensable
pour le store **privé** (protocole REST non documenté). Le Python existant ne
bouge que pour ajouter `meta`.

## Recettes validées (ne pas improviser)

### Blob (testé, fonctionne)
```js
import { put, get } from '@vercel/blob';
// token = process.env.BLOB_READ_WRITE_TOKEN (déjà configuré sur le projet, tous envs)
await put('history.json', jsonString, {
  access: 'private', token, allowOverwrite: true,
  addRandomSuffix: false, contentType: 'application/json',
});
const res = await get('history.json', { access: 'private', token });
// res === null si le blob n'existe pas encore (404) → traiter comme journal vide
// sinon: const text = await new Response(res.stream).text();
```

### OAuth Salesforce (identique à api/refresh.py, en fetch)
POST `${SF_LOGIN_URL||'https://login.salesforce.com'}/services/oauth2/token`,
body urlencoded `grant_type=refresh_token&client_id=...&client_secret=...&refresh_token=...`
→ `access_token`. Env : `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN`,
`SF_INSTANCE_URL` (fallback `https://db0000000d7rdeay.my.salesforce.com`).
Attention : les vars peuvent être présentes mais vides → `process.env.X || fallback`.

### Update en lot Salesforce
PATCH `${SF_INSTANCE_URL}/services/data/v67.0/composite/sobjects`
```json
{ "allOrNone": false,
  "records": [ { "attributes": {"type": "Opportunity"}, "id": "006...",
                 "OwnerId": "...", "CloseDate": "2026-08-01", "StageName": "..." } ] }
```
Réponse : tableau `[{id, success, errors:[{statusCode, message}]}]` dans l'ordre.

## Contrats d'API

### POST /api/update
Requête :
```json
{ "opps": [ {"id": "006...", "name": "...", "account": "...", "owner": "..."} ],
  "changes": { "owner_id": "005...?", "close_date": "YYYY-MM-DD?", "stage": "...?" } }
```
- `opps` : 1 à 200 éléments, `id` matchant `/^[a-zA-Z0-9]{15,18}$/`. Seul `id`
  est envoyé à Salesforce ; name/account/owner ne servent qu'au journal.
- `changes` : au moins une clé parmi owner_id / close_date / stage. Mapping :
  owner_id→OwnerId, close_date→CloseDate (valider le format YYYY-MM-DD),
  stage→StageName (validation de la valeur déléguée à Salesforce, picklist
  restreinte), loss_reason→Raison_de_perte_V2__c (optionnelle, accompagne stage).
- « Clore en perdue » n'est PAS une clé spéciale : le front envoie
  `{"stage": "<étape closed/won=false>", "loss_reason": "Nettoyage"}` — la
  raison de perte est obligatoire dans Salesforce pour clore une opp, le
  bouton la renseigne automatiquement à « Nettoyage ».

Réponse 200 :
```json
{ "updated": 3, "failed": 1,
  "results": [ {"id": "006...", "success": true, "errors": []} ] }
```
Erreurs : 400 (payload invalide, message explicite), 500/502 (SF ou Blob,
`{"error": "...", "message": "..."}`). Timeout fetch SF : 30s.
Headers réponse : `Cache-Control: no-store`.

Après un lot où au moins une opp a réussi, écrire UNE entrée dans UN blob
immuable `history/<Date.now()>-<rand>.json` (pathname unique — jamais de
read-modify-write : la relecture d'un blob réécrit est servie par un cache
~60s et perdrait des entrées entre deux actions rapprochées) :
```json
{ "at": "ISO-8601 Europe/Paris", "changes": {...},
  "opps": [{"id", "name", "account", "owner", "success", "error": "msg|null"}] }
```
Si le PATCH SF a échoué globalement, ne rien journaliser.

### GET /api/history
`list({prefix: 'history/'})` + lecture des blobs, tri par pathname décroissant
(= chronologique inverse), plafond 200 entrées. Retourne `{"entries": [...]}`.
`Cache-Control: no-store`. Méthode GET uniquement.

### api/refresh.py — ajout "meta"
Deux SOQL en plus (mêmes helpers existants) :
- `SELECT MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder`
- `SELECT Id, Name FROM User WHERE IsActive = true AND UserType = 'Standard' ORDER BY Name`
Ajouter à `dashboard_data` :
```json
"meta": { "stages": [{"name", "closed", "won"}], "users": [{"id", "name"}] }
```

## Front (dashboard.html)

Style : conserver l'existant (vanilla JS ES5-ish, `var`/`function`, template par
concaténation, `escapeHtml()` pour toute donnée, badges/classes CSS existantes,
variables CSS `--accent` etc., textes en français).

1. **Sélection** : colonne checkbox en tête de tableau (1ère colonne).
   Case « tout » dans le `<thead>` = sélectionne/désélectionne tout le
   **résultat filtré** (pas seulement la page). Set JS `selectedIds` (Set de
   id). Les checkboxes reflètent l'état au re-render (pagination, tri, filtres
   ne perdent pas la sélection). Un clic sur la ligne ne sélectionne pas (les
   liens/tri restent intacts).
2. **Barre d'actions** : bandeau sticky sous la filter-bar, visible seulement si
   sélection > 0 : « N sélectionnées », `<select>` propriétaire (depuis
   `meta.users`, option vide « — Propriétaire — »), `<input type="date">`,
   `<select>` étape (depuis `meta.stages`, option vide), bouton « Appliquer »,
   bouton « ☠ Clore en perdue » (première étape `closed && !won`), bouton
   « Désélectionner ». Appliquer = envoie uniquement les champs renseignés ;
   désactivé si aucun champ. `confirm()` natif avant tout envoi, récapitulant
   N opps + changements.
3. **Envoi** : POST `/api/update` avec les opps sélectionnées (id, name,
   account, owner depuis ALL_OPPS). Pendant l'appel : boutons désactivés,
   libellé « ⏳ ». Au retour : afficher `updated/failed` (alert), vider la
   sélection, puis appeler `refreshData()` (déjà existant — bypass CDN) pour
   recharger la liste.
4. **Onglet « Traitées »** : bouton à côté du filtre catégorie qui bascule
   l'affichage entre le tableau principal et une vue historique (fetch
   `/api/history` à chaque ouverture). Rendu simple : une carte/section par
   entrée (date, changements appliqués, liste des opps avec ✓/✗ et lien SF
   `https://db0000000d7rdeay.my.salesforce.com/lightning/r/Opportunity/<id>/view`).
   Pas de pagination (journal récent en premier), état vide « Aucune opp
   traitée pour l'instant ».

## Contraintes générales

- `package.json` minimal à la racine : `{"dependencies": {"@vercel/blob": "^2"}}`
  (pas de scripts, pas de devDeps). Les fonctions Node en `.js` ESM
  (`export default function handler(req, res)` style Vercel Node, `req.body`
  déjà parsé si JSON).
- Pas d'import entre fichiers de `api/` (l'import inter-fichiers a déjà cassé
  en prod sur ce projet) : dupliquer les ~15 lignes d'OAuth si besoin.
- Validation d'entrée systématique côté serveur (trust boundary) ; par contre
  pas de gestion d'erreurs spéculative au-delà des contrats ci-dessus.
- Sécurité : ne jamais logger les tokens ; l'auth cookie est gérée par
  middleware.js, rien à faire dans les endpoints.
- Les agents ne peuvent PAS tester contre Salesforce/Blob (pas de tokens en
  local) : livrer du code + `node --check` / `python3 -m py_compile` propres.
  La vérification live est faite par l'orchestrateur après livraison.

## Découpage

- **Lot A (backend)** : `api/update.js`, `api/history.js`, `package.json`,
  modification `api/refresh.py` (meta). 
- **Lot B (front)** : `dashboard.html` uniquement.
Les deux lots ne partagent aucun fichier et se développent en parallèle sur la
base des contrats ci-dessus.
