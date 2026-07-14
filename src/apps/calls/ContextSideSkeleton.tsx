import { GlassCard } from "../../components/ui";

export function ContextSideSkeleton({ quiet = false }: { quiet?: boolean }) {
  return (
    <>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>Historique d&apos;appels</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>Opportunités du compte</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
      <GlassCard className="calls-context-panel calls-context-panel--skeleton" aria-busy="true">
        <h3>RDV du compte</h3>
        <p className="calls-muted">{quiet ? "\u00a0" : "Chargement…"}</p>
      </GlassCard>
    </>
  );
}
