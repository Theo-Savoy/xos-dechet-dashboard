import { useCallback, useEffect, useRef, useState } from "react";
import { Button, GlassCard } from "../../components/ui";
import { markComboDemoSeen } from "./comboKeyboard";
import type { ComboSoundGroup } from "./comboSoundPrefs";
import { useComboOverlay } from "./comboOverlay";
import { playComboSound, unlockComboAudio, type SoundKind } from "./comboSounds";

type DemoBeat = {
  at: number;
  title: string;
  body: string;
  sound: SoundKind;
  group?: ComboSoundGroup;
  chip?: string;
};

const BEATS: DemoBeat[] = [
  { at: 0, title: "Combo", body: "Prospection au rythme du clavier.", sound: "demo" },
  { at: 3_000, title: "1", body: "Résultat — Appel non décroché", sound: "result-pick", chip: "Non décroché" },
  { at: 7_500, title: "⇧3", body: "Rappel dans 3 jours", sound: "recall", group: "navigation", chip: "+3 j" },
  { at: 13_000, title: "⌘↵", body: "Loggué · contact suivant", sound: "success" },
  { at: 17_000, title: "⌘K · ?", body: "Toutes les actions, toujours sous la main.", sound: "whoosh" },
];

type ComboOnboardingDemoProps = {
  open: boolean;
  onClose: () => void;
};

const DEMO_MS = 22_000;

export function ComboOnboardingDemo({ open, onClose }: ComboOnboardingDemoProps) {
  const [elapsed, setElapsed] = useState(0);
  const [played, setPlayed] = useState<Set<number>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const finish = useCallback(
    (skip: boolean) => {
      markComboDemoSeen();
      if (!skip) playComboSound("success");
      onClose();
    },
    [onClose],
  );

  useComboOverlay(open, rootRef, () => finish(true));

  useEffect(() => {
    if (!open) return;
    setElapsed(0);
    setPlayed(new Set());
    void unlockComboAudio();
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      setElapsed(performance.now() - started);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const [index, beat] of BEATS.entries()) {
      if (elapsed < beat.at || played.has(index)) continue;
      setPlayed((prev) => new Set(prev).add(index));
      playComboSound(beat.sound, beat.group ? { group: beat.group } : undefined);
    }
    if (elapsed > DEMO_MS) {
      finish(false);
    }
  }, [elapsed, open, finish, played]);

  if (!open) return null;

  const current = [...BEATS].reverse().find((beat) => elapsed >= beat.at) ?? BEATS[0];
  const progress = Math.min(1, elapsed / DEMO_MS);

  return (
    <div ref={rootRef} className="calls-demo" role="dialog" aria-modal="true" aria-label="Démo Combo">
      <div className="calls-demo__stage">
        <GlassCard className="calls-demo__card">
          <p className="calls-demo__brand">Combo</p>
          <div className="calls-demo__key" aria-hidden="true">
            {current.title}
          </div>
          <h3>{current.body}</h3>
          {current.chip && <span className="calls-demo__chip">{current.chip}</span>}
          <div className="calls-demo__mock" aria-hidden="true">
            <div className="calls-demo__mock-row">
              <span className={elapsed >= 3_000 ? "is-on" : undefined}>Non décroché</span>
              <span className={elapsed >= 7_500 ? "is-on" : undefined}>+3 j</span>
            </div>
            <div className={`calls-demo__toast${elapsed >= 13_000 ? " is-on" : ""}`}>Loggué · rappel +3 j</div>
          </div>
          <div className="calls-demo__progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="calls-demo__actions">
            <Button variant="secondary" onClick={() => finish(true)}>
              Passer
            </Button>
            <Button onClick={() => finish(false)}>C&apos;est parti</Button>
          </div>
          <p className="calls-muted calls-demo__hint">Esc pour passer · rejouable via ⌘K</p>
        </GlassCard>
      </div>
    </div>
  );
}
