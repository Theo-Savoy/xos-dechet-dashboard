import { useState } from 'react';
import { Checkbox } from '../../../../components/ui';
import type { OpportunityWorkspaceItem } from './api';
import {
  daysSinceOpportunityDate,
  type OpportunitySortKey,
  type OpportunityWorkspaceState,
} from './filterState';

type OpportunitiesTableProps = {
  items: OpportunityWorkspaceItem[];
  state: OpportunityWorkspaceState;
  pageCount: number;
  onSort: (key: OpportunitySortKey) => void;
  onToggleSelection: (id: string) => void;
  onTogglePage: () => void;
  onPageChange: (page: number) => void;
  onOpenDetail: (item: OpportunityWorkspaceItem) => void;
};

export const REASON_LABELS: Record<string, string> = {
  close_date_overdue_over_1_year: "Date de clôture dépassée de plus d'un an",
  close_date_overdue_6_to_12_months: 'Date de clôture dépassée de 6 à 12 mois',
  close_date_overdue_3_to_6_months: 'Date de clôture dépassée de 3 à 6 mois',
  close_date_overdue_under_3_months:
    'Date de clôture dépassée de moins de 3 mois',
  never_active: 'Aucune activité jamais enregistrée',
  activity_never_recorded: 'Aucune activité jamais enregistrée',
  no_activity_over_1_year: "Pas d'activité depuis plus d'un an",
  activity_inactive_over_1_year: "Pas d'activité depuis plus d'un an",
  no_activity_over_3_months: "Pas d'activité depuis plus de 3 mois",
  activity_inactive_over_3_months: "Pas d'activité depuis plus de 3 mois",
  no_activity_over_30_days: "Pas d'activité depuis plus de 30 jours",
  activity_inactive_over_30_days: "Pas d'activité depuis plus de 30 jours",
  amount_missing: 'Montant absent',
  probability_zero: 'Probabilité égale à 0%',
  owner_inactive: 'Propriétaire inactif',
  owner_former_employee: 'Ancien commercial',
  former_owner: 'Ancien commercial',
  stalled_stage: 'Étape bloquée',
  stage_suspect_stalled: 'Étape bloquée',
  old_opportunity_2y: 'Opportunité créée il y a plus de 2 ans',
  opportunity_created_over_2_years: 'Opportunité créée il y a plus de 2 ans',
  old_opportunity_1y: "Opportunité créée il y a plus d'un an",
  opportunity_created_over_1_year: "Opportunité créée il y a plus d'un an",
  amount_implausible: 'Montant incohérent',
};

export const REASON_FAMILIES: Record<string, string> = {
  close_date_overdue_over_1_year: 'closedate',
  close_date_overdue_6_to_12_months: 'closedate',
  close_date_overdue_3_to_6_months: 'closedate',
  close_date_overdue_under_3_months: 'closedate',
  never_active: 'activity',
  activity_never_recorded: 'activity',
  no_activity_over_1_year: 'activity',
  activity_inactive_over_1_year: 'activity',
  no_activity_over_3_months: 'activity',
  activity_inactive_over_3_months: 'activity',
  no_activity_over_30_days: 'activity',
  activity_inactive_over_30_days: 'activity',
  amount_missing: 'amount_missing',
  probability_zero: 'prob_zero',
  owner_inactive: 'owner_inactive',
  owner_former_employee: 'owner_inactive',
  former_owner: 'owner_inactive',
  old_opportunity_2y: 'age',
  opportunity_created_over_2_years: 'age',
  old_opportunity_1y: 'age',
  opportunity_created_over_1_year: 'age',
  stalled_stage: 'stalled',
  stage_suspect_stalled: 'stalled',
  amount_implausible: 'incoherent_amount',
};

export const REASON_FAMILY_LABELS: Record<string, string> = {
  closedate: '⏰ Close date dépassée',
  activity: "⚡ Pas d'activité",
  amount_missing: '💰 Absence de montant',
  prob_zero: '📉 Probabilité',
  owner_inactive: '👤 Propriétaire inactif / ancien',
  age: "📅 Ancienneté d'opportunité",
  stalled: '📌 Étape enlisée',
  incoherent_amount: '⚠️ Montant incohérent',
  autres: 'Autres anomalies',
};

