import { useMemo, useState } from 'react';
import type { CleanerCapabilities } from '../../contracts';
import {
  executeOpportunityCommand,
  generateIdempotencyKey,
  previewOpportunityCommand,
  type OpportunityCommandPreview,
  type OpportunityCommandResult,
  type OpportunityWorkspaceItem,
} from './api';
import { BulkActionBar } from './BulkActionBar';
import { CommandPreviewPanel, type CommandAction } from './CommandPreviewPanel';
import { OpportunitiesFilters } from './OpportunitiesFilters';
import { OpportunitiesTable } from './OpportunitiesTable';
import {
  paginateOpportunityItems,
  sortOpportunityItems,
  matchesOpportunityFilters,
  type OpportunityWorkspaceState,
} from './filterState';
import { OpportunityDetailPanel } from './OpportunityDetailPanel';
import { retainFailedSelection } from './filterState';

type OpportunitiesCleaningViewProps = {
  accessToken?: string;
  capabilities: CleanerCapabilities;
  items: OpportunityWorkspaceItem[];
  state: OpportunityWorkspaceState;
  onStateChange: (state: OpportunityWorkspaceState) => void;
  detail: OpportunityWorkspaceItem | null;
  onOpenDetail: (item: OpportunityWorkspaceItem) => void;
  onCloseDetail: () => void;
};

function wasTreated(item: OpportunityWorkspaceItem): boolean {
  if (item.loss_reason) return true;
  return Boolean(
    item.history?.some((entry) => {
      const action = String(
        entry.action || entry.action_type || '',
      ).toLowerCase();
      return (
        action.includes('update') ||
        action.includes('close') ||
        action.includes('treat')
      );
    }),
  );
}

function criticalityFor(
  item: OpportunityWorkspaceItem,
): 'critical' | 'warning' | 'healthy' {
  if (item.anomalies.some((anomaly) => anomaly.severity === 'critical'))
    return 'critical';
  if (item.anomalies.some((anomaly) => anomaly.severity === 'warning'))
    return 'warning';
  return 'healthy';
}

