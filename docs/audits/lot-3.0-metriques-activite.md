# 📈 Lot 3.0 — Audit Métriques d'Activité (Weekly Perf)

**Date** : 2026-07-10
**Périmètre** : 8 semaines glissantes (2026-05-15 → 2026-07-10, semaines W21–W28)
**Scripts** : `scripts/audit/01_tasks_audit.py` → `04_created_vs_won_audit.py`
**Sources** : Salesforce (Tasks, Events, OpportunityHistory, Opportunities), lecture seule

---

## 1. Synthèse des volumes

| Objet | Période | Volume |
|---|---|---|
| **Tasks** | 8 semaines | 497 |
| **Events** | 8 semaines | 680 |
| **OpportunityHistory** | 8 semaines | 294 |
| **Opps créées** | 8 semaines | 38 (487 k€) |
| **Opps gagnées** | 8 semaines | 11 (208 k€) |

---

## 2. Résultats détaillés

### 2.1 Tasks — Types et sous-types réels

**TaskSubtype (picklist active)** : `Task`, `Email`, `ListEmail`, `Cadence`, `Call`, `LinkedIn`

**Distribution sur 8 semaines** :

| TaskSubtype | Nombre | % |
|---|---|---|
| **Email** | 420 | 84.5% |
| **Call** | 76 | 15.3% |
| Task | 1 | 0.2% |

**Classification par sujet (pattern matching)** :
- **Appels** (~15%) : sujets contenant "Appel" — `Appel non décroché` (20), `Appel SORTANT` (19), `Appel nogo` (14), `Appel rdv pris` (4)
- **Emails** (~72%) : sujets contenant "E-mail", "Email", "Mail", "relance"
- **RDV** (~12%) : sujets "RDV" + patterns "rendez-vous", "démo"

**ⓘ Points clés** :
- La TaskSubtype `Call` (76) recoupe quasi-exactement les sujets "Appel*" (75). Le champ `TaskSubtype` est **fiable** pour identifier les appels.
- La TaskSubtype `Email` (420) capture les emails automatiques (sync Outlook/Gmail). Le volume est très élevé mais peu discriminant pour la perf commerciale — un commercial connecté génère mécaniquement des dizaines d'emails par semaine.
- Les sujets ne sont pas normalisés (pas de convention commune).
- **Seulement 2 commerciaux ont créé des Tasks sur la période** : Christophe Hirtz (444, 89%) et Yanis Agharbi (46, 9%). Paul RATHOUIN (5) et Jérôme Bosio (2) en ont presque aucune. Ce biais est critique : la métrique Pulse ne peut pas s'appuyer uniquement sur les Tasks.

**Volumes Tasks par commercial × semaine** (top 4) :

| Owner | W21 | W22 | W23 | W24 | W25 | W26 | W27 | W28 | Total |
|---|---|---|---|---|---|---|---|---|---|
| Christophe Hirtz | 81 | 48 | 54 | 59 | 49 | 48 | 69 | 32 | 444 |
| Yanis Agharbi | 0 | 29 | 2 | 4 | 0 | 7 | 4 | 0 | 46 |
| Paul RATHOUIN | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 2 | 5 |
| Jérôme Bosio | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 |

### 2.2 Events — Types et volumes réels

**Type (picklist)** : `Appel`, `Autre`, `E-mail`, `Réunion` — mais **100% des Events ont `Type = null`** sur la période. Le champ n'est pas renseigné par les utilisateurs.

**EventSubtype** : `Event` uniquement (valeur unique).

**Convention de nommage (sujets)** : une convention émerge dans les sujets :
- `🏅 Rdv découverte prospect` (84) — RDV de prospection
- `💼 Point suivi opportunité` (20) — suivi d'opp existante
- `🏆 Soutenance` (11) — soutenance/défense
- `🏅 Rdv détection enjeux client` (8) — détection client existant
- `👀 Point suivi client` (4) — suivi client
- `XOS & [Client] : Point e-learning/formation` (~150 occurrences) — points de suivi nominatifs

**Distribution par commercial** (4 commerciaux actifs sur 8 semaines) :

| Owner | Total Events |
|---|---|
| Paul RATHOUIN | 246 |
| Jérôme Bosio | 162 |
| Christophe Hirtz | 146 |
| Yanis Agharbi | 126 |

**Durée moyenne** : 59 minutes