const REASON_FAMILY_ORDER = [
  'closedate',
  'activity',
  'amount_missing',
  'prob_zero',
  'owner_inactive',
  'age',
  'stalled',
  'incoherent_amount',
  'autres',
];

const columns: Array<[OpportunitySortKey, string]> = [
  ['category', 'Catégorie'],
  ['score', 'Score'],
  ['name', 'Nom'],
  ['account', 'Compte'],
  ['owner', 'Owner'],
  ['stage', 'Étape'],
  ['close_date', 'Close date'],
  ['days_overdue', 'Retard'],
  ['amount', 'Montant'],
  ['probability', 'Probabilité'],
  ['days_since_activity', 'Dernière activité'],
  ['reasons', 'Raisons'],
  ['salesforce_url', 'Lien SF'],
  ['type_vente', 'Type de vente'],
  ['actions', 'Actions'],
  ['evidence', 'Evidence'],
];

const display = (value: unknown) =>
  value == null || value === '' ? '—' : String(value);

function formatDuration(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}an`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}j`;
}

function overdueLabel(closeDate: string | null | undefined): string {
  const days = daysSinceOpportunityDate(closeDate);
  return days !== null && days > 0 ? formatDuration(days) : '—';
}

function activityLabel(lastActivity: string | null | undefined): string {
  const days = daysSinceOpportunityDate(lastActivity);
  if (days === null) return 'Jamais';
  return formatDuration(Math.max(days, 0));
}

function familyForRule(ruleId: string): string {
  if (REASON_FAMILIES[ruleId]) return REASON_FAMILIES[ruleId];
  if (ruleId.startsWith('close_date_overdue_')) return 'closedate';
  if (ruleId.includes('activity') || ruleId.includes('active'))
    return 'activity';
  if (ruleId.includes('amount'))
    return ruleId.includes('missing') ? 'amount_missing' : 'incoherent_amount';
  if (ruleId.includes('probability')) return 'prob_zero';
  if (ruleId.includes('owner')) return 'owner_inactive';
  if (ruleId.includes('opportunity') || ruleId.includes('created'))
    return 'age';
  if (ruleId.includes('stage')) return 'stalled';
  return 'autres';
}

function reasonLabel(ruleId: string, anomalyLabel?: string): string {
  return REASON_LABELS[ruleId] || anomalyLabel || 'Anomalie CRM';
}

