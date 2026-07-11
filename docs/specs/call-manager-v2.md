# Contrat Call Manager v2 — Moteur de ciblage, relance & attribution

**Statut** : figé le 2026-07-10. Étend le v1 (`call-manager.md`). Schéma SF vérifié en live (voir mémoire `salesforce-access`).

## Principe directeur : surcouche agnostique (réutilisabilité + juridique)

Le produit est un **outil générique**, XOS n'en est qu'une **configuration**. Deux règles non négociables :
1. **Adapter CRM** : toute logique Salesforce vit derrière une interface fine `src/crm/` (côté front) / `api/_crm/` (côté serveur). Salesforce = une implémentation. Aucun nom de champ SF en dur ailleurs.
2. **Mapping piloté par config** : les noms de champs / picklists / valeurs spécifiques à l'org vivent dans un **module de config** (`api/_crm/mapping.js`), pas dispersés en dur dans le code. Le moteur lit le mapping pour construire les requêtes. *(Un jour multi-tenant → table `crm_mapping` ; YAGNI aujourd'hui, le seam est le même.)*

**Hors périmètre v2** (YAGNI) : multi-CRM réel, multi-tenant complet, onboarding. Mais le code doit rester *prêt* pour ça (seam + config).

---

## Schéma SF de référence (config XOS — va dans `api/_crm/mapping.js`, pas en dur)

- **Account** : `Industry` (secteur, picklist ~40), `Nombre_employes__c` (tranches : `1 - 50`, `51 - 250`, `251 - 500`, `501 - 1000`, `1001 - 2000`, `2001 - 4999`, `5000 et plus`), `Type_de_client__c` (`Client inactif` / `Client` / `Prospect`), `ParentId` (compte principal → filiales).
- **Contact** : `Phone`, `AccountId`, `Title` (Fonction, texte libre → catégorisation phase 2), `Niveau_de_d_cision__c` (`+`/`=`/`-`), `NPA__c` (booléen NE PAS APPELER → exclure).
- **Task (appels)** : `Subject` contient « Appel » ou `TaskSubtype='Call'` ; `Resultat_call__c` ∈ {`Appel non décroché`, `Message répondeur`, `Appel décroché`, `Appel argumenté`, `RDV planifié`} ; `WhoId` (contact) ; `ActivityDate` ; `Status='Completed'` (valeur API ; libellé FR « Achevée ») ; `OwnerId`.
- **Opportunity** : `IsClosed`, `IsWon`, `StageName` (« Fermée / Perdue », « Fermée / Gagnée »…), `AccountId`.
- **User** : `Email` == email de login → auto-map `profiles.sf_user_id`.

---

## Mapping CRM — `api/_crm/mapping.js` (pas de table)

Objet de config exporté, lu par l'adapter. Contient les noms d'API SF, les tranches d'effectifs, les valeurs de picklist, l'attribution de la config XOS ci-dessus. **Aucun nom de champ SF en dur ailleurs.** Le front récupère les listes de valeurs (secteurs, effectifs, résultats) via un endpoint de config si besoin, sinon en dur côté UI depuis un type partagé.

## Data model (migration Supabase)

