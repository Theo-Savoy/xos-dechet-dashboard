import { useId, useState, type KeyboardEvent } from "react";

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
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
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
        {opts.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={`calls-tristate__opt${value === opt.value ? " calls-tristate__opt--active" : ""}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Liste searchable à cases à cocher pour picklists volumineuses. */
export function PicklistMultiSelect<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  searchPlaceholder = "Rechercher…",
}: {
  label: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const listId = useId();
  const normalizedQuery = query.trim().toLowerCase();
  const optionByValue = new Map(options.map((opt) => [opt.value, opt]));
  const optionValues = new Set(optionByValue.keys());
  const obsoleteValues = value.filter((item) => !optionValues.has(item));
  const selectedKnown = value.filter((item) => optionValues.has(item));
  const visible = normalizedQuery
    ? options.filter((opt) => opt.label.toLowerCase().includes(normalizedQuery))
    : [
        ...options.filter((opt) => value.includes(opt.value)),
        ...options.filter((opt) => !value.includes(opt.value)),
      ];

  const toggle = (v: T) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const remove = (v: T) => onChange(value.filter((item) => item !== v));

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
          {visible.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`calls-checkbox calls-checkbox--tight calls-picklist__option${checked ? " calls-picklist__option--checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                />
                <span className="calls-checkbox__label">{opt.label}</span>
              </label>
            );
          })}
          {visible.length === 0 && <p className="calls-picklist__empty">Aucun résultat.</p>}
        </div>
      </div>
    </div>
  );
}

/** Saisie libre de tags (ex : secteurs) — Entrée ou virgule pour ajouter, croix pour retirer. */
export function TagInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputId = useId();

  const commit = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="calls-fb-control">
      <div className="calls-fb-control__label">
        <label htmlFor={inputId}>{label}</label>
        {hint && <small>{hint}</small>}
        {value.length > 1 && <span className="calls-fb-or">OU</span>}
      </div>
      <div className="calls-taginput">
        {value.map((tag) => (
          <span key={tag} className="calls-chip calls-chip--active">
            {tag}
            <button
              type="button"
              className="calls-chip__remove"
              aria-label={`Retirer ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          className="calls-taginput__field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : ""}
        />
      </div>
    </div>
  );
}