function ReasonChips({
  items,
}: {
  items: OpportunityWorkspaceItem['anomalies'];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return <span>—</span>;

  const grouped = new Map<string, OpportunityWorkspaceItem['anomalies']>();
  items.forEach((anomaly) => {
    const family = familyForRule(anomaly.ruleId);
    const current = grouped.get(family) || [];
    grouped.set(family, [...current, anomaly]);
  });
  const groups = [...grouped.entries()].sort(
    ([left], [right]) =>
      REASON_FAMILY_ORDER.indexOf(left) - REASON_FAMILY_ORDER.indexOf(right),
  );
  const chip = (anomaly: OpportunityWorkspaceItem['anomalies'][number]) => (
    <span
      className="cleaner-opportunities__reason-chip"
      key={anomaly.ruleId}
      title={reasonLabel(anomaly.ruleId, anomaly.label)}
    >
      {reasonLabel(anomaly.ruleId, anomaly.label)}
    </span>
  );
  const chips = (anomalies: OpportunityWorkspaceItem['anomalies']) => (
    <div className="cleaner-opportunities__reason-chips">
      {anomalies.map(chip)}
    </div>
  );

  if (items.length <= 3) return chips(items);
  const collapsedItems = items.slice(0, 2);
  const hiddenCount = items.length - collapsedItems.length;
  return (
    <div
      className={`cleaner-opportunities__reason-groups${expanded ? ' cleaner-opportunities__reason-groups--expanded' : ' cleaner-opportunities__reason-groups--collapsed'}`}
    >
      {!expanded ? (
        <>
          <div
            className="cleaner-opportunities__reason-family-summary"
            aria-label="Familles de raisons"
          >
            {groups.map(([family]) => (
              <span
                className="cleaner-opportunities__reason-family"
                key={family}
              >
                {REASON_FAMILY_LABELS[family] || REASON_FAMILY_LABELS.autres}
              </span>
            ))}
          </div>
          <div className="cleaner-opportunities__reason-chips">
            {collapsedItems.map(chip)}
            <button
              type="button"
              className="cleaner-opportunities__reason-more"
              aria-label={`Afficher ${hiddenCount} autres raisons`}
              aria-expanded={false}
              onClick={() => setExpanded(true)}
            >
              +{hiddenCount} autres
            </button>
          </div>
        </>
      ) : (
        <>
          {groups.map(([family, anomalies]) => (
            <div
              className="cleaner-opportunities__reason-family-group"
              key={family}
            >
              <span className="cleaner-opportunities__reason-family">
                {REASON_FAMILY_LABELS[family] || REASON_FAMILY_LABELS.autres}
              </span>
              {chips(anomalies)}
            </div>
          ))}
          <button
            type="button"
            className="cleaner-opportunities__reason-more"
            aria-label="Réduire les raisons"
            aria-expanded={true}
            onClick={() => setExpanded(false)}
          >
            Réduire
          </button>
        </>
      )}
    </div>
  );
}

function ScoreHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="cleaner-opportunities__score-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="cleaner-opportunities__score-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleaner-opportunities-score-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cleaner-opportunities__score-header">
          <h2 id="cleaner-opportunities-score-help-title">
            📊 Calcul du Score d&apos;Hygiène
          </h2>
          <button
            type="button"
            aria-label="Fermer l'aide du score"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="cleaner-opportunities__score-content">
          <p>
            Le score permet de prioriser le nettoyage du CRM. Plus le score est
            élevé, plus le besoin de traitement est urgent.
          </p>
          <h3>1. Retard de CloseDate (jusqu&apos;à +12 pts)</h3>
          <p>
            +1 pt par mois de retard (30 jours), plafonné à 12 pts (1 an et
            plus).
          </p>
          <h3>2. Inactivité de l&apos;opportunité</h3>
          <ul>
            <li>
              Aucune activité enregistrée : <strong>+8 pts</strong>
            </li>
            <li>
              Inactivité &gt; 1 an : <strong>+5 pts</strong>
            </li>
            <li>
              Inactivité &gt; 3 mois : <strong>+5 pts</strong>
            </li>
            <li>
              Inactivité &gt; 30 jours : <strong>+2 pts</strong>
            </li>
          </ul>
          <h3>3. Informations manquantes ou incohérentes</h3>
          <ul>
            <li>
              Montant incohérent (&le; 100€) : <strong>+10 pts</strong>
            </li>
            <li>
              Aucun montant renseigné (0€) : <strong>+6 pts</strong>
            </li>
            <li>
              Probabilité à 0% : <strong>+3 pts</strong>
            </li>
            <li>
              Étape « Suspect enlisé » : <strong>+3 pts</strong>
            </li>
          </ul>
          <h3>4. Propriétaire (Owner)</h3>
          <ul>
            <li>
              Propriétaire inactif dans Salesforce : <strong>+10 pts</strong>
            </li>
            <li>
              Ancien commercial (départ de l&apos;entreprise) :{' '}
              <strong>+8 pts</strong>
            </li>
          </ul>
          <h3>5. Importance du montant (Pondération)</h3>
          <p>
            +1 pt supplémentaire par tranche de 10k€ de budget à risque,
            plafonné à <strong>+5 pts</strong> (pour traiter d&apos;abord les
            plus gros montants).
          </p>
        </div>
        <div className="cleaner-opportunities__score-footer">
          <button
            className="xos-btn xos-btn--primary"
            type="button"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}