```sql
-- 005 : presets de ciblage sauvegardables
create table public.call_target_presets (
  id         bigint generated always as identity primary key,
  owner      uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  filters    jsonb not null,         -- l'arbre de filtres (voir plus bas)
  shared     boolean not null default false,  -- visible équipe (manager)
  created_at timestamptz not null default now()
);
```
RLS : select authenticated, write service_role (comme l'existant). `call_sessions`/`call_session_contacts` (v1) inchangés, servent aussi à la dédup.

---

## Arbre de filtres (le cœur — granulaire, modulaire, OU intra-famille / ET inter-famille)

```jsonc
{
  "entreprise": {                       // ET entre clés, OU dans les listes
    "secteurs": ["Finance", "Transports"],        // Industry IN (...)  → OR
    "effectifs": ["51 - 250", "251 - 500"],        // Nombre_employes__c IN (...) → OR
    "type_client": ["Prospect", "Client"],         // Type_de_client__c IN (...)
    "opp_ouverte": true | false | null,            // a une opp IsClosed=false
    "opp_perdue": true | null,                     // a une opp Closed Lost et 0 ouverte
    "compte_principal": "001..."                   // ParentId = X (cible le groupe)
  },
  "contact": {
    "a_telephone": true,
    "niveau_decision": ["+","="],                  // Niveau_de_d_cision__c IN
    "exclure_npa": true                            // NPA__c = false (défaut true)
  },
  "relance": {
    "jamais_appele": true | null,                  // 0 Task 'Appel'
    "dernier_appel_avant_jours": 30 | null,        // pas appelé depuis N j
    "dernier_appel_dans_jours": 7 | null,          // appelé dans les N j
    "dernier_resultat": ["Appel non décroché","Message répondeur"],  // Resultat_call__c du dernier
    "exclure_si_plus_de": { "appels": 3, "sur_jours": 30 },          // fréquence
    "duree_min_sec": null, "duree_max_sec": null                     // CallDurationInSeconds
  }
}
```
- **Comptage appels = tous commerciaux confondus** (pas seulement le mien).
- Défaut relance « follow-up » : `dernier_resultat ∈ {non décroché, répondeur}` (les *décroché/argumenté/RDV* sortent).

---

## Adapter CRM — `api/_crm/salesforce.js` (lot v2.A)

Interface (implémentée pour SF, extensible) :
- `buildTargetQuery(filters, mapping, sfUserId)` → SOQL Contact avec sous-requêtes/jointures Account + agrégations Task (relance) + Opportunity (opp ouverte/perdue). Échappement SOQL, `LIMIT` borné.
- `searchContacts(token, soql)` → records.
- `logCall(token, { contactId, accountId, resultat, comments, durationSec, ownerId })` → crée Task (`TaskSubtype='Call'`, `Resultat_call__c`, `WhoId`, `WhatId`, `Status='Completed'`, `ActivityDate=aujourd'hui (Paris)`, **`OwnerId = ownerId`** — attribution niveau 1, `Subject='Appel — <resultat>'`, description + `[via X OS par {nom}]`).
- `createEvent(token, { subject, startDateTime, durationMin, whoId, whatId, ownerId, invitees[] })` → crée Event (RDV planifié) avec le contact + invités additionnels.

Le mapping (noms de champs) vient de `api/_crm/mapping.js`, jamais en dur.

**Vérification `OwnerId` (critère d'acceptation v2.B)** : avec le token d'intégration prod, insérer une Task de test avec `OwnerId` = un autre user → si succès, supprimer et valider niveau 1 ; si refus (partage/rôle), **fallback** : owner = intégration + mention « [via X OS par {nom}] » (comme v1), et le signaler.

---

## API

- **`POST /api/calls-list`** (v2) : body `{ filters: <arbre>, preset_id?, limit? }` → `{ contacts: [ {sf_contact_id, sf_account_id, contact_name, account_name, phone, last_call_at?, call_count?} ], dedup: [{sf_contact_id, in_session_of}] }`. Forme contact compatible `create_session`.
- **`POST /api/calls`** — actions v2 :
  - `log_call` étendu : `{ session_id, contact_id, resultat, comments, duration_sec }` → `logCall` avec `OwnerId = sf_user_id du user` ; si `resultat='RDV planifié'` la réponse signale `needs_event: true`.
  - `log_event` (nouveau) : `{ session_id, contact_id, start, duration_min, invitees[] }` → `createEvent`.
  - `create_follow_up_session` : crée une séance à partir des contacts d'une séance dont le résultat ∈ relance.
- **`/api/presets`** : CRUD `call_target_presets` (JWT, owner ou shared).
- **Dédup** : `calls-list` renvoie les contacts déjà dans une séance active (à soi/collègue) avec un flag → l'UI **avertit ou exclut** (option).

---

## UI (`src/apps/calls/` v2)

- **Filter builder modulaire** : sections repliables Entreprise / Contact / Relance ; multi-select (OU) ; compteur live d'aperçu ; **presets** (charger/sauver/partager).
- **Dédup** : bandeau « X contacts déjà en séance » → toggle *avertir* / *exclure*.
- **Runner v2** : formulaire d'appel avec `Resultat_call__c` (les 5 valeurs), durée, 1-clic → suivant. Si **RDV planifié** → panneau **Event** (date/heure, invités). Bouton « Créer une séance de relance » depuis le récap.
- Charte glassmorphism, `components/ui`. Design soigné (effet waouh).

---

## Attribution
**Niveau 1 (v2)** : `OwnerId` de la Task/Event = `sf_user_id` du commercial connecté (mapping fait). Vérifier en prod que l'utilisateur d'intégration peut assigner à un autre owner.

---

## Découpage en lots (orchestration)

| Lot | Fichiers | Agent |
|---|---|---|
| **v2.A** Adapter + mapping + moteur SOQL | `api/_crm/mapping.js`, `api/_crm/salesforce.js`, migration `005_call_target_presets`, `api/calls-list.js` (réécrit) | Command Code / DeepSeek |
| **v2.B** Log enrichi + Event + presets | `api/calls.js` (log_call v2, log_event), `api/presets.js` | Cursor |
| **v2.C** UI builder + runner v2 | `src/apps/calls/**` (réécrit), `src/crm/` (types) | Antigravity/Cursor |
| **v2.D** *(lot séparé)* Login Salesforce | voir `docs/xos_implementation_plan.md` Phase 8 — **UI dual-option livrée** (`src/auth/`) ; OAuth backend (8.1) à brancher | — |

Auto-map `sf_user_id` par email : backfill + à chaque login (trigger/edge).
