import type { OpportunityWorkspaceItem } from './api';

type OpportunityDetailPanelProps = {
  item: OpportunityWorkspaceItem;
  onClose: () => void;
};

export function OpportunityDetailPanel({
  item,
  onClose,
}: OpportunityDetailPanelProps) {
  return (
    <aside
      className="cleaner-opportunities__detail"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opportunity-detail-title"
    >
      <div className="cleaner-opportunities__detail-header">
        <div>
          <p className="cleaner-eyebrow">Détail opportunité</p>
          <h2 id="opportunity-detail-title">{item.name || item.id}</h2>
        </div>
        <button
          className="xos-btn xos-btn--secondary"
          type="button"
          aria-label="Fermer le détail"
          onClick={onClose}
        >
          Retour
        </button>
      </div>
      <dl className="cleaner-opportunities__facts">
        <div>
          <dt>Compte</dt>
          <dd>{item.account || '—'}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{item.owner || '—'}</dd>
        </div>
        <div>
          <dt>Étape</dt>
          <dd>{item.stage || '—'}</dd>
        </div>
        <div>
          <dt>Montant</dt>
          <dd>{item.amount ?? '—'}</dd>
        </div>
        <div>
          <dt>Proba</dt>
          <dd>{item.probability == null ? '—' : `${item.probability}%`}</dd>
        </div>
      </dl>
      <section className="cleaner-opportunities__detail-reasons">
        <h3>Preuves et raisons</h3>
        {item.anomalies.length ? (
          item.anomalies.map((anomaly) => (
            <article
              className="cleaner-opportunities__anomaly-card"
              key={anomaly.ruleId}
            >
              <div className="cleaner-opportunities__anomaly-header">
                <strong>{anomaly.label}</strong>
                <span
                  className={`cleaner-opportunities__severity cleaner-opportunities__severity--${anomaly.severity}`}
                >
                  {anomaly.severity === 'critical'
                    ? 'Critique'
                    : 'Avertissement'}
                </span>
              </div>
              <span className="cleaner-opportunities__anomaly-score">
                Score {anomaly.score}
              </span>
              {anomaly.evidence.map((evidence) => (
                <dl
                  key={`${anomaly.ruleId}-${evidence.field}`}
                  className="cleaner-opportunities__evidence"
                >
                  <div>
                    <dt>Champ</dt>
                    <dd>{evidence.field}</dd>
                  </div>
                  <div>
                    <dt>Valeur actuelle</dt>
                    <dd>{evidence.actual ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Valeur attendue</dt>
                    <dd>{evidence.expected}</dd>
                  </div>
                </dl>
              ))}
            </article>
          ))
        ) : (
          <p>Aucune raison fournie.</p>
        )}
      </section>
      <section>
        <h3>Corrections disponibles</h3>
        <p>Les actions seront proposées avec validation serveur.</p>
      </section>
      <section>
        <h3>Historique avant / après</h3>
        {item.history?.length ? (
          <ul>
            {item.history.map((entry, index) => (
              <li key={index}>
                {String(entry.date || 'Date inconnue')} ·{' '}
                {String(entry.action || entry.detail || 'Événement')} · Avant :{' '}
                {String(entry.before ?? '—')} · Après :{' '}
                {String(entry.after ?? '—')}
              </li>
            ))}
          </ul>
        ) : (
          <p>Aucun historique récent.</p>
        )}
      </section>
      {item.salesforce_url ? (
        <a href={item.salesforce_url} target="_blank" rel="noreferrer">
          Voir dans Salesforce
        </a>
      ) : null}
    </aside>
  );
}
