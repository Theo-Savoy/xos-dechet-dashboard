import type { ResultatCall } from "../../crm";
import { RESULTAT_OPTIONS } from "./types";

export function ResultButtons({
  value,
  onChange,
  disabledValues = [],
  onPick,
}: {
  value: ResultatCall;
  onChange: (value: ResultatCall) => void;
  disabledValues?: ResultatCall[];
  onPick?: () => void;
}) {
  return (
    <div className="calls-result-seg" role="group" aria-label="Résultat de l'appel">
      {RESULTAT_OPTIONS.map((opt, index) => {
        const disabled = disabledValues.includes(opt.value);
        const digit = String(index + 1);
        return (
          <button
            key={opt.value}
            type="button"
            className={`calls-result-seg__btn${value === opt.value ? " calls-result-seg__btn--active" : ""}`}
            aria-pressed={value === opt.value}
            disabled={disabled}
            title={disabled ? "Sélectionnez un seul contact pour planifier un RDV" : digit}
            onClick={() => {
              if (opt.value !== value) onPick?.();
              onChange(opt.value);
            }}
          >
            <span>{opt.label}</span>
            <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">{digit}</kbd>
          </button>
        );
      })}
    </div>
  );
}
