import { useMemo } from 'react';
import { Select, type SelectOption } from '../../../../components/ui';
import type { OpportunityWorkspaceItem } from './api';
import {
  reasonFamilyKeyForRule,
  REASON_FAMILY_LABELS,
  REASON_FAMILY_ORDER,
  type OpportunityFilters,
} from './filterState';
import {
  categoryLabelForValue,
  normalizeFilterValue,
  reasonLabelForRule,
} from './labels';

type OpportunitiesFiltersProps = {
  items: OpportunityWorkspaceItem[];
  filters: OpportunityFilters;
  onChange: (filters: OpportunityFilters) => void;
  onReset: () => void;
  showTreated?: boolean;
  onToggleTreated?: () => void;
};

function options(
  items: OpportunityWorkspaceItem[],
  key: 'owner' | 'category' | 'type_vente',
): string[] {
  return [
    ...new Set(
      items.map((item) => normalizeFilterValue(item[key])).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'fr-FR'));
}

function selectOptions(
  values: string[],
  emptyLabel: string,
  labelForValue: (value: string) => string = (value) => value,
): SelectOption<string>[] {
  return [
    { value: '', label: emptyLabel },
    ...values.map((value) => ({
      value,
      label: labelForValue(value),
    })),
  ];
}

export function OpportunitiesFilters({
  items,
  filters,
  onChange,
  onReset,
  showTreated = false,
  onToggleTreated,
}: OpportunitiesFiltersProps) {
  const reasons = useMemo(() => {
    const grouped = new Map<string, Map<string, string>>();
    items.forEach((item) =>
      item.anomalies.forEach((anomaly) => {
        const family = reasonFamilyKeyForRule(anomaly.ruleId);
        if (!grouped.has(family)) grouped.set(family, new Map());
        grouped
          .get(family)
          ?.set(
            anomaly.ruleId,
            reasonLabelForRule(anomaly.ruleId, anomaly.label),
          );
      }),
    );
    return grouped;
  }, [items]);

  const ownerOptions = useMemo(
    () => selectOptions(options(items, 'owner'), 'Tous les owners'),
    [items],
  );
  const categoryOptions = useMemo(
    () =>
      selectOptions(
        options(items, 'category'),
        'Toutes les catégories',
        categoryLabelForValue,
      ),
    [items],
  );
  const saleTypeOptions = useMemo(
    () => selectOptions(options(items, 'type_vente'), 'Tous les types'),
    [items],
  );

  const selectedReasonIds = [
    ...new Set(Object.values(filters.reasonFamilies).flat()),
  ];
  const reasonLabel =
    selectedReasonIds.length === 0
      ? 'Toutes les raisons'
      : selectedReasonIds.length === 1
        ? [...reasons.values()]
            .flatMap((family) => [...family.entries()])
            .find(([ruleId]) => ruleId === selectedReasonIds[0])?.[1] ||
          '1 raison sélectionnée'
        : `${selectedReasonIds.length} raisons sélectionnées`;

  const selectSingle = (
    key: 'owners' | 'categories' | 'saleTypes',
    value: string,
  ) => onChange({ ...filters, [key]: value ? [value] : [] });

  const groupedReasons = [
    ...REASON_FAMILY_ORDER,
    ...[...reasons.keys()].filter(
      (family) =>
        !REASON_FAMILY_ORDER.includes(
          family as (typeof REASON_FAMILY_ORDER)[number],
        ),
    ),
  ];

  const reasonOptions = groupedReasons.flatMap((family) => {
    const familyReasons = reasons.get(family);
    if (!familyReasons?.size) return [];
    const group =
      REASON_FAMILY_LABELS[family as keyof typeof REASON_FAMILY_LABELS] ||
      'Autres anomalies';
    return [...familyReasons.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], 'fr-FR'))
      .map(([value, label]) => ({ value, label, group }));
  });

  const reasonFamilyByRule = new Map<string, string>();
  reasons.forEach((familyReasons, family) => {
    familyReasons.forEach((_label, ruleId) => {
      reasonFamilyByRule.set(ruleId, family);
    });
  });
  const selectReasons = (ruleIds: string[]) => {
    const reasonFamilies = ruleIds.reduce<Record<string, string[]>>(
      (families, ruleId) => {
        const family =
          reasonFamilyByRule.get(ruleId) || reasonFamilyKeyForRule(ruleId);
        families[family] = [...(families[family] || []), ruleId];
        return families;
      },
      {},
    );
    onChange({ ...filters, reasonFamilies });
  };

  return (
    <section
      className="cleaner-opportunities__filters"
      aria-label="Filtres des opportunités"
    >
      <label className="cleaner-opportunities__filter-field cleaner-opportunities__search">
        <span>Rechercher</span>
        <input
          aria-label="Rechercher"
          type="search"
          role="searchbox"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
          placeholder="Nom, compte, owner…"
        />
      </label>
      <div className="cleaner-opportunities__filter-field">
        <span>Owner</span>
        <Select
          aria-label="Owner"
          value={filters.owners[0] || ''}
          options={ownerOptions}
          onChange={(value) => selectSingle('owners', value)}
          className="cleaner-opportunities__filter-select"
        />
      </div>
      <div className="cleaner-opportunities__filter-field">
        <span>Catégorie</span>
        <Select
          aria-label="Catégorie"
          value={filters.categories[0] || ''}
          options={categoryOptions}
          onChange={(value) => selectSingle('categories', value)}
          className="cleaner-opportunities__filter-select"
        />
      </div>
      <div className="cleaner-opportunities__filter-field">
        <span>Type de vente</span>
        <Select
          aria-label="Type de vente"
          value={filters.saleTypes[0] || ''}
          options={saleTypeOptions}
          onChange={(value) => selectSingle('saleTypes', value)}
          className="cleaner-opportunities__filter-select"
        />
      </div>
      <div className="cleaner-opportunities__filter-field cleaner-opportunities__reasons-filter">
        <span>Raisons</span>
        <Select
          multi
          aria-label="Raisons"
          aria-haspopup="true"
          aria-controls="opportunity-reasons-menu"
          value={selectedReasonIds}
          options={reasonOptions}
          onChange={selectReasons}
          renderValue={() => reasonLabel}
          className="cleaner-opportunities__filter-select"
        />
      </div>
      <button
        className={`cleaner-opportunities__treated-toggle${showTreated ? ' is-active' : ''}`}
        type="button"
        aria-label="Traitées"
        aria-pressed={showTreated}
        onClick={onToggleTreated}
      >
        Traitées
      </button>
      <button
        className="cleaner-opportunities__filters-reset"
        type="button"
        onClick={onReset}
      >
        Réinitialiser
      </button>
    </section>
  );
}
