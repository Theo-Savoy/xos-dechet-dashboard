import type { OpportunityDiagnostic } from './types';

export type OpportunitySortKey =
  | 'name'
  | 'account'
  | 'owner'
  | 'stage'
  | 'amount'
  | 'probability'
  | 'close_date'
  | 'last_activity'
  | 'type_vente'
  | 'category'
  | 'score';

export type OpportunityFilters = {
  search: string;
  owners: string[];
  categories: string[];
  saleTypes: string[];
  reasonFamilies: Record<string, string[]>;
  criticality?: 'critical' | 'warning' | 'healthy';
};

export type OpportunityWorkspaceState = {
  filters: OpportunityFilters;
  sort: { key: OpportunitySortKey; direction: 'asc' | 'desc' };
  page: number;
  selectedIds: Set<string>;
  activeView: 'cleaning' | 'analytics' | 'history';
};

export const OPPORTUNITY_PAGE_SIZE = 25;

export const REASON_FAMILY_LABELS = {
  closedate: '⏰ Close date dépassée',
  activity: "⚡ Pas d'activité",
  amount_missing: '💰 Absence de montant',
  prob_zero: '📉 Probabilité',
  owner_inactive: '👤 Propriétaire inactif / ancien',
  age: "📅 Ancienneté d'opportunité",
  stalled: '📌 Étape enlisée',
  incoherent_amount: '⚠️ Montant incohérent',
} as const;

export const REASON_FAMILY_ORDER = [
  'closedate',
  'activity',
  'amount_missing',
  'prob_zero',
  'owner_inactive',
  'age',
  'stalled',
  'incoherent_amount',
] as const;

export function createInitialOpportunityFilters(): OpportunityFilters {
  return {
    search: '',
    owners: [],
    categories: [],
    saleTypes: [],
    reasonFamilies: {},
  };
}

function text(value: unknown): string {
  return value == null ? '' : String(value).toLocaleLowerCase('fr-FR');
}

export function reasonFamilyKeyForRule(ruleId: string): string {
  if (ruleId.includes('close_date') || ruleId.includes('closedate'))
    return 'closedate';
  if (ruleId.includes('activity')) return 'activity';
  if (ruleId.includes('probability')) return 'prob_zero';
  if (ruleId.includes('owner')) return 'owner_inactive';
  if (ruleId.includes('age') || ruleId.includes('created_over')) return 'age';
  if (ruleId.includes('stage')) return 'stalled';
  if (
    ruleId.includes('amount_implausible') ||
    ruleId.includes('amount.implausible') ||
    ruleId.includes('incoherent_amount') ||
    ruleId.includes('amount.incoherent')
  )
    return 'incoherent_amount';
  if (ruleId.includes('amount_missing') || ruleId.includes('amount.missing'))
    return 'amount_missing';
  return 'other';
}

/**
 * Keep the coarse family names used by analytics navigation backwards
 * compatible while the cleaning selector uses the legacy's eight groups.
 */
export function reasonFamilyForRule(ruleId: string): string {
  const family = reasonFamilyKeyForRule(ruleId);
  if (family === 'owner_inactive') return 'owner';
  if (
    family === 'amount_missing' ||
    family === 'incoherent_amount' ||
    family === 'prob_zero'
  )
    return 'amount';
  if (family === 'closedate' || family === 'activity' || family === 'age')
    return 'timing';
  if (family === 'stalled') return 'stage';
  return 'other';
}

export function matchesOpportunityFilters(
  item: OpportunityDiagnostic,
  filters: OpportunityFilters,
): boolean {
  if (filters.criticality) {
    const criticality = item.anomalies.some(
      (anomaly) => anomaly.severity === 'critical',
    )
      ? 'critical'
      : item.anomalies.some((anomaly) => anomaly.severity === 'warning')
        ? 'warning'
        : 'healthy';
    if (criticality !== filters.criticality) return false;
  }
  const query = text(filters.search).trim();
  if (
    query &&
    ![item.name, item.account, item.owner, item.stage].some((value) =>
      text(value).includes(query),
    )
  )
    return false;
  if (filters.owners.length && !filters.owners.includes(item.owner || ''))
    return false;
  if (
    filters.categories.length &&
    !filters.categories.includes(item.category || '')
  )
    return false;
  if (
    filters.saleTypes.length &&
    !filters.saleTypes.includes(item.type_vente || '')
  )
    return false;

  return Object.entries(filters.reasonFamilies).every(([family, rules]) => {
    if (!rules.length) return true;
    return item.anomalies.some(
      (anomaly) =>
        (reasonFamilyKeyForRule(anomaly.ruleId) === family ||
          reasonFamilyForRule(anomaly.ruleId) === family) &&
        rules.includes(anomaly.ruleId),
    );
  });
}

function comparable(
  item: OpportunityDiagnostic,
  key: OpportunitySortKey,
): string | number {
  const value = item[key];
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : -Infinity;
  return text(value);
}

export function sortOpportunityItems(
  items: OpportunityDiagnostic[],
  sort: OpportunityWorkspaceState['sort'],
): OpportunityDiagnostic[] {
  return [...items].sort((left, right) => {
    const a = comparable(left, sort.key);
    const b = comparable(right, sort.key);
    const result =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), 'fr-FR');
    return (
      result * (sort.direction === 'asc' ? 1 : -1) ||
      left.id.localeCompare(right.id, 'fr-FR')
    );
  });
}

export function paginateOpportunityItems<T>(
  items: T[],
  page: number,
): { items: T[]; pageCount: number } {
  const pageCount = Math.max(
    1,
    Math.ceil(items.length / OPPORTUNITY_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(page, 1), pageCount);
  return {
    items: items.slice(
      (safePage - 1) * OPPORTUNITY_PAGE_SIZE,
      safePage * OPPORTUNITY_PAGE_SIZE,
    ),
    pageCount,
  };
}

export function retainFailedSelection(
  selectedIds: Set<string>,
  successfulIds: string[],
): Set<string> {
  const successful = new Set(successfulIds);
  return new Set([...selectedIds].filter((id) => !successful.has(id)));
}
