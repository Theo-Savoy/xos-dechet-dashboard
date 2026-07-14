import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  GlassCard,
  Modal,
  Select,
  Tag,
} from '../../../../../components/ui';
import type { CleanerModuleProps } from '../../../shell/moduleRegistry';
import {
  bulkApplySectors,
  fetchSectorRecipe,
  type SectorRecipeState,
} from './api';
import { SectorsJournalView } from './SectorsJournalView';

// V17d: "preview" was confusing — the user said dry-run is enough.
// Only two actions remain: pick a target per row, then bulk-apply.
// The dry-run sweep runs server-side before any write, so the client
// only ever needs a single "Fusionner N secteurs" button.

export function SectorsRecipeView({ accessToken }: CleanerModuleProps) {
  const [state, setState] = useState<SectorRecipeState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<'recipe' | 'journal'>('recipe');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'success'; succeeded: number; failed: number; mappings: Array<{ from: string; to: string }> }
    | { kind: 'failed'; errors: Array<{ obsoleteId: string; message: string }> }
    | null
  >(null);
  const [job, setJob] = useState<{
    running: boolean;
    processed: number;
    total: number;
    errors: Array<{ obsoleteId: string; message: string }>;
  }>({ running: false, processed: 0, total: 0, errors: [] });

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const next = await fetchSectorRecipe(accessToken);
      setState(next);
      setTargets(next.suggestedMappings || {});
      setSelected(new Set(Object.keys(next.suggestedMappings || {})));
      setStatus('ready');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'La recette Secteurs est indisponible.',
      );
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedMapping = useMemo(
    () =>
      Object.fromEntries(
        [...selected]
          .filter((id) => targets[id])
          .map((id) => [id, targets[id]]),
      ),
    [selected, targets],
  );
  const selectedCount = Object.keys(selectedMapping).length;
  const mappingLabels = useMemo(() => {
    if (!state) return [];
    const oldLabels = new Map(state.obsoleteSectors.map((item) => [item.id, item.label]));
    const newLabels = new Map(state.activeSectors.map((item) => [item.id, item.label]));
    return Object.entries(selectedMapping).map(([from, to]) => ({
      from: oldLabels.get(from) || from,
      to: newLabels.get(to) || to,
    }));
  }, [selectedMapping, state]);
  const selectedAccounts = useMemo(
    () =>
      state?.obsoleteSectors
        .filter((item) => selected.has(item.id) && targets[item.id])
        .reduce((sum, item) => sum + item.accountCount, 0) || 0,
    [selected, state, targets],
  );
  const selectedTargets = new Set(Object.values(selectedMapping)).size;
  const jobBusy = job.running;

  const runBulk = useCallback(async () => {
    if (job.running) return;
    setError(null);
    setResult(null);
    setConfirmOpen(false);
    if (!accessToken) {
      setError('Session expirée.');
      return;
    }
    setJob({ running: true, processed: 0, total: 0, errors: [] });
    try {
      const authHeader = 'Bearer ' + accessToken;
      const start = await bulkApplySectors(accessToken, selectedMapping);
      const jobId = start.jobId;
      let done = false;
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const res = await fetch(
          `/api/cleaner?module=recettes&resource=sectors&action=status&jobId=${encodeURIComponent(jobId)}`,
          {
            headers: { Authorization: authHeader },
            cache: 'no-store',
          },
        );
        const status = (await res.json()) as {
          status: string;
          total: number;
          processed: number;
          errors: Array<{ obsoleteId: string; message: string }>;
        };
        setJob({
          running: status.status !== 'done' && status.status !== 'error',
          processed: status.processed,
          total: status.total,
          errors: status.errors,
        });
        if (status.status === 'done') {
          done = true;
          if (status.errors.length > 0) {
            setResult({ kind: 'failed', errors: status.errors });
          } else {
            setResult({
              kind: 'success',
              succeeded: status.total - status.errors.length,
              failed: 0,
              mappings: mappingLabels,
            });
            void load();
          }
        } else if (status.status === 'error') {
          done = true;
          setError('La fusion a échoué côté serveur.');
        }
      }
    } catch (cause) {
      setJob((current) => ({ ...current, running: false }));
      setError(
        cause instanceof Error ? cause.message : 'La fusion a échoué.',
      );
    }
  }, [accessToken, job.running, load, mappingLabels, selectedMapping]);

  if (status === 'loading' && !state)
    return <div role="status">Analyse des secteurs des comptes…</div>;
  if (status === 'error' && !state) return <div role="alert">{error}</div>;
  if (!state) return null;

  const allSelected =
    state.obsoleteSectors.length > 0 &&
    state.obsoleteSectors.every((item) => selected.has(item.id));

  return (
    <section
      className="cleaner-sector-recipe"
      aria-labelledby="sector-recipe-title"
    >
      <div className="cleaner-sector-recipe__intro">
        <div>
          <p className="cleaner-eyebrow">Recette · Account</p>
          <h2 id="sector-recipe-title">Secteurs obsolètes</h2>
          <p>
            Choisissez une cible par secteur obsolète, puis lancez la fusion.
            Le serveur vérifie chaque mapping (dry-run) avant toute écriture.
          </p>
        </div>
      </div>

      <div
        className="cleaner-sector-tabs"
        role="tablist"
        aria-label="Navigation de la recette"
      >
        <Button
          variant={section === 'recipe' ? 'primary' : 'secondary'}
          role="tab"
          aria-selected={section === 'recipe'}
          onClick={() => setSection('recipe')}
        >
          Mapping
        </Button>
        <Button
          variant={section === 'journal' ? 'primary' : 'secondary'}
          role="tab"
          aria-selected={section === 'journal'}
          onClick={() => setSection('journal')}
        >
          Journal
        </Button>
      </div>

      {section === 'journal' ? (
        <SectorsJournalView accessToken={accessToken} />
      ) : (
        <>
          {error ? (
            <p className="cleaner-sector-recipe__error" role="alert">
              {error}
            </p>
          ) : null}

          {state.truncated ? (
            <p className="cleaner-sector-recipe__truncated" role="status">
              Résultats partiels : affinez vos filtres.
            </p>
          ) : null}

          {state.obsoleteSectors.length === 0 ? (
            <GlassCard
              className="cleaner-sector-recipe__empty"
              role="status"
            >
              <div>
                <Tag variant="success">✓</Tag>
                <h3>
                  Aucun secteur obsolète — votre base est alignée sur la
                  nomenclature
                </h3>
              </div>
              <span>
                L’analyse est terminée : aucun compte ne nécessite de
                correction.
              </span>
            </GlassCard>
          ) : (
            <div className="cleaner-sector-recipe__workspace">
              <div
                className="cleaner-sector-recipe__list"
                aria-label="Secteurs à fusionner"
              >
                <div className="cleaner-sector-bulk-bar">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    label={
                      allSelected
                        ? 'Tout désélectionner'
                        : 'Tout sélectionner'
                    }
                    onChange={(checked) => {
                      setSelected(
                        checked
                          ? new Set(state.obsoleteSectors.map((item) => item.id))
                          : new Set(),
                      );
                    }}
                  />
                  <Button
                    disabled={
                      !state.capabilities.canApplyMerge ||
                      !selectedCount ||
                      jobBusy
                    }
                    onClick={() => setConfirmOpen(true)}
                  >
                    {jobBusy
                      ? `Fusion en cours ${job.processed}/${job.total}`
                      : `Fusionner ${selectedCount || ''} secteur${
                          selectedCount > 1 ? 's' : ''
                        }`.trim()}
                  </Button>
                  {jobBusy || job.total > 0 ? (
                    <div
                      className="cleaner-sector-job"
                      role="status"
                      aria-valuenow={job.processed}
                      aria-valuemin={0}
                      aria-valuemax={Math.max(job.total, 1)}
                    >
                      <span className="cleaner-sector-job__label">
                        {job.processed}/{job.total}{' '}
                        secteurs traités
                      </span>
                      <div
                        className="cleaner-sector-job__bar"
                        aria-hidden="true"
                      >
                        <span
                          className="cleaner-sector-job__bar-fill"
                          style={{
                            width: `${
                              job.total > 0
                                ? Math.min(
                                    100,
                                    (job.processed /
                                      job.total) *
                                      100,
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <ul className="cleaner-sector-recipe__rows">
                  {state.obsoleteSectors.map((sector) => (
                    <li
                      className="cleaner-sector-row"
                      key={sector.id}
                      data-active={selected.has(sector.id) ? 'true' : 'false'}
                    >
                      <Checkbox
                        aria-label={`Sélectionner ${sector.label}`}
                        checked={selected.has(sector.id)}
                        onChange={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(sector.id);
                            else next.delete(sector.id);
                            return next;
                          });
                        }}
                      />
                      <div className="cleaner-sector-row__source">
                        <Tag variant="warning">Obsolète</Tag>
                        <div>
                          <h3>{sector.label}</h3>
                          <span className="cleaner-sector-row__count">
                            <span className="cleaner-sector-row__count-badge">
                              {sector.accountCount}
                            </span>{' '}
                            compte{sector.accountCount > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <Select
                        aria-label={`Cible pour ${sector.label}`}
                        value={targets[sector.id] || ''}
                        options={[
                          { value: '', label: 'Choisir une cible' },
                          ...state.activeSectors.map((item) => ({
                            value: item.id,
                            label: item.label,
                          })),
                        ]}
                        onChange={(activeId) =>
                          setTargets((current) => ({
                            ...current,
                            [sector.id]: activeId,
                          }))
                        }
                      />
                      {sector.sampleAccounts?.length ? (
                        <details className="cleaner-sector-row__sample">
                          <summary>Voir 3 comptes concernés</summary>
                          <ul>
                            {sector.sampleAccounts.map((account) => (
                              <li key={account.id}>
                                <span>{account.name || account.id}</span>
                                <a href={account.recordUrl} target="_blank" rel="noopener noreferrer" className="cleaner-sector-row__sf-link">Salesforce ↗</a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={confirmOpen}
        title="Confirmer la fusion"
        onClose={() => setConfirmOpen(false)}
        secondaryAction={{
          label: 'Annuler',
          onClick: () => setConfirmOpen(false),
        }}
        primaryAction={{
          label: 'Fusionner',
          onClick: () => void runBulk(),
        }}
      >
        <p>
          {selectedCount} secteur{selectedCount > 1 ? 's' : ''} obsolète
          {selectedCount > 1 ? 's' : ''} vont être fusionnés vers{' '}
          {selectedTargets} secteur{selectedTargets > 1 ? 's' : ''} actif
          {selectedTargets > 1 ? 's' : ''}, modifiant {selectedAccounts}{' '}
          compte{selectedAccounts > 1 ? 's' : ''} au total.
        </p>
        <p className="cleaner-sector-modal__hint">
          Le serveur lance un dry-run sur chaque mapping avant toute écriture.
          Si un mapping est invalide, aucune modification n'est appliquée.
        </p>
      </Modal>

      <Modal
        open={result !== null && result.kind === 'success'}
        title="Fusion terminée"
        onClose={() => setResult(null)}
        primaryAction={{
          label: 'Fermer',
          onClick: () => setResult(null),
        }}
      >
        {result?.kind === 'success' ? (
          <>
            <p>
              {result.succeeded} fusion{result.succeeded === 1 ? '' : 's'}{' '}
              réussie{result.succeeded === 1 ? '' : 's'}.
            </p>
            <div className="cleaner-sector-before-after" aria-label="Avant après">
              <strong>Avant → après</strong>
              <ul>
                {result.mappings.map((mapping) => (
                  <li key={`${mapping.from}-${mapping.to}`}>
                    <span>{mapping.from}</span><span aria-hidden="true">→</span><strong>{mapping.to}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <button
              className="cleaner-sector-journal-link"
              type="button"
              onClick={() => {
                setResult(null);
                setSection('journal');
              }}
            >
              Voir le journal
            </button>
          </>
        ) : null}
      </Modal>

      <Modal
        open={result !== null && result.kind === 'failed'}
        title="Dry-run échoué — aucune modification appliquée"
        onClose={() => setResult(null)}
        primaryAction={{
          label: 'Fermer',
          onClick: () => setResult(null),
        }}
      >
        {result?.kind === 'failed' ? (
          <ul className="cleaner-sector-errors">
            {result.errors.map((err) => (
              <li key={err.obsoleteId}>
                <strong>{err.obsoleteId}</strong>
                <span>{err.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
    </section>
  );
}

export default SectorsRecipeView;
