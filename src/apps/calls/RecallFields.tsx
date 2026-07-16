import { RECALL_ELIGIBLE_RESULTATS, type ResultatCall } from "../../crm";
import { DatePicker } from "./formControls";
import { todayParisIso } from "./formControls.helpers";
import { RECALL_PRESETS } from "./RecallFields.helpers";

function addDaysIso(days: number): string {
  const [y, m, d] = todayParisIso().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function RecallFields({
  resultat,
  scheduleRecall,
  onScheduleRecallChange,
  recallAt,
  onRecallAtChange,
  onDefaultRecallDaysChange,
}: {
  resultat: ResultatCall;
  scheduleRecall: boolean;
  onScheduleRecallChange: (value: boolean) => void;
  recallAt: string;
  onRecallAtChange: (value: string) => void;
  onDefaultRecallDaysChange: (days: number) => void;
}) {
  if (!RECALL_ELIGIBLE_RESULTATS.includes(resultat)) return null;

  const activePreset = RECALL_PRESETS.find((preset) => addDaysIso(preset.days) === recallAt)?.days;
  const customActive = activePreset == null;

  const pickPreset = (days: number) => {
    onDefaultRecallDaysChange(days);
    onRecallAtChange(addDaysIso(days));
  };

  return (
    <div className="calls-recall" role="group" aria-label="Rappel">
      <div className="calls-recall__head">
        <p className="calls-recall__title">Rappel</p>
      </div>
      <label className="calls-checkbox calls-checkbox--tight">
        <input
          type="checkbox"
          checked={scheduleRecall}
          onChange={(e) => onScheduleRecallChange(e.target.checked)}
          aria-label="Planifier un rappel"
        />
        <span aria-hidden="true">Planifier un rappel</span>
        <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">R</kbd>
      </label>
      {scheduleRecall ? (
        <div className="calls-recall__track" role="group" aria-label="Choisir la date de rappel">
          <div className="calls-recall__presets" role="group" aria-label="Délai rapide">
            {RECALL_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={`calls-recall__chip${activePreset === preset.days ? " calls-recall__chip--active" : ""}`}
                aria-pressed={activePreset === preset.days}
                aria-label={preset.label}
                title={`⇧${preset.shiftDigit}`}
                onClick={() => pickPreset(preset.days)}
              >
                <span aria-hidden="true">{preset.label}</span>
                <kbd className="calls-kbd calls-kbd--inline" aria-hidden="true">
                  ⇧{preset.shiftDigit}
                </kbd>
              </button>
            ))}
          </div>
          <span className="calls-recall__or" aria-hidden="true">ou</span>
          <DatePicker
            compact
            label="Choisir une date"
            value={recallAt}
            onChange={onRecallAtChange}
            triggerClassName={`calls-recall__chip calls-recall__chip--date${customActive ? " calls-recall__chip--active" : ""}`}
          />
        </div>
      ) : (
        <p className="calls-muted calls-recall__skip-hint">
          Pas de rappel cette fois — le contact reste appelable (contrairement au NPA).
        </p>
      )}
    </div>
  );
}