export function OpportunitiesTable({
  items,
  state,
  pageCount,
  onSort,
  onToggleSelection,
  onTogglePage,
  onPageChange,
  onOpenDetail,
}: OpportunitiesTableProps) {
  const [scoreHelpOpen, setScoreHelpOpen] = useState(false);
  const allSelected =
    items.length > 0 && items.every((item) => state.selectedIds.has(item.id));
  const someSelected =
    !allSelected && items.some((item) => state.selectedIds.has(item.id));
  const severityFor = (item: OpportunityWorkspaceItem) =>
    item.anomalies.some((anomaly) => anomaly.severity === 'critical')
      ? 'critical'
      : 'warning';

  return (
    <div className="cleaner-opportunities__table-wrap">
      <table className="cleaner-opportunities__table">
        <thead>
          <tr>
            <th scope="col" aria-label="Sélection">
              <Checkbox
                aria-label="Sélectionner la page"
                checked={allSelected}
                onChange={onTogglePage}
                indeterminate={someSelected}
              />
            </th>
            {columns.map(([key, label]) => {
              const active = state.sort.key === key;
              const direction = active ? state.sort.direction : null;
              return (
                <th
                  scope="col"
                  aria-label={key === 'score' ? label : undefined}
                  aria-sort={
                    direction === 'asc'
                      ? 'ascending'
                      : direction === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                  key={key}
                >
                  <div className="cleaner-opportunities__table-header">
                    <button
                      type="button"
                      aria-label={`Trier par ${label}`}
                      onClick={() => onSort(key)}
                    >
                      {label}
                      <span
                        className="cleaner-opportunities__sort-indicator"
                        aria-hidden="true"
                      >
                        {direction === 'asc'
                          ? ' ↑'
                          : direction === 'desc'
                            ? ' ↓'
                            : ''}
                      </span>
                    </button>
                    {key === 'score' ? (
                      <button
                        className="cleaner-opportunities__score-help"
                        type="button"
                        aria-label="Afficher l'aide du score"
                        title="Comment est calculé le score ?"
                        onClick={() => setScoreHelpOpen(true)}
                      >
                        ⓘ
                      </button>
                    ) : null}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const severity = severityFor(item);
            return (
              <tr key={item.id}>
                <td>
                  <Checkbox
                    aria-label={`Sélectionner ${item.name || item.id}`}
                    checked={state.selectedIds.has(item.id)}
                    onChange={() => onToggleSelection(item.id)}
                  />
                </td>
                <td>
                  <span
                    className={`cleaner-opportunities__category-tag cleaner-opportunities__category-tag--${severity}`}
                    title={display(item.category)}
                  >
                    {severity === 'critical' ? 'Critique' : 'Avertissement'}
                  </span>
                </td>
                <td>{display(item.score)}</td>
                <td className="cleaner-opportunities__name-cell">
                  <button
                    className="cleaner-opportunities__row-link"
                    type="button"
                    onClick={() => onOpenDetail(item)}
                  >
                    Ouvrir{' '}
                    <span
                      className="cleaner-opportunities__name"
                      title={item.name || item.id}
                    >
                      {item.name || item.id}
                    </span>
                  </button>
                </td>
                <td>{display(item.account)}</td>
                <td>{display(item.owner)}</td>
                <td>{display(item.stage)}</td>
                <td>{display(item.close_date)}</td>
                <td>{overdueLabel(item.close_date)}</td>
                <td>{display(item.amount)}</td>
                <td>{display(item.probability)}%</td>
                <td>{activityLabel(item.last_activity)}</td>
                <td>{<ReasonChips items={item.anomalies} />}</td>
                <td>
                  {item.salesforce_url ? (
                    <a
                      className="cleaner-opportunities__salesforce-link"
                      href={item.salesforce_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ouvrir ${item.name || item.id} dans Salesforce`}
                      title="Ouvrir dans Salesforce"
                    >
                      ↗
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{display(item.type_vente)}</td>
                <td>
                  <button
                    className="cleaner-opportunities__row-link"
                    type="button"
                    onClick={() => onOpenDetail(item)}
                  >
                    Détail
                  </button>
                </td>
                <td>
                  {item.anomalies.reduce(
                    (count, anomaly) => count + anomaly.evidence.length,
                    0,
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <nav
        className="cleaner-opportunities__pagination"
        aria-label="Pagination des opportunités"
      >
        <button
          className="xos-btn xos-btn--secondary"
          type="button"
          aria-label="Page précédente"
          disabled={state.page <= 1}
          onClick={() => onPageChange(state.page - 1)}
        >
          Précédente
        </button>
        <span>
          Page {state.page} / {pageCount}
        </span>
        <button
          className="xos-btn xos-btn--secondary"
          type="button"
          aria-label="Page suivante"
          disabled={state.page >= pageCount}
          onClick={() => onPageChange(state.page + 1)}
        >
          Suivante
        </button>
      </nav>
      {scoreHelpOpen ? (
        <ScoreHelpModal onClose={() => setScoreHelpOpen(false)} />
      ) : null}
    </div>
  );
}
