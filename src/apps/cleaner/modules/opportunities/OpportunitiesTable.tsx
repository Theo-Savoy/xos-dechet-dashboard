import type { OpportunityWorkspaceItem } from './api';
import type {
  OpportunitySortKey,
  OpportunityWorkspaceState,
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

const columns: Array<[OpportunitySortKey, string]> = [
  ['name', 'Nom'],
  ['account', 'Compte'],
  ['owner', 'Owner'],
  ['stage', 'Étape'],
  ['amount', 'Montant'],
  ['probability', 'Probabilité'],
  ['close_date', 'Close date'],
  ['last_activity', 'Dernière activité'],
  ['type_vente', 'Type de vente'],
  ['category', 'Catégorie'],
  ['score', 'Score'],
];

const display = (value: unknown) =>
  value == null || value === '' ? '—' : String(value);

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
  const allSelected =
    items.length > 0 && items.every((item) => state.selectedIds.has(item.id));
  return (
    <div className="cleaner-opportunities__table-wrap">
      <table className="cleaner-opportunities__table">
        <thead>
          <tr>
            <th scope="col" aria-label="Sélection">
              <input
                aria-label="Sélectionner la page"
                type="checkbox"
                checked={allSelected}
                onChange={onTogglePage}
                onClick={(event) => event.stopPropagation()}
              />
            </th>
            {columns.map(([key, label]) => (
              <th scope="col" key={key}>
                <button
                  type="button"
                  aria-label={`Trier par ${label}`}
                  onClick={() => onSort(key)}
                >
                  {label}
                </button>
                {key === 'score' ? (
                  <span
                    className="cleaner-opportunities__score-help"
                    title="Le score priorise les anomalies les plus urgentes."
                    aria-hidden="true"
                  >
                    ⓘ
                  </span>
                ) : null}
              </th>
            ))}
            <th scope="col">Raisons</th>
            <th scope="col">Actions</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <input
                  aria-label={`Sélectionner ${item.name || item.id}`}
                  type="checkbox"
                  checked={state.selectedIds.has(item.id)}
                  onChange={() => onToggleSelection(item.id)}
                  onClick={(event) => event.stopPropagation()}
                />
              </td>
              <td>
                <button
                  className="cleaner-opportunities__row-link"
                  type="button"
                  onClick={() => onOpenDetail(item)}
                >
                  Ouvrir <span>{item.name || item.id}</span>
                </button>
              </td>
              <td>{display(item.account)}</td>
              <td>{display(item.owner)}</td>
              <td>{display(item.stage)}</td>
              <td>{display(item.amount)}</td>
              <td>{display(item.probability)}%</td>
              <td>{display(item.close_date)}</td>
              <td>{display(item.last_activity)}</td>
              <td>{display(item.type_vente)}</td>
              <td>{display(item.category)}</td>
              <td>{display(item.score)}</td>
              <td>
                {item.anomalies.map((anomaly) => anomaly.label).join(' · ') ||
                  '—'}
              </td>
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
          ))}
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
    </div>
  );
}