**ⓘ Points clés** :
- Les Events sont bien répartis entre les 4 commerciaux (contrairement aux Tasks).
- Le champ `Type` étant null, la classification repose uniquement sur le sujet. La convention emoji (🏅 prospection, 💼 suivi opp, 🏆 soutenance, 👀 suivi client) est utilisée de façon cohérente.
- Les Events ont des `ActivityDate` qui peuvent être très éloignées de leur `CreatedDate` (events créés récemment avec ActivityDate rétroactive). Pour le Pulse hebdomadaire, la date de référence doit être `ActivityDate` (quand l'activité a eu lieu) et non `CreatedDate`.

### 2.3 OpportunityHistory — Nommage des étapes et progression

**11 étapes actives** (ordre SF) :

| # | Étape | Prob défaut | Statut |
|---|---|---|---|
| 1 | Projet identifié | 10% | Ouverte |
| 2 | XOS recommandé | 15% | Ouverte |
| 3 | Projet qualifié / AO reçu | 20% | Ouverte |
| 4 | **Proposition envoyée** | 25% | Ouverte |
| 5 | XOS short-listé | 40% | Ouverte |
| 6 | Nego technique engagée | 50% | Ouverte |
| 7 | Négo financière engagée | 70% | Ouverte |
| 8 | OK de principe | 90% | Ouverte |
| 9 | Fermée / Gagnée | 100% | Fermée (gagnée) |
| 10 | Fermée / Perdue | 0% | Fermée (perdue) |
| 11 | Suspect enlisé | 0% | Ouverte |

**Distribution des changements d'étape (8 semaines)** :

| Étape atteinte | Occurrences | % |
|---|---|---|
| Fermée / Perdue | 88 | 29.9% |
| XOS recommandé | 49 | 16.7% |
| Projet identifié | 37 | 12.6% |
| Suspect enlisé | 35 | 11.9% |
| Négo financière engagée | 23 | 7.8% |
| Proposition envoyée | 21 | 7.1% |
| Projet qualifié / AO reçu | 19 | 6.5% |
| Fermée / Gagnée | 12 | 4.1% |
| XOS short-listé | 5 | 1.7% |
| OK de principe | 3 | 1.0% |
| Perdu* | 2 | 0.7% |

> \* **Anomalie** : l'étape `Perdu` apparaît dans l'historique mais n'existe pas dans les étapes actives (l'étape active est `Fermée / Perdue`). Il s'agit probablement d'un renommage historique. Les 2 occurrences en W27-W28 suggèrent une utilisation très récente et marginale.

