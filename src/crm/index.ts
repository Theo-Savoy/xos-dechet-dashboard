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

export const TIER_VALUES = ["A", "B", "C", "D"] as const;
export type Tier = (typeof TIER_VALUES)[number];

/** Options pour plafonner la sélection de contacts par entreprise (null = pas de limite). */
export const MAX_PER_COMPANY_OPTIONS = [1, 2, 3, 5] as const;
export type MaxPerCompany = (typeof MAX_PER_COMPANY_OPTIONS)[number];

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
  { id: "responsable_rh", label: "Responsable RH" },
  { id: "developpement_rh", label: "Développement RH / compétences" },
  { id: "directeur_rh", label: "Directeur RH" },
  { id: "pedagogie", label: "Pédagogie / ingénierie pédagogique" },
  { id: "sirh", label: "SIRH" },
  { id: "recrutement", label: "Recrutement" },
  { id: "direction_generale", label: "Direction générale / dirigeant" },
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

/** Résultats qui comptent dans le pipe « décroché » du cockpit. */
export const PIPE_DECROCHE: ResultatCall[] = ["Appel décroché", "Appel argumenté", "RDV planifié"];

export const DEFAULT_RECALL_DAYS = 3;

export type FilterTree = {
  entreprise: {
    secteurs: Secteur[];
    effectifs: EffectifTranche[];
    type_client: TypeClient[];
    tiers: Tier[];
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
      tiers: [],
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function booleanOr(defaultValue: boolean, value: unknown): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function triStateOr(defaultValue: boolean | null, value: unknown): boolean | null {
  return typeof value === "boolean" ? value : value === null ? null : defaultValue;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nullablePositiveInt(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function exclureSiPlusDe(value: unknown): { appels: number; sur_jours: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { appels?: unknown; sur_jours?: unknown };
  const appels = nullablePositiveInt(raw.appels);
  const sur_jours = nullablePositiveInt(raw.sur_jours);
  return appels && sur_jours ? { appels, sur_jours } : null;
}

/** Merge a stored preset (possibly pre-v2.1) onto the current FilterTree defaults. */
export function normalizeFilterTree(raw: unknown): FilterTree {
  const defaults = emptyFilterTree();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const source = raw as Record<string, unknown>;
  const entreprise = (source.entreprise && typeof source.entreprise === "object" && !Array.isArray(source.entreprise)
    ? source.entreprise
    : {}) as Record<string, unknown>;
  const contact = (source.contact && typeof source.contact === "object" && !Array.isArray(source.contact)
    ? source.contact
    : {}) as Record<string, unknown>;
  const relance = (source.relance && typeof source.relance === "object" && !Array.isArray(source.relance)
    ? source.relance
    : {}) as Record<string, unknown>;

  return {
    entreprise: {
      secteurs: stringArray(entreprise.secteurs) as Secteur[],
      effectifs: stringArray(entreprise.effectifs) as EffectifTranche[],
      type_client: stringArray(entreprise.type_client) as TypeClient[],
      tiers: stringArray(entreprise.tiers) as Tier[],
      opp_ouverte: triStateOr(defaults.entreprise.opp_ouverte, entreprise.opp_ouverte),
      opp_perdue: triStateOr(defaults.entreprise.opp_perdue, entreprise.opp_perdue),
      compte_principal: nullableString(entreprise.compte_principal),
    },
    contact: {
      a_telephone: booleanOr(defaults.contact.a_telephone, contact.a_telephone),
      niveau_decision: stringArray(contact.niveau_decision) as NiveauDecision[],
      exclure_npa: booleanOr(defaults.contact.exclure_npa, contact.exclure_npa),
      fonctions: stringArray(contact.fonctions) as FonctionPresetId[],
    },
    relance: {
      jamais_appele: triStateOr(defaults.relance.jamais_appele, relance.jamais_appele),
      dernier_appel_avant_jours: nullablePositiveInt(relance.dernier_appel_avant_jours),
      dernier_appel_dans_jours: nullablePositiveInt(relance.dernier_appel_dans_jours),
      dernier_resultat: stringArray(relance.dernier_resultat) as ResultatCall[],
      exclure_si_plus_de: exclureSiPlusDe(relance.exclure_si_plus_de),
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
