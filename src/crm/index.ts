// Types partagés front — agnostiques du CRM sous-jacent (Salesforce = une implémentation).
// Aucun nom de champ SF ici : uniquement la forme métier de l'arbre de filtres et les
// valeurs de picklist nécessaires à l'UI (le mapping des noms de champs vit côté serveur).

export const EFFECTIF_TRANCHES = [
  "1 - 50",
  "51 - 250",
  "251 - 500",
  "501 - 1000",
  "1001 - 2000",
  "2001 - 4999",
  "5000 et plus",
] as const;
export type EffectifTranche = (typeof EFFECTIF_TRANCHES)[number];

export const TYPE_CLIENT_VALUES = ["Client inactif", "Client", "Prospect"] as const;
export type TypeClient = (typeof TYPE_CLIENT_VALUES)[number];

export const SECTEUR_VALUES = [
  "Secteur public",
  "Aéronautique et Défense",
  "Biens de consommation alimentaires",
  "Communication et Médias",
  "Distribution spécialisée",
  "Divertissement",
  "E-Commerce, VAD",
  "Editeur de logiciels",
  "Education - Formation",
  "Entité à but non lucratif",
  "Environnement",
  "Finance",
  "Grande distribution alimentaire",
  "Industrie de l'emballage",
  "Matériaux de construction et extraction d'autres matériaux (hors énergie)",
  "Messagerie, courrier",
  "Ordinateurs & Electronique grand public",
  "Portails, pure players Internet",
  "Relation Client",
  "Services aux entreprises ou aux collectivités",
  "Services de conseils",
  "Services informatiques",
  "Télévision, radio, cinéma",
  "Transports",
  "Publicité/Marketing/Relations publiques",
  "BTP / construction",
  "Chimie (fine et lourde) / plastique",
  "Agroalimentaire / agriculture",
  "Assurance / Réassurance / caisses de retraite",
  "Automobiles / équipementiers",
  "Banque / finance",
  "Construction mécanique / métallurgie / sidérurgie / machines-outils",
  "Culture & Loisirs",
  "Distribution BtoB",
  "Droguerie / parfumerie / hygiène / cosmétiques",
  "Energie",
  "Equipement de la maison / électroménager",
  "Equipement de la personne (vêtements, accessoires)",
  "Etablissements médicaux / centre de soins",
  "Immobilier / promotion immobilière",
  "Ingénierie / certifications et inspections techniques",
  "Luxe",
  "Matériels et composants électroniques / électriques / informatique",
  "Presse / édition / imprimerie",
  "Restauration collective / chaînes",
  "Santé / pharmacie / biotech",
  "Services à la personne / action sociale",
  "Services environnementaux / facility management",
  "Support, maintenance et logistique",
  "Télécommunications",
  "Tourisme / hôtellerie",
] as const;
export type Secteur = (typeof SECTEUR_VALUES)[number];

export const FONCTION_PRESETS = [
  { id: "responsable_formation", label: "Responsable formation" },
  { id: "directeur_formation", label: "Directeur formation" },
  { id: "digital_learning_manager", label: "Digital learning manager" },
  { id: "charge_formation", label: "Chargé de formation" },
] as const;
export type FonctionPresetId = (typeof FONCTION_PRESETS)[number]["id"];

/** Plafond SOQL quand l'utilisateur choisit « Pas de limite ». */
export const CONTACT_LIST_UNLIMITED = 2000;

export const CONTACT_LIMIT_OPTIONS = [50, 100, 200, 300, 400, 500, CONTACT_LIST_UNLIMITED] as const;
export type ContactLimit = (typeof CONTACT_LIMIT_OPTIONS)[number];

export const NIVEAU_DECISION_OPTIONS = [
  { value: "+", label: "Décideur (+)" },
  { value: "=", label: "Influenceur (=)" },
  { value: "-", label: "Non décideur (-)" },
] as const;
export type NiveauDecision = "+" | "=" | "-";

export const RESULTAT_CALL_VALUES = [
  "Appel non décroché",
  "Message répondeur",
  "Appel décroché",
  "Appel argumenté",
  "RDV planifié",
] as const;
export type ResultatCall = (typeof RESULTAT_CALL_VALUES)[number];

/** Défaut relance « follow-up » : les résultats qui justifient un rappel. */
export const RELANCE_DEFAULT_RESULTATS: ResultatCall[] = ["Appel non décroché", "Message répondeur"];

export type FilterTree = {
  entreprise: {
    secteurs: Secteur[];
    effectifs: EffectifTranche[];
    type_client: TypeClient[];
    opp_ouverte: boolean | null;
    opp_perdue: boolean | null;
    compte_principal: string | null;
  };
  contact: {
    a_telephone: boolean;
    niveau_decision: NiveauDecision[];
    exclure_npa: boolean;
    fonctions: FonctionPresetId[];
  };
  relance: {
    jamais_appele: boolean | null;
    dernier_appel_avant_jours: number | null;
    dernier_appel_dans_jours: number | null;
    dernier_resultat: ResultatCall[];
    exclure_si_plus_de: { appels: number; sur_jours: number } | null;
  };
};

export function emptyFilterTree(): FilterTree {
  return {
    entreprise: {
      secteurs: [],
      effectifs: [],
      type_client: [],
      opp_ouverte: null,
      opp_perdue: null,
      compte_principal: null,
    },
    contact: {
      a_telephone: true,
      niveau_decision: [],
      exclure_npa: true,
      fonctions: [],
    },
    relance: {
      jamais_appele: null,
      dernier_appel_avant_jours: null,
      dernier_appel_dans_jours: null,
      dernier_resultat: [],
      exclure_si_plus_de: null,
    },
  };
}

export type DedupEntry = { sf_contact_id: string; in_session_of: string };

export type CallTargetPreset = {
  id: number;
  name: string;
  filters: FilterTree;
  shared: boolean;
  owner: string;
};
