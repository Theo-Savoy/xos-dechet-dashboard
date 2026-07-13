import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './ui.css';

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  group?: string;
};

type SelectBaseProps<T extends string = string> = {
  label?: string;
  options: readonly SelectOption<T>[];
  'aria-label'?: string;
  'aria-haspopup'?: 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid';
  'aria-controls'?: string;
  className?: string;
  renderValue?: (selectedOptions: readonly SelectOption<T>[]) => ReactNode;
};

export type SelectSingleProps<T extends string = string> =
  SelectBaseProps<T> & {
    value: T;
    onChange: (value: T) => void;
    multi?: false;
  };

export type SelectMultiProps<T extends string = string> = SelectBaseProps<T> & {
  value: readonly T[];
  onChange: (value: T[]) => void;
  multi: true;
};

type SelectProps<T extends string = string> =
  SelectSingleProps<T> | SelectMultiProps<T>;

/** Liste déroulante glassmorphism réutilisable dans les apps X OS. */
export function Select<T extends string = string>(
  props: SelectSingleProps<T>,
): ReactNode;
export function Select<T extends string = string>(
  props: SelectMultiProps<T>,
): ReactNode;
export function Select<T extends string = string>({
  label,
  options,
  className = '',
  renderValue,
  'aria-label': ariaLabel,
  'aria-haspopup': ariaHasPopup,
  'aria-controls': ariaControls,
  ...selectionProps
}: SelectProps<T>): ReactNode {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedValues: readonly T[] = selectionProps.multi
    ? selectionProps.value
    : [selectionProps.value];
  const selectedOptions = options.filter((option) =>
    selectedValues.includes(option.value),
  );
  const selected = selectedOptions[0] || options[0];
  const triggerLabel = renderValue
    ? renderValue(selectedOptions)
    : selectionProps.multi
      ? selectedOptions.length
        ? selectedOptions.map((option) => option.label).join(', ')
        : '—'
      : selected?.label || '—';

  const selectOption = (value: T) => {
    if (selectionProps.multi) {
      const next = selectionProps.value.includes(value)
        ? selectionProps.value.filter(
            (selectedValue) => selectedValue !== value,
          )
        : [...selectionProps.value, value];
      selectionProps.onChange(next);
      return;
    }
    selectionProps.onChange(value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className={`xos-select ${open ? 'xos-select--open' : ''} ${className}`.trim()}
      ref={rootRef}
    >
      {label && <span className="xos-select__label">{label}</span>}
      <button
        type="button"
        className="xos-select__trigger"
        aria-label={ariaLabel || label}
        aria-haspopup={ariaHasPopup || 'listbox'}
        aria-expanded={open}
        aria-controls={ariaControls || listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{triggerLabel}</span>
        <span className="xos-select__chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={ariaControls || listId}
          className="xos-select__menu"
          role="listbox"
          aria-label={ariaLabel || label}
        >
          {options.map((option, index) => {
            const active = selectedValues.includes(option.value);
            const groupHeading =
              option.group && options[index - 1]?.group !== option.group ? (
                <li className="xos-select__group" role="presentation">
                  {option.group}
                </li>
              ) : null;
            return (
              <Fragment key={option.value}>
                {groupHeading}
                <li
                  role={selectionProps.multi ? 'option' : undefined}
                  aria-selected={selectionProps.multi ? active : undefined}
                >
                  {selectionProps.multi ? (
                    <label
                      className={`xos-select__option xos-select__option--multi${active ? ' xos-select__option--active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        aria-label={option.label}
                        onChange={() => selectOption(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ) : (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`xos-select__option${active ? ' xos-select__option--active' : ''}`}
                      onClick={() => selectOption(option.value)}
                    >
                      {option.label}
                    </button>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
