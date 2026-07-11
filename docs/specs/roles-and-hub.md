# Rôles, Hub & permissions — contrat produit

**Statut** : figé le 2026-07-11. Prépare le lot Hub (2.3) et la trajectoire multi-tenant.

## Trois rôles (hiérarchie)

| Rôle | Qui (config XOS) | Intention |
|---|---|---|
| **`commercial`** | Tout le monde par défaut (ex. Yanis, Christophe) | Faire son job : appeler, logger, voir *sa* perf |
| **`manager`** | `jerome.bosio@…`, `paul.rathouin@…` | Piloter l'équipe : perf équipe, seuils, challenges |
| **`admin`** | `theo.savoy@…` | Super-utilisateur produit : tout manager + gestion des rôles / accès |

Hiérarchie d'accès : `admin` ⊃ `manager` ⊃ `commercial`.

Implémentation actuelle :
- Colonne `profiles.role` (`commercial` \| `manager` \| `admin`) — migration `008`
- Bootstrap email → rôle : `api/_config/access.js` (**config tenant**, pas du cœur produit)
- Helpers : `roleAtLeast`, `canManageSettings`, `canManageRoles`, `canViewTeamPerf`

---

## À quoi sert l'app Hub (lot 2.3) ?

Le Hub est le **panneau système** du bureau X OS — pas un dashboard métier. Une seule app, des panneaux selon le rôle.

### Pour un commercial

| Panneau | Contenu |
|---|---|
| **Compte** | Email, nom, rôle affiché, mapping Salesforce (`sf_user_id`) si présent, bouton **Déconnexion** |
| **Statut** | Connexion API SF OK/KO, quotas d'appels restants (lecture), fraîcheur des caches (Cleaner / analytics) |
| **Préférences perso** *(v1 légère)* | Rien de critique ; éventuel thème plus tard |

Il **ne peut pas** modifier les seuils globaux ni les rôles des collègues.

### Pour un manager

Tout le commercial, plus :

| Panneau | Contenu |
|---|---|
| **Configuration équipe** | Seuils de retard Cleaner, exclusions de comptes, éventuels paramètres Weekly Perf (commerciaux inclus dans le classement) — CRUD `settings` |
| **Équipe** *(lien)* | Raccourci vers Weekly Perf en vue équipe ; liste des profils (lecture) |

### Pour un admin

Tout le manager, plus :

| Panneau | Contenu |
|---|---|
| **Accès & rôles** | Liste des `profiles`, changement de rôle (`commercial` / `manager` / `admin`), invalidation session si besoin |
| **Santé plateforme** | Même statut SF, plus indicateurs utiles au prestataire (dernière erreur auth, version déployée) |
| **Bootstrap** | Voir / éditer plus tard la table d'accès tenant (aujourd'hui : module `access.js`) |

---

## Matrice permissions (cœur produit)

| Capacité | commercial | manager | admin |
|---|---|---|---|
| Apps opérationnelles (Cleaner, Call Manager, Launcher) | ✅ | ✅ | ✅ |
| Weekly Perf — vue « moi » | ✅ | ✅ | ✅ |
| Weekly Perf — vue équipe | ❌ | ✅ | ✅ |
| Hub — statut / compte / logout | ✅ | ✅ | ✅ |
| Hub — CRUD `settings` | ❌ | ✅ | ✅ |
| Hub — changer les rôles | ❌ | ❌ | ✅ |
| Arena — créer un challenge | ❌ | ✅ | ✅ |
| Extinction Basic Auth / ops sensibles | ❌ | ❌ | ✅ (humain + code) |

Le dock peut filtrer via `AppManifest.roles` (ex. Hub visible à tous ; panneau config seulement si `canManageSettings`).

---

## Trajectoire agnostique (produit indépendant de XOS)

### Ce qui est **cœur produit** (reste dans le socle)

- Les **trois rôles** et la hiérarchie
- Les **capabilities** (`canManageSettings`, etc.)
- L'UI Hub structurée par panneaux + garde côté API (`roleAtLeast` avant tout write `settings`)
- Le contrat `profiles.role`

### Ce qui est **config tenant** (remplaçable)

| Aujourd'hui (XOS) | Demain (multi-tenant) |
|---|---|
| `api/_config/access.js` → emails hardcodés | Table `tenant_access` ou claim JWT `role` poussé à l'onboarding |
| Domaine magique `xos-learning.fr` | Domaine(s) autorisés par tenant |
| Login SF OAuth (Phase 8) + magic link | Même dual-option ; IdP / consumer key par tenant |
| Charte / logo | Tokens thème par tenant |

### Login & permissions — étape d'après

1. **Phase 8.1** : OAuth SF → session Supabase + upsert `profiles` avec `roleFromEmail` (ou claim SF Profile → mapping tenant).
2. **Hub 2.3** : applique la matrice ci-dessus ; admin peut corriger un rôle sans redeploy.
3. **Multi-tenant** : remplacer `ROLE_BOOTSTRAP_BY_EMAIL` par une config DB ; le code Hub/API ne change pas s'il ne lit que `profiles.role`.
4. **Ne pas** encoder des emails XOS dans les composants React — uniquement via API `/api/me` (profil + capabilities).

---

## Déblocage lot 2.3

Prérequis humains **satisfaits** (2026-07-11) :

- Managers : `jerome.bosio@xos-learning.fr`, `paul.rathouin@xos-learning.fr`
- Admin : `theo.savoy@xos-learning.fr`

Prochaine livraison Hub : `api/status.js` (ou route consolidée, voir `docs/ops/vercel-functions.md`) + `src/apps/hub/` + bootstrap rôle à la création de profil / login.
