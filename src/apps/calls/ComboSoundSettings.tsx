import { Button } from "../../components/ui";
import {
  COMBO_SOUND_GROUP_HINTS,
  COMBO_SOUND_GROUP_LABELS,
  DEFAULT_SOUND_PREFS,
  LOG_ONLY_SOUND_PREFS,
  type ComboSoundGroup,
  type ComboSoundPrefs,
  writeSoundPrefs,
} from "./comboSoundPrefs";
import { playComboSound } from "./comboSounds";

const GROUP_ORDER: ComboSoundGroup[] = ["log", "rdv", "result", "navigation", "warn", "demo"];

type ComboSoundSettingsProps = {
  prefs: ComboSoundPrefs;
  onChange: (next: ComboSoundPrefs) => void;
  masterEnabled: boolean;
};

export function ComboSoundSettings({ prefs, onChange, masterEnabled }: ComboSoundSettingsProps) {
  const setGroup = (group: ComboSoundGroup, enabled: boolean) => {
    const next = { ...prefs, [group]: enabled };
    onChange(next);
    writeSoundPrefs(next);
    if (enabled && masterEnabled) {
      if (group === "result") playComboSound("result-pick");
      else if (group === "log") playComboSound("success");
      else if (group === "navigation") playComboSound("nav");
    }
  };

  const applyPreset = (preset: ComboSoundPrefs) => {
    onChange(preset);
    writeSoundPrefs(preset);
  };

  return (
    <div className="calls-sound-prefs">
      <div className="calls-sound-prefs__head">
        <h4>Sons</h4>
        <p className="calls-muted">
          {masterEnabled
            ? "Affinez par catégorie — le mute global reste dans la command bar."
            : "Sons coupés globalement — réactivez-les via la command bar (⌘K)."}
        </p>
      </div>
      <div className="calls-sound-prefs__presets">
        <Button
          type="button"
          variant="secondary"
          disabled={!masterEnabled}
          onClick={() => applyPreset(DEFAULT_SOUND_PREFS)}
        >
          Tout
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!masterEnabled}
          onClick={() => applyPreset(LOG_ONLY_SOUND_PREFS)}
        >
          Log uniquement
        </Button>
      </div>
      <ul className="calls-sound-prefs__list">
        {GROUP_ORDER.map((group) => (
          <li key={group}>
            <label className="calls-sound-prefs__row">
              <input
                type="checkbox"
                checked={masterEnabled && prefs[group]}
                disabled={!masterEnabled}
                onChange={(e) => setGroup(group, e.target.checked)}
              />
              <span className="calls-sound-prefs__copy">
                <span className="calls-sound-prefs__label">{COMBO_SOUND_GROUP_LABELS[group]}</span>
                <span className="calls-muted calls-sound-prefs__hint">{COMBO_SOUND_GROUP_HINTS[group]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
