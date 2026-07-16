import type { PeriodKpis } from "./types";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

export type CallFunnelStage = {
  key: string;
  label: string;
  hint?: string | null;
  count: number;
  color: string;
};

const CONVERSION_COLORS = {
  calls: "#7d8aa3",
  decroche: "#5b8def",
  argumente: "var(--xos-accent)",
  rdv: "var(--xos-alert)",
} as const;

/** Stages de conversion Appels → Décroché → Argumenté → RDV (KPIs Combo). */
export function stagesFromPeriodKpis(kpis: PeriodKpis): CallFunnelStage[] {
  return [
    {
      key: "calls",
      label: "Appels",
      hint: null,
      count: kpis.calls,
      color: CONVERSION_COLORS.calls,
    },
    {
      key: "decroche",
      label: "Décroché",
      hint: kpis.calls > 0 ? percent.format(kpis.decroche / kpis.calls) : null,
      count: kpis.decroche,
      color: CONVERSION_COLORS.decroche,
    },
    {
      key: "argumente",
      label: "Argumenté",
      hint: kpis.decroche > 0 ? percent.format(kpis.argumente / kpis.decroche) : null,
      count: kpis.argumente,
      color: CONVERSION_COLORS.argumente,
    },
    {
      key: "rdv",
      label: "RDV",
      hint: kpis.argumente > 0 ? percent.format(kpis.rdv / kpis.argumente) : null,
      count: kpis.rdv,
      color: CONVERSION_COLORS.rdv,
    },
  ];
}
