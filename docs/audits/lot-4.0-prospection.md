# Lot 4.0 — Audit Prospection : Rapport de volumétrie

**Date** : 2026-07-10
**Script** : `scripts/audit/audit_prospection.py` (SOQL lecture seule, credentials `.env.local` fournis par Hermes)
**Méthode** : 15 requêtes SOQL agrégées sur l'org de production, aucun champ modifié.

---

## 1. Volumétrie Contacts

### Volume total et tendance
- **40 203 contacts** dans l'org (toute l'histoire).
- Explosion récente : 12 136 créés en 2024, 11 570 en 2025, déjà 7 080 en 2026 (à mi-année).
- Avant 2024, le rythme était de 1 000–2 000/an.

| Année | Contacts créés |
|-------|---------------|
| 2021  | 784           |
| 2022  | 1 246         |
| 2023  | 2 158         |
| 2024  | 12 136        |
| 2025  | 11 570        |
| 2026  | 7 080 (en cours) |

### Pic d'import massif
Le détail mensuel révèle des imports par lots :
- **Juillet 2024** : 4 395 contacts en un mois
- **Juin 2026** : 2 860 contacts en un mois
- **Mars 2024** : 1 767 contacts
- **Juin 2024** : 1 586 contacts

Cohérent avec des imports Apollo par campagne.

### Qualité des données
- **Email rempli** : 87,2 % (35 071 / 40 203)
- **Téléphone rempli** : 60,2 % (24 196 / 40 203)
- **Titre/fonction rempli** : 96,8 % (38 930 / 40 203)
- **Contacts orphelins** (sans Account) : 418 (1 %)
- **Contacts sans aucune opportunité** : 38 580 (96 %)

### LeadSource des Contacts
| LeadSource | Nb contacts | % |
|---|---|---|
| **Apollo** | 25 700 | 63,9 % |
| (vide) | 10 692 | 26,6 % |
| Webinar | 498 | 1,2 % |
| Formulaire web | 487 | 1,2 % |
| Bouche à oreille | 398 | 1,0 % |
| LinkedIn | 301 | 0,7 % |
| Autres (<200) | 2 127 | 5,3 % |

**Apollo domine massivement** (64 %), suivi du vide (27 %). Le reste est du bruit.

### Propriété des contacts
- **36 744** contacts détenus par des utilisateurs **actifs** (91,4 %)
- **3 459** contacts détenus par des utilisateurs **inactifs** (8,6 %) — dont 2 303 chez Julien Bak (ancien commercial, déjà identifié comme inactif dans le Cleaner)
- **Top créateur** : Théo SAVOY avec 30 598 contacts (76 % du total !), cohérent avec les imports Apollo en masse.

### 🔴 Problème majeur
**96 % des contacts (38 580) n'ont jamais été rattachés à une opportunité**. Seulement 1 623 contacts (4 %) ont au moins un `OpportunityContactRole`. L'immense majorité des contacts importés via Apollo sont dans la base sans jamais générer d'opportunité.

---

## 2. Remplissage LeadSource — Opportunités

### 🔴 Problème critique : 93,5 % des opportunités n'ont pas de LeadSource
- **Total opps** : 4 008
- **LeadSource rempli** : 260 seulement (6,5 %)
- **LeadSource vide** : 3 748 (93,5 %)

| LeadSource (opps) | Nb | % |
|---|---|---|
| **(vide)** | 3 748 | 93,5 % |
| Formulaire web | 71 | 1,8 % |
| Compte démo | 28 | 0,7 % |
| ILF - 2015 | 19 | 0,5 % |
| Réseau XOS | 14 | 0,3 % |
| Mautic points | 14 | 0,3 % |
| Autres | 114 | 2,8 % |

### Opportunités gagnées par LeadSource
Sur les 1 349 opps gagnées, 1 266 (93,8 %) ont LeadSource vide. Les gagnées avec source remplie totalisent 19,9 M€ sur 22 sources, dont :
- Formulaire web : 21 gagnées, 202 k€
- ILF - 2015 : 8 gagnées, 74 k€
- Compte démo : 8 gagnées, 101 k€

**Impossible de faire un dashboard de performance par canal basé sur LeadSource des opps**. Le champ est quasi-inutilisé.

---

## 3. Usage réel des Campagnes

### Volume
- **203 campagnes** total, dont **71 actives**
- **141 planifiées**, 45 terminées, 17 en cours
- Types : 124 Séminaire/Conférence, 36 Publicité, 26 E-mail
- **34 277 membres** de campagne au total

### Qualité
- **134 campagnes** ont au moins 1 membre, **69 campagnes** (34 %) sont vides — des coquilles.
- **59,7 % des opportunités** (2 394 / 4 008) ont un `CampaignId` — **bien meilleur que LeadSource**.

