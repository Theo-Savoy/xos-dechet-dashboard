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
    secteurs: string[];
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
  };
  relance: {
    jamais_appele: boolean | null;
    dernier_appel_avant_jours: number | null;
    dernier_appel_dans_jours: number | null;
    dernier_resultat: ResultatCall[];
    exclure_si_plus_de: { appels: number; sur_jours: number } | null;
    duree_min_sec: number | null;
    duree_max_sec: number | null;
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
    },
    relance: {
      jamais_appele: null,
      dernier_appel_avant_jours: null,
      dernier_appel_dans_jours: null,
      dernier_resultat: [],
      exclure_si_plus_de: null,
      duree_min_sec: null,
      duree_max_sec: null,
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
