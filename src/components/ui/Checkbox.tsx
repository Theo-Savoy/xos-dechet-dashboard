import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import './ui.css';

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  'aria-label'?: string;
  className?: string;
};

/** Checkbox glassmorphism réutilisable dans les apps X OS. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  indeterminate = false,
  'aria-label': ariaLabel,
  className = '',
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const classes = ['xos-checkbox', className].filter(Boolean).join(' ');

  return (
    <label className={classes}>
      <input
        ref={inputRef}
        className="xos-checkbox__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label !== undefined ? (
        <span className="xos-checkbox__label">{label}</span>
      ) : null}
    </label>
  );
}