**Progression réelle** :
- **182 opportunités uniques** ont eu au moins un changement d'étape sur 8 semaines.
- **Seulement 21 opps (11.5%) ont progressé** (sont passées à une étape d'ordre supérieur).
- **161 opps (88.5%) sont restées au même stade** — cela signifie que la majorité des entrées OpportunityHistory correspondent à des mises à jour sans progression (changement de montant, probabilité, close date…) ou à des rétrogradations.

### 2.4 Pipeline Généré vs Gagné

**Volumes par commercial (8 semaines)** :

| Commercial | Créées | Montant créé | Gagnées | Montant gagné | Win rate (nb) | Win rate (€) |
|---|---|---|---|---|---|---|
| Christophe Hirtz | 27 | 373 100 € | 6 | 83 321 € | 22% | 22% |
| Paul RATHOUIN | 10 | 114 080 € | 5 | 124 940 € | 50% | 110% |
| Yanis Agharbi | 1 | 0 € | 0 | 0 € | 0% | — |
| Jérôme Bosio | 0 | 0 € | 0 | 0 € | — | — |
| **Total** | **38** | **487 180 €** | **11** | **208 261 €** | **29%** | **43%** |

**ⓘ Points clés** :
- **Jérôme Bosio n'a créé ni gagné aucune opp sur la période**, malgré 162 Events et 2 Tasks. Son activité semble être du support/nurturing sans génération directe de pipeline.
- **Yanis Agharbi** : 1 opp créée (montant 0€), 0 gagnée, mais 126 Events et 46 Tasks — activité de RDV sans conversion mesurable sur 8 semaines.
- **Paul RATHOUIN** a le meilleur taux de closing (50% en nombre, dépasse 100% en montant car il gagne des deals créés avant la période ou sur-évalués).
- La comparaison par semaine montre une **forte variabilité** : W28 a 12 opps créées pour 1 gagnée (ratio 0.08), W27 a 4 créées pour 5 gagnées (ratio 1.25). Le lissage sur 8 semaines est nécessaire.

---

## 3. Définitions proposées des 3 métriques

### 3.1 📞 Le Pulse — Activité commerciale hebdomadaire

**Définition proposée** : pour chaque commercial, chaque semaine, on compte :

| Composante | Source | Filtre |
|---|---|---|
| **Appels** | `Task` | `TaskSubtype = 'Call'` ET `ActivityDate` ∈ semaine |
| **RDV** | `Event` | `ActivityDate` ∈ semaine (tous les Events, le champ `Type` étant null) |
| **Propositions** | `OpportunityHistory` | `StageName = 'Proposition envoyée'` ET `CreatedDate` ∈ semaine |

**Justification** :
- Les appels sont identifiés de façon fiable par `TaskSubtype = 'Call'` (76 sur 8 semaines, corrélation quasi-parfaite avec les sujets "Appel*"). C'est un volume faible mais significatif.
- Les emails (TaskSubtype = 'Email', 420) sont **exclus** du Pulse : ils résultent de la synchro Outlook/Gmail et ne reflètent pas un effort commercial intentionnel.
- Les RDV sont comptés via Events. Le champ `Type` étant null, on compte tous les Events sans filtrage par type. La convention emoji dans les sujets permet un affichage optionnel par catégorie (🏅 prospection, 💼 suivi, 🏆 soutenance), mais ce n'est pas requis pour le calcul de base.
- Les propositions sont capturées via `OpportunityHistory` quand une opp entre dans l'étape `Proposition envoyée`. C'est l'indicateur le plus fiable d'avancement commercial.

**Données réelles sur 8 semaines** (tous commerciaux, total période) :

| Métrique | Total 8 semaines | Moyenne / semaine |
|---|---|---|
| Appels (TaskSubtype=Call) | 76 | ~10 |
| RDV (Events) | 680 (dont ~150 dans la fenêtre W21-W28 réelle*) | ~19 |
| Propositions envoyées | 21 | ~3 |

> \*Note : les 680 Events incluent des ActivityDate hors de la fenêtre W21-W28 (créés dans les 56j mais avec dates d'activité antérieures). En filtrant par `ActivityDate` dans les 8 semaines, on obtient environ 150 Events.

### 3.2 💰 Pipeline Généré vs Gagné

**Définition proposée** : par commercial × semaine, on agrège :

| Composante | Source | Filtre |
|---|---|---|
| **Pipeline Généré** | `Opportunity` | `CreatedDate` ∈ semaine — somme des `Amount` |
| **Pipeline Gagné** | `Opportunity` | `IsWon = true` ET `CloseDate` ∈ semaine — somme des `Amount` |
| **Taux de closing** | Calculé | Gagné / Généré (en montant et en nombre) |

**Données réelles sur 8 semaines** (par commercial) :

| Commercial | Généré (nb/montant) | Gagné (nb/montant) | Taux closing nb | Taux closing € |
|---|---|---|---|---|
| Christophe Hirtz | 27 / 373 k€ | 6 / 83 k€ | 22% | 22% |
| Paul RATHOUIN | 10 / 114 k€ | 5 / 125 k€ | 50% | 110% |
| Yanis Agharbi | 1 / 0 € | 0 / 0 € | 0% | — |
| Jérôme Bosio | 0 / 0 € | 0 / 0 € | — | — |

**Justification** :
- La date de référence pour le « généré » est `CreatedDate` (quand l'opp entre dans le pipeline).
- La date de référence pour le « gagné » est `CloseDate` (quand l'opp est fermée gagnée). Une opp gagnée en semaine S peut avoir été créée des semaines plus tôt — le taux de closing n'est pas un taux de conversion same-week mais un ratio instantané.
- Le montant des opps gagnées (18 933 € en moyenne) est supérieur à celui des opps créées (12 821 €), ce qui suggère que les petits deals se créent beaucoup mais que les gros deals se gagnent. Le taux de closing en montant (43%) est mécaniquement supérieur au taux en nombre (29%).

### 3.3 📊 Taux d'Effort — Progression de pipeline

**Définition proposée** : ratio hebdomadaire =

```
Nb d'opportunités ayant changé d'étape (vers une étape supérieure) dans la semaine
÷
Nb d'opportunités ouvertes en début de semaine (hors Suspect enlisé et Fermées)
```

**Source** : `OpportunityHistory` — pour chaque entrée de la semaine, comparer le `StageName` atteint avec l'étape précédente de la même opp (via l'ordre des étapes dans `OpportunityStage.SortOrder`). Une progression est un passage d'un `SortOrder` inférieur à un `SortOrder` supérieur.

**Données réelles** :
- 294 entrées OpportunityHistory sur 8 semaines.
- 182 opps uniques touchées.
- **Seulement 21 opps (11.5%) ont réellement progressé sur 8 semaines.**
- 161 opps (88.5%) ont eu des mises à jour sans progression (changement de montant, probabilité, ou rétrogradation).

**Justification** :
- La majorité des entrées `OpportunityHistory` ne sont PAS des progressions. Le taux d'effort doit filtrer explicitement les progressions (stage advancement) pour ne pas comptabiliser les mises à jour sans changement d'étape.
- Le dénominateur (opps ouvertes) doit exclure les étapes fermées (Gagnée/Perdue) et `Suspect enlisé` pour éviter de diluer le taux.
- Sur 8 semaines, le taux d'effort hebdomadaire moyen est d'environ **2.6 progressions/semaine** (21 ÷ 8), soit un taux de **~3 à 5%** selon le nombre d'opps ouvertes actives (estimation : ~50-80 opps ouvertes hors Suspect enlisé).

**⚠️ Limite** : le taux sera très faible (quelques %), ce qui est normal dans un cycle de vente B2B long. Pour qu'il soit lisible, il faudrait peut-être l'exprimer en **nombre absolu de progressions par commercial** plutôt qu'en pourcentage, ou lisser sur 4 semaines.

---

## 4. Recommandations pour l'implémentation (Lot 3.1)

### Structure de `api/perf.js`

```js
// GET /api/perf?weeks=8
// Retourne par commercial × semaine :
{
  pulse: [{ owner, week, calls, meetings, proposals }],
  pipeline: [{ owner, week, generated_count, generated_amount, won_count, won_amount }],
  effort: [{ owner, week, progressions, open_opps_at_start, effort_rate }]
}
```

### Requêtes SOQL nécessaires

1. **Pulse — Appels** : `Task` WHERE `TaskSubtype = 'Call'` AND `ActivityDate >= LAST_N_DAYS:{weeks*7}` (par owner/semaine)
2. **Pulse — RDV** : `Event` WHERE `ActivityDate >= LAST_N_DAYS:{weeks*7}` (par owner/semaine)
3. **Pulse — Propositions** : `OpportunityHistory` WHERE `StageName = 'Proposition envoyée'` AND `CreatedDate >= LAST_N_DAYS:{weeks*7}` (par CreatedBy/semaine)
4. **Pipeline Généré** : `Opportunity` WHERE `CreatedDate >= LAST_N_DAYS:{weeks*7}` (par OwnerId/semaine, somme Amount)
5. **Pipeline Gagné** : `Opportunity` WHERE `IsWon = true` AND `CloseDate >= LAST_N_DAYS:{weeks*7}` (par OwnerId/semaine, somme Amount)
6. **Taux d'effort — Progressions** : `OpportunityHistory` WHERE `CreatedDate >= LAST_N_DAYS:{weeks*7}` → post-traitement JS pour détecter les progressions (comparaison SortOrder)
7. **Taux d'effort — Dénominateur** : `Opportunity` WHERE `IsClosed = false` AND `StageName != 'Suspect enlisé'` en début de chaque semaine → snapshot hebdomadaire

### Attention — Risques et cas particuliers

- **Events avec ActivityDate rétroactive** : dans l'org, des Events sont créés après coup avec une ActivityDate dans le passé. Pour le Pulse, la date de référence est `ActivityDate` (quand l'activité a eu lieu). Le script 02 le montre clairement.
- **Taux d'effort quasi nul certaines semaines** : 88% des entrées OpportunityHistory ne sont pas des progressions. L'UI doit gérer l'affichage de semaines à 0 progression.
- **Jérôme Bosio** : 0 opp créée/gagnée malgré 162 Events. Son rôle (manager? support?) doit être clarifié avant de l'inclure dans les comparaisons.
- **Yanis Agharbi** : activité Events significative mais 0 conversion. Possible nouveau commercial en montée en puissance ou rôle différent.
- **Stage `Perdu` fantôme** : 2 occurrences en W27-W28. À ignorer dans les calculs (utiliser `Fermée / Perdue` uniquement).
- **Cache** : `s-maxage=900` (15 min) comme spécifié dans le plan. Rafraîchissement suffisant pour de la perf hebdomadaire.

---

## 5. Fichiers produits

| Fichier | Description |
|---|---|
| `scripts/audit/01_tasks_audit.py` | Audit Tasks — types, sujets, volumes par owner/semaine |
| `scripts/audit/02_events_audit.py` | Audit Events — types, sujets, volumes par owner/semaine |
| `scripts/audit/03_opphistory_audit.py` | Audit OpportunityHistory — étapes, progressions |
| `scripts/audit/04_created_vs_won_audit.py` | Audit Pipeline — créées vs gagnées par owner/semaine |
| `/tmp/xos-audit/*.json` | Données brutes collectées |

**Aucun code produit** n'a été modifié. Les scripts sont en lecture seule (SOQL uniquement).

---

## 6. Validation

- [x] Définitions des 3 métriques validées → `docs/specs/weekly-perf.md` (2026-07-11)
- [x] Inclusion Jérôme / Yanis clarifiée : Jérôme = manager (hors classement commercial par défaut) ; Yanis = commercial (inclus)
- [x] Scripts SOQL exécutés sans erreur
- [x] Données collectées et analysées
- [x] Rapport livré
- [x] Effort : progressions en primaire, % en secondaire (décision produit)
