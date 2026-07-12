import { SECTEUR_VALUES, type Secteur } from "./secteurValues";

export type SecteurFamily = {
  id: string;
  label: string;
  secteurs: readonly Secteur[];
};

/**
 * Familles métier pour la picklist secteurs.
 * Principe : placer chaque secteur là où un commercial chercherait naturellement.
 */
export const SECTEUR_FAMILIES: SecteurFamily[] = [
  {
    id: "public",
    label: "Public, éducation & associatif",
    secteurs: [
      "Secteur public",
      "Education - Formation",
      "Entité à but non lucratif",
      "Services à la personne / action sociale",
    ],
  },
  {
    id: "finance",
    label: "Finance & assurance",
    secteurs: ["Banque / finance", "Assurance / Réassurance / caisses de retraite"],
  },
  {
    id: "industrie",
    label: "Industrie, BTP & énergie",
    secteurs: [
      "Aéronautique et Défense",
      "BTP / construction",
      "Chimie (fine et lourde) / plastique",
      "Automobiles / équipementiers",
      "Construction mécanique / métallurgie / sidérurgie / machines-outils",
      "Energie",
      "Environnement",
      "Industrie de l'emballage",
      "Matériaux de construction et extraction d'autres matériaux (hors énergie)",
    ],
  },
  {
    id: "tech",
    label: "Tech, digital & télécoms",
    secteurs: [
      "E-Commerce, VAD",
      "Editeur de logiciels",
      "Ordinateurs & Electronique grand public",
      "Portails, pure players Internet",
      "Services informatiques",
      "Matériels et composants électroniques / électriques / informatique",
      "Télécommunications",
    ],
  },
  {
    id: "distribution",
    label: "Distribution & retail",
    secteurs: [
      "Distribution spécialisée",
      "Grande distribution alimentaire",
      "Distribution BtoB",
      "Droguerie / parfumerie / hygiène / cosmétiques",
      "Equipement de la maison / électroménager",
      "Equipement de la personne (vêtements, accessoires)",
    ],
  },
  {
    id: "agro",
    label: "Agroalimentaire",
    secteurs: [
      "Biens de consommation alimentaires",
      "Agroalimentaire / agriculture",
      "Restauration collective / chaînes",
    ],
  },
  {
    id: "medias",
    label: "Médias, communication & marketing",
    secteurs: [
      "Communication et Médias",
      "Télévision, radio, cinéma",
      "Publicité/Marketing/Relations publiques",
      "Presse / édition / imprimerie",
    ],
  },
  {
    id: "services",
    label: "Services & conseil",
    secteurs: [
      "Services aux entreprises ou aux collectivités",
      "Services de conseils",
      "Relation Client",
      "Ingénierie / certifications et inspections techniques",
      "Services environnementaux / facility management",
    ],
  },
  {
    id: "sante",
    label: "Santé & médical",
    secteurs: ["Etablissements médicaux / centre de soins", "Santé / pharmacie / biotech"],
  },
  {
    id: "transport",
    label: "Transport & logistique",
    secteurs: ["Messagerie, courrier", "Transports", "Support, maintenance et logistique"],
  },
  {
    id: "loisirs",
    label: "Tourisme, loisirs & luxe",
    secteurs: ["Divertissement", "Culture & Loisirs", "Luxe", "Tourisme / hôtellerie"],
  },
  {
    id: "immobilier",
    label: "Immobilier",
    secteurs: ["Immobilier / promotion immobilière"],
  },
];

const covered = new Set(SECTEUR_FAMILIES.flatMap((family) => family.secteurs));
if (covered.size !== SECTEUR_VALUES.length || SECTEUR_VALUES.some((s) => !covered.has(s))) {
  throw new Error("SECTEUR_FAMILIES must cover every SECTEUR_VALUES entry exactly once");
}

export function secteurFamilyByValue(value: Secteur): SecteurFamily | undefined {
  return SECTEUR_FAMILIES.find((family) => family.secteurs.includes(value));
}
