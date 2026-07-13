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
  | 'score'
  | 'days_overdue'
  | 'days_since_activity'
  | 'reasons'
  | 'salesforce_url'
  | 'actions'
  | 'evidence';

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

export const PER_PAGE = 25;
export const OPPORTUNITY_PAGE_SIZE = PER_PAGE;

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

function matchesNormalizedValue(
  values: string[],
  value: string | null | undefined,
): boolean {
  const normalized = value?.trim() || '';
  return values.some((candidate) => candidate.trim() === normalized);
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
  if (
    filters.owners.length &&
    !matchesNormalizedValue(filters.owners, item.owner)
  )
    return false;
  if (
    filters.categories.length &&
    !matchesNormalizedValue(filters.categories, item.category)
  )
    return false;
  if (
    filters.saleTypes.length &&
    !matchesNormalizedValue(filters.saleTypes, item.type_vente)
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

function dateTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const timestamp = dateOnly
    ? Date.UTC(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function daysSinceOpportunityDate(value: unknown): number | null {
  const timestamp = dateTimestamp(value);
  if (timestamp === null) return null;
  const today = new Date().toISOString().slice(0, 10);
  const todayTimestamp = dateTimestamp(today);
  if (todayTimestamp === null) return null;
  return Math.floor((todayTimestamp - timestamp) / 86400000);
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function comparable(
  item: OpportunityDiagnostic,
  key: OpportunitySortKey,
): string | number {
  const workspaceItem = item as OpportunityDiagnostic & {
    salesforce_url?: string | null;
  };
  let value: unknown;
  switch (key) {
    case 'days_overdue': {
      const days = daysSinceOpportunityDate(item.close_date);
      return days !== null && days > 0 ? days : -Infinity;
    }
    case 'days_since_activity': {
      const days = daysSinceOpportunityDate(item.last_activity);
      return days === null ? -Infinity : Math.max(days, 0);
    }
    case 'reasons':
      value = item.anomalies.map((anomaly) => anomaly.label || anomaly.ruleId);
      break;
    case 'salesforce_url':
      value = workspaceItem.salesforce_url;
      break;
    case 'actions':
      value = item.id;
      break;
    case 'evidence':
      value = item.anomalies.reduce(
        (count, anomaly) => count + anomaly.evidence.length,
        0,
      );
      break;
    default:
      value = item[key];
  }
  if (key === 'amount' || key === 'probability' || key === 'score') {
    const numeric = numericValue(value);
    if (numeric !== null) return numeric;
  }
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
  pageSize = PER_PAGE,
): { items: T[]; pageCount: number } {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  return {
    items: items.slice((safePage - 1) * size, safePage * size),
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
