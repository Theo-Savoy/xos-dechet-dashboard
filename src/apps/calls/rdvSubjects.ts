import type { SessionType } from "./types";

/** Titres Event Salesforce — Subject exact = `apiName`. */
export type RdvSubjectId =
  | "decouverte_prospect"
  | "detection_enjeux"
  | "soutenance"
  | "suivi_client"
  | "suivi_opportunite";

export type RdvSubjectDef = {
  id: RdvSubjectId;
  /** Affichage UI (sans emoji — le badge Lundi porte la hiérarchie). */
  label: string;
  /** Valeur Subject Salesforce. */
  apiName: string;
  /** Compte pour le KPI « Lundi ». */
  countsForLundi: boolean;
};

export const RDV_SUBJECTS: RdvSubjectDef[] = [
  {
    id: "decouverte_prospect",
    label: "Rdv découverte prospect",
    apiName: "Rdv découverte prospect",
    countsForLundi: true,
  },
  {
    id: "detection_enjeux",
    label: "Rdv détection enjeux client",
    apiName: "Rdv détection enjeux client",
    countsForLundi: true,
  },
  {
    id: "soutenance",
    label: "Soutenance",
    apiName: "Soutenance",
    countsForLundi: false,
  },
  {
    id: "suivi_client",
    label: "Point suivi client",
    apiName: "Point suivi client",
    countsForLundi: false,
  },
  {
    id: "suivi_opportunite",
    label: "Point suivi opportunité",
    apiName: "Point suivi opportunité",
    countsForLundi: false,
  },
];

const BY_SESSION: Record<SessionType, RdvSubjectId[]> = {
  prospection: ["decouverte_prospect", "detection_enjeux"],
  suivi_clients: ["suivi_client", "detection_enjeux", "soutenance"],
  suivi_opportunites: ["suivi_opportunite", "soutenance", "detection_enjeux"],
  relance: ["decouverte_prospect", "detection_enjeux", "suivi_client"],
};

export const RDV_DURATION_PRESETS = [15, 30, 45, 60, 90] as const;
export const RDV_DURATION_DEFAULT = 60;

export function rdvSubjectsForSession(sessionType: SessionType | string | null | undefined): RdvSubjectDef[] {
  const key = (sessionType && sessionType in BY_SESSION ? sessionType : "prospection") as SessionType;
  const ids = BY_SESSION[key];
  return ids
    .map((id) => RDV_SUBJECTS.find((s) => s.id === id))
    .filter((s): s is RdvSubjectDef => Boolean(s));
}

export function defaultRdvSubjectId(sessionType: SessionType | string | null | undefined): RdvSubjectId {
  return rdvSubjectsForSession(sessionType)[0]?.id ?? "decouverte_prospect";
}

export function rdvSubjectById(id: RdvSubjectId): RdvSubjectDef {
  return RDV_SUBJECTS.find((s) => s.id === id) ?? RDV_SUBJECTS[0];
}

export function isValidRdvApiName(apiName: string): boolean {
  return RDV_SUBJECTS.some((s) => s.apiName === apiName);
}
