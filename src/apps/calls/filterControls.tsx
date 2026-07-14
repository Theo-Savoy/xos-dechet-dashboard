import { useId, useState } from "react";

/** Transforme une liste de valeurs simples en options {value, label}. */
export function asOptions<T extends string>(values: readonly T[]): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

/** Groupe de chips à sélection multiple — logique OU, visible pour l'utilisateur. */
export function ChipGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  const normalized = options;

  const toggle = (v: T) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <div className="calls-fb-control">
      <div className="calls-fb-control__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
        {value.length > 1 && <span className="calls-fb-or">OU</span>}
      </div>
      <div className="calls-chip-row">
        {normalized.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`calls-chip${value.includes(opt.value) ? " calls-chip--active" : ""}`}
            onClick={() => toggle(opt.value)}
            aria-pressed={value.includes(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Bascule à trois états : peu importe / oui / non. */
export function TriState({
  label,
  value,
  onChange,
  disabledValues = [],
  disabledReasons = {},
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
  disabledValues?: (boolean | null)[];
  disabledReasons?: Partial<Record<string, string>>;
}) {
  const opts: { value: boolean | null; label: string }[] = [
    { value: null, label: "Peu importe" },
    { value: true, label: "Oui" },
    { value: false, label: "Non" },
  ];

  return (
    <div className="calls-fb-control">
      <div className="calls-fb-control__label">
        <span>{label}</span>
      </div>
      <div className="calls-tristate">
        {opts.map((opt) => {
          const disabled = disabledValues.includes(opt.value);
          const key = String(opt.value);
          return (
            <button
              key={key}
              type="button"
              className={`calls-tristate__opt${value === opt.value ? " calls-tristate__opt--active" : ""}${disabled ? " calls-tristate__opt--disabled" : ""}`}
              onClick={() => !disabled && onChange(opt.value)}
              aria-pressed={value === opt.value}
              disabled={disabled}
              title={disabled ? disabledReasons[key] : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Liste searchable à cases à cocher pour picklists volumineuses. */
export type PicklistGroup<T extends string> = {
  id: string;
  label: string;
  values: readonly T[];
};

export function PicklistMultiSelect<T extends string>({
  label,
  hint,
  options,
  groups,
  value,
  onChange,
  searchPlaceholder = "Rechercher…",
}: {
  label: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  groups?: readonly PicklistGroup<T>[];
  value: T[];
  onChange: (next: T[]) => void;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!groups?.length) return new Set();
    const open = new Set<string>();
    for (const group of groups) {
      if (group.values.some((item) => value.includes(item))) open.add(group.id);
    }
    if (open.size === 0 && groups[0]) open.add(groups[0].id);
    return open;
  });
  const inputId = useId();
  const listId = useId();
  const normalizedQuery = query.trim().toLowerCase();
  const optionByValue = new Map(options.map((opt) => [opt.value, opt]));
  const optionValues = new Set(optionByValue.keys());
  const obsoleteValues = value.filter((item) => !optionValues.has(item));
  const selectedKnown = value.filter((item) => optionValues.has(item));

  const toggle = (v: T) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const remove = (v: T) => onChange(value.filter((item) => item !== v));

  const toggleFamily = (familyValues: readonly T[]) => {
    const allSelected = familyValues.every((item) => value.includes(item));
    if (allSelected) {
      onChange(value.filter((item) => !familyValues.includes(item)));
    } else {
      const next = new Set(value);
      for (const item of familyValues) next.add(item);
      onChange([...next]);
    }
  };

  const toggleExpanded = (groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const sortOptions = (items: { value: T; label: string }[]) => [
    ...items.filter((opt) => value.includes(opt.value)),
    ...items.filter((opt) => !value.includes(opt.value)),
  ];

  const filteredOptions = normalizedQuery
    ? options.filter((opt) => opt.label.toLowerCase().includes(normalizedQuery))
    : null;

  const renderOption = (opt: { value: T; label: string }) => {
    const checked = value.includes(opt.value);
    return (
      <label
        key={opt.value}
        className={`calls-checkbox calls-checkbox--tight calls-picklist__option${checked ? " calls-picklist__option--checked" : ""}`}
      >
        <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)} />
        <span className="calls-checkbox__label">{opt.label}</span>
      </label>
    );
  };

  const renderFamilyHead = (
    group: PicklistGroup<T>,
    {
      isOpen,
      showChevron,
      onToggleOpen,
    }: {
      isOpen?: boolean;
      showChevron: boolean;
      onToggleOpen?: () => void;
    },
  ) => {
    const selectedInFamily = group.values.filter((item) => value.includes(item)).length;
    const allSelected = selectedInFamily === group.values.length && group.values.length > 0;
    const someSelected = selectedInFamily > 0 && !allSelected;

    return (
      <div
        className={`calls-picklist__family-head${allSelected ? " calls-picklist__family-head--all" : ""}${someSelected ? " calls-picklist__family-head--partial" : ""}`}
      >
        <label className="calls-picklist__family-check">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={() => toggleFamily(group.values)}
            aria-label={
              allSelected
                ? `Désélectionner ${group.label}`
                : `Sélectionner toute la catégorie ${group.label}`
            }
          />
        </label>
        {showChevron && onToggleOpen ? (
          <button
            type="button"
            className="calls-picklist__family-toggle"
            aria-expanded={isOpen}
            onClick={onToggleOpen}
          >
            <span className="calls-picklist__family-chevron" aria-hidden="true">
              {isOpen ? "▾" : "▸"}
            </span>
            <span className="calls-picklist__family-label">{group.label}</span>
            <span className="calls-picklist__family-meta xos-numeric">
              {selectedInFamily > 0 ? `${selectedInFamily}/` : ""}
              {group.values.length}
            </span>
          </button>
        ) : (
          <div className="calls-picklist__family-toggle calls-picklist__family-toggle--static">
            <span className="calls-picklist__family-label">{group.label}</span>
            <span className="calls-picklist__family-meta xos-numeric">
              {selectedInFamily > 0 ? `${selectedInFamily}/` : ""}
              {group.values.length}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderGrouped = () => {
    if (!groups?.length) return null;
    return groups.map((group) => {
      const groupOptions = sortOptions(
        group.values
          .map((v) => optionByValue.get(v))
          .filter((opt): opt is { value: T; label: string } => Boolean(opt)),
      );
      if (normalizedQuery) {
        const visible = groupOptions.filter((opt) =>
          opt.label.toLowerCase().includes(normalizedQuery),
        );
        if (visible.length === 0) return null;
        return (
          <div key={group.id} className="calls-picklist__family calls-picklist__family--open">
            {renderFamilyHead(group, { showChevron: false })}
            <div className="calls-picklist__family-body">{visible.map(renderOption)}</div>
          </div>
        );
      }

      const isOpen = expanded.has(group.id);
      return (
        <div
          key={group.id}
          className={`calls-picklist__family${isOpen ? " calls-picklist__family--open" : ""}`}
        >
          {renderFamilyHead(group, {
            isOpen,
            showChevron: true,
            onToggleOpen: () => toggleExpanded(group.id),
          })}
          {isOpen && <div className="calls-picklist__family-body">{groupOptions.map(renderOption)}</div>}
        </div>
      );
    });
  };

  const renderFlat = () => {
    const visible = filteredOptions ?? sortOptions([...options]);
    return visible.map(renderOption);
  };

  const hasVisible =
    groups?.length && normalizedQuery
      ? groups.some((group) =>
          group.values.some((v) => {
            const label = optionByValue.get(v)?.label ?? v;
            return label.toLowerCase().includes(normalizedQuery);
          }),
        )
      : (filteredOptions ?? options).length > 0;

  return (
    <div className="calls-fb-control">
      <div className="calls-fb-control__label">
        <label htmlFor={inputId}>{label}</label>
        {hint && <small>{hint}</small>}
        {value.length > 0 && (
          <small className="calls-fb-control__count">
            {value.length} sélectionné{value.length > 1 ? "s" : ""}
          </small>
        )}
        {value.length > 1 && <span className="calls-fb-or">OU</span>}
      </div>

      {(selectedKnown.length > 0 || obsoleteValues.length > 0) && (
        <div className="calls-chip-row calls-picklist__selected">
          {selectedKnown.map((item) => (
            <span key={item} className="calls-chip calls-chip--active">
              {optionByValue.get(item)?.label ?? item}
              <button
                type="button"
                className="calls-chip__remove"
                aria-label={`Retirer ${item}`}
                onClick={() => remove(item)}
              >
                ×
              </button>
            </span>
          ))}
          {obsoleteValues.map((item) => (
            <span key={item} className="calls-chip calls-chip--active calls-chip--obsolete">
              {item}
              <small> (obsolète)</small>
              <button
                type="button"
                className="calls-chip__remove"
                aria-label={`Retirer ${item}`}
                onClick={() => remove(item)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="calls-picklist-panel">
        <div className="calls-picklist-panel__toolbar">
          <input
            id={inputId}
            type="search"
            className="calls-input calls-picklist__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={label}
            aria-controls={listId}
          />
          {value.length > 0 && (
            <button
              type="button"
              className="calls-picklist__clear"
              onClick={() => onChange([])}
            >
              Tout effacer
            </button>
          )}
        </div>
        <div id={listId} className="calls-picklist" role="group" aria-label={label}>
          {groups?.length ? renderGrouped() : renderFlat()}
          {!hasVisible && <p className="calls-picklist__empty">Aucun résultat.</p>}
        </div>
      </div>
    </div>
  );
}
