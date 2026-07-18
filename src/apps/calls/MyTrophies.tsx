import { useRef } from "react";
import { Button, GlassCard } from "../../components/ui";
import { useComboOverlay } from "./comboOverlay";
import { summarizeComboBadges, summarizeComboStreaks, useComboXp } from "./useComboXp";

type MyTrophiesProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
};

/** Mur local "Mes réussites" (spec §5) — réussites personnelles, jamais d'équipe. */
export function MyTrophies({ open, onClose, userId }: MyTrophiesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useComboOverlay(open, rootRef, onClose);

  const xp = useComboXp(userId);
  const badges = summarizeComboBadges(userId);
  const streaks = summarizeComboStreaks(userId);

  if (!open) return null;

  return (
    <div ref={rootRef} className="calls-trophies" role="dialog" aria-modal="true" aria-label="Mes réussites">
      <button type="button" className="calls-trophies__backdrop" tabIndex={-1} aria-label="Fermer" onClick={onClose} />
      <GlassCard className="calls-trophies__panel">
        <div className="calls-trophies__head">
          <h2>Mes réussites</h2>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>

        <section className="calls-trophies__section" aria-label="Ma progression">
          <h3>Ma progression</h3>
          <ul>
            {xp.axes.map((axis) => (
              <li key={axis.id}>
                {axis.label} · {axis.count}
                {axis.palier && ` · ${axis.palier}`}
              </li>
            ))}
          </ul>
        </section>

        <section className="calls-trophies__section" aria-label="Mes badges">
          <h3>Mes badges</h3>
          {badges.length === 0 ? (
            <p className="calls-muted">Aucun badge débloqué pour l&apos;instant.</p>
          ) : (
            <ul>
              {badges.map((badge) => (
                <li key={badge.id}>Badge débloqué : {badge.label}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="calls-trophies__section" aria-label="Mes streaks">
          <h3>Mes streaks</h3>
          <ul>
            {streaks.map((streak) => (
              <li key={streak.id}>
                {streak.label} · {streak.days} jour{streak.days > 1 ? "s" : ""}
                {streak.palier && ` · ${streak.palier}`}
              </li>
            ))}
          </ul>
        </section>
      </GlassCard>
    </div>
  );
}
