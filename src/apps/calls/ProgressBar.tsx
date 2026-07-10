type ProgressBarProps = {
  called: number;
  total: number;
  label?: string;
};

export function ProgressBar({ called, total, label }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((called / total) * 100) : 0;

  return (
    <div className="calls-progress" aria-label={label ?? `Progression ${called} sur ${total}`}>
      <div className="calls-progress__track">
        <div className="calls-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="calls-progress__label xos-numeric">
        {called}/{total}
      </span>
    </div>
  );
}