### Top campagnes (par nombre d'opportunités)
| Campagne | Type | Opps |
|---|---|---|
| **Détecté/Signé hors action marketing** | Autre | 1 399 |
| Formulaire Site Internet | Autre | 283 |
| Partenaires | Partenaires | 63 |
| 950. Salon LT février 2023 | Séminaire | 40 |
| Mautic points | Autre | 29 |
| 4010. Salon LT janvier 2024 | Séminaire | 25 |
| 9060. Salon Learning Technologies 2026 | Publicité | 23 |

### Top campagnes (par membres)
| Campagne | Membres | Active |
|---|---|---|
| 700. Grands Comptes Importés dans SF | 4 122 | Oui |
| ILF2014 | 2 967 | Non |
| Conference201510 | 1 745 | Non |
| 550. Participants Présentation Partenariat | 1 627 | Non |

### Analyse
La campagne **"Détecté/Signé hors action marketing"** capte 35 % de toutes les opps (1 399 / 4 008) — c'est un fourre-tout. Les autres campagnes significatives sont les salons (LT, SRH) et les formulaires web.

**Le `CampaignId` est le meilleur candidat pour le suivi de canal** sur les opportunités (59,7 % de remplissage vs 6,5 % pour LeadSource), à condition de filtrer/normaliser les noms de campagnes.

---

## 4. Étapes amont des opportunités

### Pipeline d'étapes Salesforce (ordre réel)
| Ordre | Étape | Probabilité | Type |
|---|---|---|---|
| 1 | Projet identifié | 10 % | Amont |
| 2 | XOS recommandé | 15 % | Amont |
| 3 | Projet qualifié / AO reçu | 20 % | Amont |
| 4 | Proposition envoyée | 25 % | Qualifiée |
| 5 | XOS short-listé | 40 % | Qualifiée |
| 6 | Nego technique engagée | 50 % | Qualifiée |
| 7 | Négo financière engagée | 70 % | Qualifiée |
| 8 | OK de principe | 90 % | Qualifiée |
| 9 | Fermée / Gagnée | 100 % | Close |
| 10 | Fermée / Perdue | 0 % | Close |
| 11 | Suspect enlisé | 0 % | Open (poubelle) |

### Distribution actuelle (opps ouvertes)
| Étape | Nb | Montant | % open |
|---|---|---|---|
| Suspect enlisé | 197 | 3,95 M€ | 42,5 % |
| Négo financière engagée | 117 | 1,92 M€ | 25,3 % |
| Projet identifié | 70 | 868 k€ | 15,1 % |
| XOS recommandé | 38 | 893 k€ | 8,2 % |
| Projet qualifié / AO reçu | 21 | 295 k€ | 4,5 % |
| Proposition envoyée | 11 | 325 k€ | 2,4 % |
| XOS short-listé | 7 | 142 k€ | 1,5 % |
| Nego technique engagée | 1 | 6,9 k€ | 0,2 % |
| OK de principe | 1 | 6,5 k€ | 0,2 % |
| **Total open** | **463** | **8,40 M€** | |

### Stagnation (LastStageChangeDate)
Données limitées car le champ est peu rempli sur les opps ouvertes :
- **Suspect enlisé** : 196 opps, médiane **570 jours**, P90 = 1 105 jours, max = 3 951 jours
- **Projet identifié** : 2 opps avec la date, 614 jours en moyenne
- Autres étapes : 1-3 opps seulement avec la date renseignée

### Transitions (12 derniers mois, OpportunityHistory)
| Étape cible | Entrées 12 mois |
|---|---|
| Fermée / Perdue | 361 |
| XOS recommandé | 288 |
| Projet identifié | 279 |
| Négo financière engagée | 203 |
| Projet qualifié / AO reçu | 157 |
| Fermée / Gagnée | 108 |
| Suspect enlisé | 92 |
| Proposition envoyée | 75 |

### Création vs gain (mensuel 2024–2026)
Environ 25 opps créées/mois en moyenne, 9 gagnées/mois. Pas de saisonnalité évidente.

---

## 5. Proposition : Définition de l'entonnoir prospection

### Définitions retenues

L'entonnoir est construit sur 5 niveaux, tous mesurés **par période glissante** (semaine, mois, trimestre au choix de l'UI) :

