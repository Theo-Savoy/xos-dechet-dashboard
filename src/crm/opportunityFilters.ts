import type { FilterTree } from "./index";

/** Salesforce allows at most 2 IN/NOT IN subqueries per SOQL WHERE clause. */
export const SF_MAX_OPPORTUNITY_SEMI_JOINS = 2;

type EntrepriseOpp = Pick<FilterTree["entreprise"], "opp_ouverte" | "opp_perdue">;

/** Mirrors `filterByOpportunityAccounts` in api/_crm/salesforce.js — keep in sync. */
export function countOpportunitySemiJoins(entreprise: EntrepriseOpp): number {
  let count = 0;
  if (entreprise.opp_ouverte === true) count += 1;
  if (entreprise.opp_ouverte === false) count += 1;
  if (entreprise.opp_perdue === true) {
    count += 1;
    if (entreprise.opp_ouverte !== true && entreprise.opp_ouverte !== false) {
      count += 1;
    }
  }
  if (entreprise.opp_perdue === false) count += 1;
  return count;
}

export type OpportunityFilterGuidance = {
  semiJoinCount: number;
  atLimit: boolean;
  /** Short label for the active combination. */
  hint: string | null;
  /** Extra note when SF limits change the strict product spec. */
  note: string | null;
  /** Tri-state values that cannot be combined with the current selection. */
  disabled: {
    opp_ouverte: (boolean | null)[];
    opp_perdue: (boolean | null)[];
  };
  disabledReasons: Partial<Record<"opp_ouverte" | "opp_perdue", Partial<Record<string, string>>>>;
};

export function getOpportunityFilterGuidance(entreprise: EntrepriseOpp): OpportunityFilterGuidance {
  const { opp_ouverte, opp_perdue } = entreprise;
  const semiJoinCount = countOpportunitySemiJoins(entreprise);
  const atLimit = semiJoinCount >= SF_MAX_OPPORTUNITY_SEMI_JOINS;

  const disabled: OpportunityFilterGuidance["disabled"] = {
    opp_ouverte: [],
    opp_perdue: [],
  };
  const disabledReasons: OpportunityFilterGuidance["disabledReasons"] = {};

  let hint: string | null = null;
  let note: string | null = null;

  if (opp_perdue === true && opp_ouverte === true) {
    hint = "Comptes avec au moins une opportunité ouverte et au moins une opportunité perdue.";
  } else if (opp_perdue === true && opp_ouverte === false) {
    hint = "Comptes avec une opportunité perdue et aucune opportunité ouverte.";
  } else if (opp_perdue === true) {
    hint = "Comptes avec une opportunité perdue et aucune opportunité ouverte.";
  } else if (opp_perdue === false && opp_ouverte === true) {
    hint = "Comptes avec au moins une opportunité ouverte et sans opportunité perdue.";
  } else if (opp_perdue === false && opp_ouverte === false) {
    hint = "Comptes sans opportunité ouverte ni opportunité perdue.";
  } else if (opp_perdue === false) {
    hint = "Comptes sans opportunité au stade perdu.";
  } else if (opp_ouverte === true) {
    hint = "Comptes avec au moins une opportunité ouverte.";
  } else if (opp_ouverte === false) {
    hint = "Comptes sans opportunité ouverte.";
  }

  return {
    semiJoinCount,
    atLimit,
    hint,
    note,
    disabled,
    disabledReasons,
  };
}
