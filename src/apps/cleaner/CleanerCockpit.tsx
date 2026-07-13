import { isCleanerModuleId, type CleanerModuleId } from './shell/shellState';

export type CleanerCriticality = 'critical' | 'warning' | 'healthy';

export type CleanerCockpitSummary = {
  moduleId: string;
  label: string;
  criticality: CleanerCriticality;
  anomalyCount: number;
  affectedRecordCount: number;
  resolvedPeriodCount: number;
  previousPeriodDelta: number | null;
  lastRefreshedAt: string | null;
};

export type CleanerCockpitState = {
  status: 'loading' | 'ready' | 'empty' | 'error';
  summaries: readonly CleanerCockpitSummary[];
  error?: string;
};

type CleanerCockpitProps = {
  state: CleanerCockpitState;
  onOpenModule: (moduleId: CleanerModuleId) => void;
};

const criticalityOrder: Record<CleanerCriticality, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

export function CleanerCockpit({ state, onOpenModule }: CleanerCockpitProps) {
  if (state.status === 'loading') {
    return (
      <div
        className="cleaner-cockpit"
        data-testid="cleaner-cockpit"
        role="status"
        aria-busy="true"
      >
        Chargement des faits du Labo…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        className="cleaner-cockpit"
        data-testid="cleaner-cockpit"
        role="alert"
      >
        {state.error || 'Les faits du Labo sont indisponibles.'}
      </div>
    );
  }

  if (state.status === 'empty' || state.summaries.length === 0) {
    return (
      <div
        className="cleaner-cockpit"
        data-testid="cleaner-cockpit"
        role="status"
      >
        Aucune donnée de nettoyage disponible.
      </div>
    );
  }

  const summaries = [...state.summaries].sort(
    (left, right) =>
      criticalityOrder[left.criticality] -
        criticalityOrder[right.criticality] ||
      left.label.localeCompare(right.label),
  );
  const totalAnomalies = summaries.reduce(
    (total, summary) => total + summary.anomalyCount,
    0,
  );
  const totalAffectedRecords = summaries.reduce(
    (total, summary) => total + summary.affectedRecordCount,
    0,
  );

  return (
    <section
      className="cleaner-cockpit"
      data-testid="cleaner-cockpit"
      aria-labelledby="cleaner-cockpit-title"
    >
      <div className="cleaner-cockpit__intro">
        <p className="cleaner-eyebrow">Accueil</p>
        <h1 id="cleaner-cockpit-title">
          Les faits qui demandent votre attention
        </h1>
        <p>Une vue de travail factuelle, classée par criticité.</p>
      </div>
      <div className="cleaner-cockpit__totals" aria-label="Totaux du Labo">
        <div className="cleaner-stat">
          <strong>{totalAnomalies}</strong>
          <span>Anomalies</span>
        </div>
        <div className="cleaner-stat">
          <strong>{totalAffectedRecords}</strong>
          <span>Enregistrements concernés</span>
        </div>
      </div>
      <div
        className="cleaner-cockpit__modules"
        aria-label="Modules par criticité"
      >
        {summaries.map((summary) => (
          <article
            className={`cleaner-cockpit-module cleaner-cockpit-module--${summary.criticality}`}
            data-testid="cleaner-cockpit-module"
            key={summary.moduleId}
          >
            <div>
              <p className="cleaner-eyebrow">
                {summary.criticality === 'critical'
                  ? 'Critique'
                  : summary.criticality === 'warning'
                    ? 'À surveiller'
                    : 'Stable'}
              </p>
              <h2>{summary.label}</h2>
              <p>
                {summary.anomalyCount} anomalies · {summary.affectedRecordCount}{' '}
                enregistrements concernés
              </p>
            </div>
            <button
              className="xos-btn xos-btn--secondary"
              type="button"
              aria-label={`Ouvrir ${summary.label}`}
              onClick={() => {
                if (isCleanerModuleId(summary.moduleId))
                  onOpenModule(summary.moduleId);
              }}
            >
              Ouvrir
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
