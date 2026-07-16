import { GlassCard } from "../../components/ui";
import type { CallFunnelStage } from "./CallFunnelCard.helpers";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function funnelStageWidth(count: number, max: number) {
  if (count <= 0) return 24;
  if (max <= 0) return 38;
  return Math.max(38, Math.round(30 + (count / max) * 70));
}

type CallFunnelCardProps = {
  stages: CallFunnelStage[];
  title?: string;
  compact?: boolean;
  className?: string;
};

export function CallFunnelCard({
  stages,
  title = "De l’appel au RDV",
  compact = false,
  className,
}: CallFunnelCardProps) {
  const max = Math.max(...stages.map((stage) => stage.count), 0);
  const top = stages[0]?.count ?? 0;

  return (
    <GlassCard
      className={["calls-funnel-card", compact ? "calls-funnel-card--compact" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {title && <h3 className="calls-funnel-card__title">{title}</h3>}
      <div className="calls-funnel" role="img" aria-label="De l’appel au RDV">
        {stages.map((stage, index) => {
          const width = funnelStageWidth(stage.count, max);
          const share = top > 0 ? stage.count / top : 0;
          return (
            <div
              key={stage.key}
              className={`calls-funnel__stage${stage.count <= 0 ? " calls-funnel__stage--empty" : ""}`}
              style={{
                ["--funnel-width" as string]: `${width}%`,
                ["--stage-color" as string]: stage.color,
                zIndex: stages.length - index,
              }}
            >
              <div className="calls-funnel__meta">
                <span className="calls-funnel__label">
                  {stage.label}
                  {stage.hint ? <em> · {stage.hint}</em> : null}
                </span>
                {!compact && (
                  <span className="calls-funnel__pct">{percent.format(share)}</span>
                )}
              </div>
              <strong className="xos-numeric">{countFmt.format(stage.count)}</strong>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