export function OpportunitiesCleaningView({
  accessToken,
  capabilities,
  items,
  state,
  onStateChange,
  detail,
  onOpenDetail,
  onCloseDetail,
}: OpportunitiesCleaningViewProps) {
  const [commandAction, setCommandAction] = useState<CommandAction | null>(
    null,
  );
  const [preview, setPreview] = useState<OpportunityCommandPreview | null>(
    null,
  );
  const [result, setResult] = useState<OpportunityCommandResult | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandLoading, setCommandLoading] = useState(false);
  const [showTreated, setShowTreated] = useState(false);
  const workspaceItems = useMemo(
    () => items.filter((item) => wasTreated(item) === showTreated),
    [items, showTreated],
  );
  const filteredItems = useMemo(
    () =>
      workspaceItems.filter((item) =>
        matchesOpportunityFilters(item, state.filters),
      ),
    [workspaceItems, state.filters],
  );
  const sortedItems = useMemo(
    () => sortOpportunityItems(filteredItems, state.sort),
    [filteredItems, state.sort],
  );
  const page = paginateOpportunityItems(sortedItems, state.page);
  const safePage = Math.min(state.page, page.pageCount);
  const pageItems =
    safePage === state.page
      ? page.items
      : paginateOpportunityItems(sortedItems, safePage).items;
  const updateFilters = (filters: OpportunityWorkspaceState['filters']) =>
    onStateChange({ ...state, filters, page: 1 });
  const sort = (key: OpportunityWorkspaceState['sort']['key']) =>
    onStateChange({
      ...state,
      page: 1,
      sort: {
        key,
        direction:
          state.sort.key === key && state.sort.direction === 'asc'
            ? 'desc'
            : 'asc',
      },
    });
  const toggle = (id: string) => {
    const selectedIds = new Set(state.selectedIds);
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    onStateChange({ ...state, selectedIds });
  };
  const togglePage = () => {
    const selectedIds = new Set(state.selectedIds);
    const all =
      pageItems.length > 0 &&
      pageItems.every((item) => selectedIds.has(item.id));
    pageItems.forEach((item) =>
      all ? selectedIds.delete(item.id) : selectedIds.add(item.id),
    );
    onStateChange({ ...state, selectedIds });
  };
  const selectAll = () =>
    onStateChange({
      ...state,
      selectedIds: new Set([
        ...state.selectedIds,
        ...filteredItems.map((item) => item.id),
      ]),
    });
  const clearSelection = () =>
    onStateChange({ ...state, selectedIds: new Set() });
  const startCommand = (action: CommandAction) => {
    setCommandAction(action);
    setPreview(null);
    setResult(null);
    setCommandError(null);
  };
  const closeCommand = () => {
    if (!commandLoading) {
      setCommandAction(null);
      setPreview(null);
      setResult(null);
      setCommandError(null);
    }
  };
  const selectedItems = items.filter((item) => state.selectedIds.has(item.id));
  const ownerOptions = [
    ...new Map(
      items
        .filter((item) => item.owner_id)
        .map((item) => [
          item.owner_id!,
          { id: item.owner_id!, label: item.owner || item.owner_id! },
        ]),
    ).values(),
  ];
  const saleTypeOptions = [
    ...new Set(
      items
        .map((item) => item.type_vente)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const askPreview = (
    changes: Parameters<typeof previewOpportunityCommand>[1]['changes'],
  ) => {
    setCommandLoading(true);
    setCommandError(null);
    setPreview(null);
    setResult(null);
    previewOpportunityCommand(accessToken, {
      ids: [...state.selectedIds],
      changes,
    })
      .then(setPreview)
      .catch((cause: unknown) =>
        setCommandError(
          cause instanceof Error
            ? cause.message
            : 'Le preview est indisponible.',
        ),
      )
      .finally(() => setCommandLoading(false));
  };
  const executePreview = (commandPreview: OpportunityCommandPreview) => {
    const idempotencyKey = generateIdempotencyKey();
    setCommandLoading(true);
    setCommandError(null);
    executeOpportunityCommand(accessToken, {
      previewId: commandPreview.previewId,
      fingerprint: commandPreview.fingerprint,
      idempotencyKey,
    })
      .then((commandResult) => {
        setResult(commandResult);
        const successfulIds = commandResult.results
          .filter((item) => item.success)
          .map((item) => item.id);
        onStateChange({
          ...state,
          selectedIds: retainFailedSelection(state.selectedIds, successfulIds),
        });
      })
      .catch((cause: unknown) =>
        setCommandError(
          cause instanceof Error
            ? cause.message
            : 'L’exécution est indisponible.',
        ),
      )
      .finally(() => setCommandLoading(false));
  };
  const criticalCount = filteredItems.filter(
    (item) => criticalityFor(item) === 'critical',
  ).length;
  const warningCount = filteredItems.filter(
    (item) => criticalityFor(item) === 'warning',
  ).length;
  const healthyCount = filteredItems.filter(
    (item) => criticalityFor(item) === 'healthy',
  ).length;

  return (
    <section
      className="cleaner-opportunities__cleaning"
      aria-labelledby="cleaner-opportunities-title"
    >
      <div className="cleaner-opportunities__intro">
        <div>
          <p className="cleaner-eyebrow">Nettoyage</p>
          <h2 id="cleaner-opportunities-title">Opportunités à corriger</h2>
        </div>
        <span className="cleaner-opportunities__freshness">
          Données Salesforce · {workspaceItems.length} reçues
        </span>
      </div>
      <div
        className="cleaner-opportunities__kpis"
        aria-label="Indicateurs de nettoyage"
      >
        <button
          className="cleaner-opportunities__kpi cleaner-opportunities__kpi--total"
          type="button"
          aria-label={`Opportunités à nettoyer (${filteredItems.length})`}
          onClick={() =>
            updateFilters({
              ...state.filters,
              search: '',
              criticality: undefined,
            })
          }
        >
          <strong>{filteredItems.length}</strong>
          <span>À nettoyer</span>
        </button>
        <button
          className="cleaner-opportunities__kpi cleaner-opportunities__kpi--critical"
          type="button"
          aria-label={`Opportunités critiques (${criticalCount})`}
          onClick={() =>
            updateFilters({ ...state.filters, criticality: 'critical' })
          }
        >
          <strong>{criticalCount}</strong>
          <span>Critiques</span>
        </button>
        <button
          className="cleaner-opportunities__kpi cleaner-opportunities__kpi--warning"
          type="button"
          aria-label={`Opportunités avec avertissement (${warningCount})`}
          onClick={() =>
            updateFilters({ ...state.filters, criticality: 'warning' })
          }
        >
          <strong>{warningCount}</strong>
          <span>Avertissements</span>
        </button>
        <button
          className="cleaner-opportunities__kpi cleaner-opportunities__kpi--healthy"
          type="button"
          aria-label={`Opportunités sans anomalie (${healthyCount})`}
          onClick={() =>
            updateFilters({ ...state.filters, criticality: 'healthy' })
          }
        >
          <strong>{healthyCount}</strong>
          <span>Sans anomalie</span>
        </button>
      </div>
      <div className="cleaner-opportunities__workspace">
        <OpportunitiesFilters
          items={workspaceItems}
          filters={state.filters}
          onChange={updateFilters}
          onReset={() =>
            updateFilters({
              search: '',
              owners: [],
              categories: [],
              saleTypes: [],
              reasonFamilies: {},
            })
          }
          showTreated={showTreated}
          onToggleTreated={() => {
            setShowTreated((value) => !value);
            onStateChange({ ...state, page: 1, selectedIds: new Set() });
          }}
        />
        <BulkActionBar
          selectedCount={state.selectedIds.size}
          filteredCount={filteredItems.length}
          currentPageCount={pageItems.length}
          currentPageSelectedCount={
            pageItems.filter((item) => state.selectedIds.has(item.id)).length
          }
          allFilteredSelected={
            filteredItems.length > 0 &&
            filteredItems.every((item) => state.selectedIds.has(item.id))
          }
          capabilities={capabilities}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onStartAction={startCommand}
        />
        <div
          className={`cleaner-opportunities__main${detail ? ' has-detail' : ''}`}
        >
          <div className="cleaner-opportunities__table-column">
            {filteredItems.length ? (
              <OpportunitiesTable
                items={pageItems}
                state={{ ...state, page: safePage }}
                pageCount={page.pageCount}
                onSort={sort}
                onToggleSelection={toggle}
                onTogglePage={togglePage}
                onPageChange={(pageNumber) =>
                  onStateChange({
                    ...state,
                    page: Math.min(Math.max(pageNumber, 1), page.pageCount),
                  })
                }
                onOpenDetail={onOpenDetail}
              />
            ) : (
              <div className="cleaner-opportunities__empty" role="status">
                {showTreated
                  ? 'Aucune opportunité traitée.'
                  : 'Aucune opportunité à nettoyer.'}
              </div>
            )}
          </div>
          {detail ? (
            <div className="cleaner-opportunities__detail-column">
              <OpportunityDetailPanel item={detail} onClose={onCloseDetail} />
            </div>
          ) : null}
        </div>
      </div>
      {commandAction ? (
        <CommandPreviewPanel
          action={commandAction}
          selectedCount={state.selectedIds.size}
          selectedItems={selectedItems}
          ownerOptions={ownerOptions}
          saleTypeOptions={saleTypeOptions}
          preview={preview}
          result={result}
          loading={commandLoading}
          error={commandError}
          onClose={closeCommand}
          onPreview={askPreview}
          onExecute={executePreview}
        />
      ) : null}
    </section>
  );
}
