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

/** Options affichées selon séance × type de compte (Prospect vs Client / Client inactif). */
const BY_SESSION_AND_ACCOUNT: Record<
  SessionType,
  { prospect: RdvSubjectId[]; client: RdvSubjectId[] }
> = {
  prospection: {
    prospect: ["decouverte_prospect"],
    client: ["detection_enjeux"],
  },
  relance: {
    prospect: ["decouverte_prospect"],
    client: ["detection_enjeux", "suivi_client"],
  },
  suivi_clients: {
    prospect: ["decouverte_prospect"],
    client: ["suivi_client", "detection_enjeux", "soutenance"],
  },
  suivi_opportunites: {
    prospect: ["suivi_opportunite", "soutenance"],
    client: ["suivi_opportunite", "soutenance", "detection_enjeux"],
  },
};

export const RDV_DURATION_PRESETS = [15, 30, 45, 60, 90] as const;
export const RDV_DURATION_DEFAULT = 60;

function sessionKey(sessionType: SessionType | string | null | undefined): SessionType {
  return (sessionType && sessionType in BY_SESSION ? sessionType : "prospection") as SessionType;
}

function subjectIdsForSessionAndAccount(
  sessionType: SessionType | string | null | undefined,
  accountCustomerType?: string | null,
): RdvSubjectId[] {
  const key = sessionKey(sessionType);
  if (accountCustomerType) {
    const scoped = BY_SESSION_AND_ACCOUNT[key];
    return isClientAccountType(accountCustomerType) ? scoped.client : scoped.prospect;
  }
  return BY_SESSION[key];
}

export function rdvSubjectsForSession(
  sessionType: SessionType | string | null | undefined,
  accountCustomerType?: string | null,
): RdvSubjectDef[] {
  const ids = subjectIdsForSessionAndAccount(sessionType, accountCustomerType);
  return ids
    .map((id) => RDV_SUBJECTS.find((s) => s.id === id))
    .filter((s): s is RdvSubjectDef => Boolean(s));
}

/** Type_de_client__c Salesforce (Account). */
export type AccountCustomerType = "Prospect" | "Client" | "Client inactif";

function isClientAccountType(type: string | null | undefined): boolean {
  return type === "Client" || type === "Client inactif";
}

/**
 * Motif par défaut : premier type disponible pour la séance et le type de compte.
 */
export function defaultRdvSubjectId(
  sessionType: SessionType | string | null | undefined,
  accountCustomerType?: string | null,
): RdvSubjectId {
  const subjects = rdvSubjectsForSession(sessionType, accountCustomerType);
  return subjects[0]?.id ?? "decouverte_prospect";
}

export function rdvSubjectById(id: RdvSubjectId): RdvSubjectDef {
  return RDV_SUBJECTS.find((s) => s.id === id) ?? RDV_SUBJECTS[0];
}

export function isValidRdvApiName(apiName: string): boolean {
  return RDV_SUBJECTS.some((s) => s.apiName === apiName);
}
