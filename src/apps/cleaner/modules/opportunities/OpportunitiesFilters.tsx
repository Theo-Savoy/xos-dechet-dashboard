import { useMemo, useState } from 'react';
import type { OpportunityWorkspaceItem } from './api';
import {
  reasonFamilyKeyForRule,
  REASON_FAMILY_LABELS,
  REASON_FAMILY_ORDER,
  type OpportunityFilters,
} from './filterState';

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
      items
        .map((item) => item[key])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'fr-FR'));
}

export function OpportunitiesFilters({
  items,
  filters,
  onChange,
  onReset,
  showTreated = false,
  onToggleTreated,
}: OpportunitiesFiltersProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const reasons = useMemo(() => {
    const grouped = new Map<string, Map<string, string>>();
    items.forEach((item) =>
      item.anomalies.forEach((anomaly) => {
        const family = reasonFamilyKeyForRule(anomaly.ruleId);
        if (!grouped.has(family)) grouped.set(family, new Map());
        grouped.get(family)?.set(anomaly.ruleId, anomaly.label);
      }),
    );
    return grouped;
  }, [items]);

  const selectedReasonIds = Object.values(filters.reasonFamilies).flat();
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
  const toggleReason = (family: string, ruleId: string) => {
    const current = filters.reasonFamilies[family] || [];
    const next = current.includes(ruleId)
      ? current.filter((value) => value !== ruleId)
      : [...current, ruleId];
    const reasonFamilies = { ...filters.reasonFamilies };
    if (next.length) reasonFamilies[family] = next;
    else delete reasonFamilies[family];
    onChange({ ...filters, reasonFamilies });
  };

  const groupedReasons = [
    ...REASON_FAMILY_ORDER,
    ...[...reasons.keys()].filter(
      (family) =>
        !REASON_FAMILY_ORDER.includes(
          family as (typeof REASON_FAMILY_ORDER)[number],
        ),
    ),
  ];

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
      <label className="cleaner-opportunities__filter-field">
        <span>Owner</span>
        <select
          aria-label="Owner"
          value={filters.owners[0] || ''}
          onChange={(event) => selectSingle('owners', event.target.value)}
        >
          <option value="">Tous les owners</option>
          {options(items, 'owner').map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="cleaner-opportunities__filter-field">
        <span>Catégorie</span>
        <select
          aria-label="Catégorie"
          value={filters.categories[0] || ''}
          onChange={(event) => selectSingle('categories', event.target.value)}
        >
          <option value="">Toutes les catégories</option>
          {options(items, 'category').map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="cleaner-opportunities__filter-field">
        <span>Type de vente</span>
        <select
          aria-label="Type de vente"
          value={filters.saleTypes[0] || ''}
          onChange={(event) => selectSingle('saleTypes', event.target.value)}
        >
          <option value="">Tous les types</option>
          {options(items, 'type_vente').map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="cleaner-opportunities__filter-field cleaner-opportunities__reasons-filter">
        <span>Raisons</span>
        <button
          className="cleaner-opportunities__filter-trigger"
          type="button"
          aria-label="Raisons"
          aria-haspopup="true"
          aria-expanded={reasonsOpen}
          aria-controls="opportunity-reasons-menu"
          onClick={() => setReasonsOpen((open) => !open)}
        >
          <span>{reasonLabel}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        {reasonsOpen ? (
          <div
            className="cleaner-opportunities__reasons-menu"
            id="opportunity-reasons-menu"
            role="menu"
          >
            {groupedReasons.map((family) => {
              const familyReasons = reasons.get(family);
              if (!familyReasons?.size) return null;
              const label =
                REASON_FAMILY_LABELS[
                  family as keyof typeof REASON_FAMILY_LABELS
                ] || 'Autres anomalies';
              return (
                <fieldset key={family}>
                  <legend>{label}</legend>
                  {[...familyReasons.entries()]
                    .sort((left, right) =>
                      left[1].localeCompare(right[1], 'fr-FR'),
                    )
                    .map(([ruleId, label]) => (
                      <label key={ruleId}>
                        <input
                          type="checkbox"
                          checked={
                            filters.reasonFamilies[family]?.includes(ruleId) ||
                            false
                          }
                          onChange={() => toggleReason(family, ruleId)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                </fieldset>
              );
            })}
          </div>
        ) : null}
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
        onClick={() => {
          setReasonsOpen(false);
          onReset();
        }}
      >
        Réinitialiser
      </button>
    </section>
  );
}