| Niveau | Définition | Source |
|---|---|---|
| **1. Contacts créés** | Contacts dont `CreatedDate` est dans la période. Exclure les imports Apollo en masse (>100 contacts/mois par propriétaire) pour ne pas fausser l'entonnoir. | `Contact.CreatedDate` |
| **2. Contacts actifs** | Contacts du niveau 1 qui ont au moins 1 `OpportunityContactRole` (sur une opp créée dans le trimestre qui suit la création du contact). Temps de latence admis : 90 jours. | `OpportunityContactRole` |
| **3. Opps en étapes amont** | Opportunités créées dans la période ET encore en étapes amont (`Projet identifié`, `XOS recommandé`, `Projet qualifié / AO reçu`) **ou** passées par ces étapes dans la période (via `OpportunityHistory`). | `Opportunity.StageName` + `OpportunityHistory` |
| **4. Opps qualifiées** | Opportunités créées dans la période (ou passées en étapes qualifiées dans la période). Étapes qualifiées = `Proposition envoyée` à `OK de principe` inclus. **Suspect enlisé exclu** (c'est une poubelle, pas une qualification). | `Opportunity.StageName` + `OpportunityHistory` |
| **5. Opps gagnées** | Opportunités passées en `Fermée / Gagnée` dans la période (`CloseDate` dans la période). | `Opportunity.IsWon = true AND CloseDate` |

### Taux de conversion
- **Taux de prospection** = Niveau 2 / Niveau 1 : contacts qui génèrent une opp
- **Taux de qualification** = Niveau 4 / Niveau 3 : opps amont qui deviennent qualifiées
- **Taux de closing prospection** = Niveau 5 / Niveau 3 : opps créées en amont qui finissent gagnées

### Filtrage Apollo
La base de contacts est massivement gonflée par les imports Apollo (25 700 contacts, 64 %). Pour que l'entonnoir soit lisible, l'UI proposera un toggle **"Inclure imports Apollo"** (désactivé par défaut), avec un seuil paramétrable (par défaut : >500 contacts/mois par propriétaire = import). Ce seuil sera stocké dans `settings`.

### Segmentation par canal
Étant donné que **LeadSource est vide à 93,5 % sur les opps**, la segmentation par canal se fera sur **`CampaignId`** (rempli à 59,7 %).

- Mapping campagne → canal : regroupement manuel/maintenu des campagnes en canaux (Salons, Web, Partenaires, Hors marketing…). Une table de mapping `campaign_channels` sera stockée dans `settings` (jsonb).
- La campagne fourre-tout "Détecté/Signé hors action marketing" (1 399 opps) est traitée comme le canal "Direct/Hors marketing".
- Les opps sans `CampaignId` (40,3 %) sont classées "Non attribué".

### Bottleneck Detector (stagnation)
Basé sur `LastStageChangeDate` :
- Alerter quand une opp ouverte est dans la même étape depuis > X jours (seuil par étape, configurable dans `settings`).
- Seuils proposés par défaut :
  - Projet identifié > 30 jours
  - XOS recommandé > 30 jours
  - Projet qualifié / AO reçu > 60 jours
  - Proposition envoyée > 45 jours
  - XOS short-listé > 60 jours
  - Nego technique engagée > 90 jours
  - Négo financière engagée > 60 jours
  - OK de principe > 30 jours
  - Suspect enlisé : ignoré dans le detector (c'est le Cleaner qui le traite).

**⚠️ Limite actuelle** : `LastStageChangeDate` n'est renseigné que sur une poignée d'opps ouvertes (hors Suspect enlisé). Le detector sera peu utile tant que ce champ n'est pas mieux rempli. Une action corrective (workflow Salesforce ou rappel utilisateur) est hors périmètre de ce projet mais recommandée.

---

## 6. Synthèse pour l'implémentation (Lot 4.1 — `api/funnel.js`)

### Requêtes à coder
1. **Contacts créés par période** (avec/sans filtre Apollo)
2. **Contacts avec opp** (SOQL sur `OpportunityContactRole`, jointure temporelle)
3. **Opps créées/passées en étapes amont** (SOQL + `OpportunityHistory`)
4. **Opps créées/passées en étapes qualifiées**
5. **Opps gagnées par période** (CloseDate)
6. **Stagnation** : `LastStageChangeDate` par étape, avec seuils
7. **Performance par campagne** : jointure `CampaignId` → regroupement, agrégée par période

### Paramètres configurables (settings Supabase)
| Clé | Défaut | Description |
|---|---|---|
| `prospection.apollo_threshold` | 500 | Nb contacts/mois/proprio au-dessus duquel on considère un import |
| `prospection.exclude_apollo` | true | Filtre Apollo activé par défaut |
| `prospection.stagnation_days` | `{"Projet identifié":30, ...}` | Seuils de stagnation par étape |
| `prospection.campaign_channels` | `{}` | Mapping CampaignId/pattern → canal |

### Cache
`s-maxage=900` (15 min), comme spécifié dans le plan d'implémentation.

---

## 7. Données brutes

Le fichier JSON complet des résultats de l'audit est généré par `scripts/audit/audit_prospection.py` et sauvegardé dans `/tmp/xos-audit/audit_prospection.json`.

Pour rejouer l'audit :
```bash
python3 scripts/audit/audit_prospection.py
```
