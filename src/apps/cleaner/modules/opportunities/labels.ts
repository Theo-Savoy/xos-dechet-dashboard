import { REASON_LABELS } from './OpportunitiesTable';

/** Category labels stay aligned with the reason chips rendered by the table. */
export const CATEGORY_LABELS = REASON_LABELS;

export function normalizeFilterValue(value: string | null | undefined): string {
  return value?.trim() || '';
}

export function categoryLabelForValue(value: string): string {
  const normalized = normalizeFilterValue(value);
  return CATEGORY_LABELS[normalized] || normalized;
}

export function reasonLabelForRule(
  ruleId: string,
  anomalyLabel?: string | null,
): string {
  const normalizedRuleId = normalizeFilterValue(ruleId);
  if (CATEGORY_LABELS[normalizedRuleId])
    return CATEGORY_LABELS[normalizedRuleId];
  const fallback = normalizeFilterValue(anomalyLabel);
  return fallback && fallback !== normalizedRuleId ? fallback : 'Anomalie CRM';
}
