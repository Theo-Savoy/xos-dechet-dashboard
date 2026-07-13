import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, GlassCard, Modal, Select, Tag } from '../../../../../components/ui';
import type { CleanerModuleProps } from '../../../shell/moduleRegistry';
import { useRecetteJob } from '../recetteJobStore';
import {
  applySectorMerge,
  bulkApplySectors,
  bulkPreviewSectors,
  fetchSectorRecipe,
  getSectorJobStatus,
  previewSectorMerge,
  type SectorMergePreview,
  type SectorRecipeState,
} from './api';
import { SectorsJournalView } from './SectorsJournalView';

type ConfirmState =
  | { kind: 'single'; sector: SectorRecipeState['obsoleteSectors'][number] }
  | { kind: 'bulk' }
  | null;

export function SectorsRecipeView({ accessToken }: CleanerModuleProps) {
  const [state, setState] = useState<SectorRecipeState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SectorMergePreview | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [bulkPreviewConfirmed, setBulkPreviewConfirmed] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'mapping'>('list');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [section, setSection] = useState<'recipe' | 'journal'>('recipe');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [runningAction, setRunningAction] = useState<'preview' | 'apply' | null>(null);
  const [success, setSuccess] = useState<{ succeeded: number; failed: number } | null>(null);
  const job = useRecetteJob();

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
      setError(cause instanceof Error ? cause.message : 'La recette Secteurs est indisponible.');
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!runningAction) return;
    if (job.status === 'error') {
      setError(job.error || 'Le traitement groupé a échoué.');
      setRunningAction(null);
    } else if (job.status === 'done' && runningAction === 'preview') {
      setBulkPreviewConfirmed(job.progress.errors.length === 0);
      setRunningAction(null);
    } else if (job.status === 'done' && runningAction === 'apply') {
      setSuccess({
        succeeded: job.progress.total - job.progress.errors.length,
        failed: job.progress.errors.length,
      });
      setBulkPreviewConfirmed(false);
      setRunningAction(null);
      void load();
    }
  }, [job.error, job.progress.errors.length, job.progress.total, job.status, load, runningAction]);

  const affectedAccounts = useMemo(() => state?.obsoleteSectors.reduce((sum, item) => sum + item.accountCount, 0) || 0, [state]);
  const usedActiveSectors = useMemo(() => state?.activeSectors.filter((item) => item.accountCount > 0) || [], [state]);
  const analyzedAccountCount = useMemo(() => (state?.activeSectors.reduce((sum, item) => sum + item.accountCount, 0) || 0) + affectedAccounts, [affectedAccounts, state]);
  const selectedMapping = useMemo(() => Object.fromEntries(
    [...selected].filter((id) => targets[id]).map((id) => [id, targets[id]]),
  ), [selected, targets]);
  const selectedCount = Object.keys(selectedMapping).length;
  const selectedAccounts = useMemo(() => state?.obsoleteSectors
    .filter((item) => selected.has(item.id) && targets[item.id])
    .reduce((sum, item) => sum + item.accountCount, 0) || 0, [selected, state, targets]);
  const selectedTargets = new Set(Object.values(selectedMapping)).size;
  const jobBusy = job.status === 'pending' || job.status === 'running';

  const invalidateBulkPreview = () => {
    setBulkPreviewConfirmed(false);
    if (!jobBusy) job.reset();
  };

  const askPreview = async (obsoleteId: string) => {
    const activeId = targets[obsoleteId];
    if (!activeId) return;
    setWorkingId(obsoleteId);
    setError(null);
    setPreviewConfirmed(false);
    try {
      setPreview(await previewSectorMerge(accessToken, obsoleteId, activeId));
      setDrawerOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview indisponible.');
    } finally { setWorkingId(null); }
  };

  const runBulk = async (kind: 'preview' | 'apply') => {
    setError(null);
    const result = kind === 'preview'
      ? await bulkPreviewSectors(accessToken, selectedMapping)
      : await bulkApplySectors(accessToken, selectedMapping);
    setRunningAction(kind);
    await job.start(result.jobId, () => getSectorJobStatus(accessToken, result.jobId));
  };

  const applySingle = async (sector: SectorRecipeState['obsoleteSectors'][number]) => {
    const activeId = targets[sector.id];
    if (!preview || preview.obsoleteId !== sector.id || preview.activeId !== activeId) return;
    setConfirm(null);
    setWorkingId(sector.id);
    try {
      const result = await applySectorMerge(accessToken, sector.id, activeId, preview.accountIds);
      setSuccess({ succeeded: result.updated, failed: result.failed });
      setPreview(null);
      setPreviewConfirmed(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La fusion a échoué.');
    } finally { setWorkingId(null); }
  };

  if (status === 'loading' && !state) return <div role="status">Analyse des secteurs des comptes…</div>;
  if (status === 'error' && !state) return <div role="alert">{error}</div>;
  if (!state) return null;

  const allSelected = state.obsoleteSectors.length > 0 && state.obsoleteSectors.every((item) => selected.has(item.id));

  return (
    <section className="cleaner-sector-recipe" aria-labelledby="sector-recipe-title">
      <div className="cleaner-sector-recipe__intro">
        <div>
          <p className="cleaner-eyebrow">Recette · Account</p>
          <h2 id="sector-recipe-title">Secteurs obsolètes</h2>
          <p>Remplacez les anciennes valeurs par les 50 secteurs canoniques, après contrôle des comptes concernés.</p>
        </div>
        <Tag variant={state.capabilities.canApplyMerge ? 'accent' : 'muted'}>
          {state.capabilities.canApplyMerge ? 'Fusion autorisée' : 'Prévisualisation seule'}
        </Tag>
      </div>

      <div className="cleaner-sector-tabs" role="tablist" aria-label="Navigation de la recette">
        <Button variant={section === 'recipe' ? 'primary' : 'secondary'} role="tab" aria-selected={section === 'recipe'} onClick={() => setSection('recipe')}>Mapping</Button>
        <Button variant={section === 'journal' ? 'primary' : 'secondary'} role="tab" aria-selected={section === 'journal'} onClick={() => setSection('journal')}>Journal</Button>
      </div>

      {section === 'journal' ? <SectorsJournalView accessToken={accessToken} /> : (
        <>
          <div className="cleaner-sector-recipe__kpis" aria-label="Indicateurs de la recette">
            {[['Secteurs obsolètes', state.obsoleteSectors.length], ['Comptes concernés', affectedAccounts], ['Secteurs actifs', state.activeSectors.length]].map(([label, value]) => (
              <GlassCard key={label} data-testid="sector-recipe-kpi"><strong>{value}</strong><span>{label}</span></GlassCard>
            ))}
          </div>
          {error ? <p className="cleaner-sector-recipe__error" role="alert">{error}</p> : null}

          {state.obsoleteSectors.length === 0 ? (
            <GlassCard className="cleaner-sector-recipe__empty" role="status">
              <div><Tag variant="success">✓</Tag><h3>Aucun secteur obsolète — votre base est alignée sur la nomenclature</h3></div>
              <span>Aucun secteur obsolète détecté. L’analyse est terminée : aucun compte ne nécessite de correction.</span>
              <div className="cleaner-sector-empty-stats" role="list">
                {[`${usedActiveSectors.length} secteurs distincts utilisés`, `${state.activeSectors.length} secteurs canoniques disponibles`, `${analyzedAccountCount} comptes analysés`].map((item) => <span role="listitem" key={item}>{item}</span>)}
              </div>
              <details data-testid="used-sectors-disclosure"><summary>Voir la liste des secteurs utilisés</summary>
                <ul>{usedActiveSectors.map((sector) => <li key={sector.id}>{sector.label} — {sector.accountCount} compte{sector.accountCount > 1 ? 's' : ''}</li>)}</ul>
              </details>
            </GlassCard>
          ) : (
            <div className={`cleaner-sector-recipe__workspace${drawerOpen ? '' : ' cleaner-sector-recipe__workspace--wide'}`}>
              <div className="cleaner-sector-recipe__list" aria-label="Secteurs à fusionner">
                <div className="cleaner-sector-bulk-bar">
                  <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} label={allSelected ? 'Tout désélectionner' : 'Tout sélectionner'} onChange={(checked) => {
                    setSelected(checked ? new Set(state.obsoleteSectors.map((item) => item.id)) : new Set());
                    invalidateBulkPreview();
                  }} />
                  <div className="cleaner-sector-view-toggle" role="group" aria-label="Mode d’affichage">
                    <Button variant={viewMode === 'list' ? 'primary' : 'secondary'} onClick={() => setViewMode('list')}>Liste</Button>
                    <Button variant={viewMode === 'mapping' ? 'primary' : 'secondary'} onClick={() => setViewMode('mapping')}>Mapping</Button>
                  </div>
                  <Button variant="secondary" disabled={!selectedCount || jobBusy} onClick={() => void runBulk('preview')}>Bulk preview</Button>
                  <Button disabled={!state.capabilities.canApplyMerge || !bulkPreviewConfirmed || jobBusy} onClick={() => setConfirm({ kind: 'bulk' })}>Bulk apply</Button>
                  <button className="cleaner-sector-drawer-toggle" type="button" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((value) => !value)}>{drawerOpen ? 'Masquer l’aperçu' : 'Afficher l’aperçu'}</button>
                  {jobBusy || job.status === 'done' ? (
                    <div className="cleaner-sector-job" role="status">
                      <span>{job.progress.processed}/{job.progress.total} secteurs traités</span>
                      <progress value={job.progress.processed} max={Math.max(job.progress.total, 1)} />
                    </div>
                  ) : null}
                </div>

                <div className={viewMode === 'mapping' ? 'cleaner-sector-mapping-grid' : ''}>
                  {state.obsoleteSectors.map((sector) => {
                    const target = targets[sector.id] || '';
                    const previewMatches = preview?.obsoleteId === sector.id && preview.activeId === target;
                    return (
                      <article className={`cleaner-sector-row cleaner-sector-row--${viewMode}`} key={sector.id}>
                        <Checkbox aria-label={`Sélectionner ${sector.label}`} checked={selected.has(sector.id)} onChange={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(sector.id);
                            else next.delete(sector.id);
                            return next;
                          });
                          invalidateBulkPreview();
                        }} />
                        <div className="cleaner-sector-row__source"><Tag variant="warning">Obsolète</Tag><div><h3>{sector.label}</h3><span className="cleaner-sector-row__count"><span className="cleaner-sector-row__count-badge">{sector.accountCount}</span> compte{sector.accountCount > 1 ? 's' : ''}</span></div></div>
                        <Select aria-label={`Cible pour ${sector.label}`} value={target} options={[{ value: '', label: 'Choisir une cible' }, ...state.activeSectors.map((item) => ({ value: item.id, label: item.label }))]} onChange={(activeId) => {
                          setTargets((current) => ({ ...current, [sector.id]: activeId }));
                          if (preview?.obsoleteId === sector.id) { setPreview(null); setPreviewConfirmed(false); }
                          invalidateBulkPreview();
                        }} />
                        {viewMode === 'list' ? <div className="cleaner-sector-row__actions">
                          <Button variant="secondary" aria-label={`Prévisualiser ${sector.label}`} disabled={!target || workingId === sector.id} onClick={() => void askPreview(sector.id)}>Preview</Button>
                          <Button aria-label={`Appliquer ${sector.label}`} disabled={!state.capabilities.canApplyMerge || !previewMatches || !previewConfirmed || workingId === sector.id} onClick={() => setConfirm({ kind: 'single', sector })}>Apply</Button>
                        </div> : null}
                      </article>
                    );
                  })}
                </div>
              </div>

              {drawerOpen ? <aside className="cleaner-sector-preview" aria-label="Aperçu de la fusion">
                {preview ? <><div className="cleaner-sector-preview__head"><p className="cleaner-eyebrow">Aperçu</p><h3>{preview.obsoleteLabel} → {preview.activeLabel}</h3><p>{preview.accountCount} compte{preview.accountCount > 1 ? 's' : ''} seront modifiés.</p></div>
                  <ul className="cleaner-sector-preview__accounts">{preview.accounts.map((account) => <li key={account.id}><strong>{account.name || account.id}</strong><span>{account.id}</span></li>)}</ul>
                  <div className="cleaner-sector-preview__confirm"><Button onClick={() => setPreviewConfirmed(true)} disabled={previewConfirmed}>{previewConfirmed ? 'Aperçu confirmé' : "Confirmer l'aperçu"}</Button></div>
                </> : <div className="cleaner-sector-preview__placeholder"><span>⌁</span><p>Choisissez une cible puis lancez le preview.</p></div>}
              </aside> : null}
            </div>
          )}
        </>
      )}

      <Modal open={confirm !== null} title={confirm?.kind === 'bulk' ? 'Confirmer la fusion groupée' : 'Confirmer la fusion'} onClose={() => setConfirm(null)}
        secondaryAction={{ label: 'Annuler', onClick: () => setConfirm(null) }}
        primaryAction={{ label: 'Appliquer', onClick: () => {
          if (confirm?.kind === 'single') void applySingle(confirm.sector);
          else if (confirm?.kind === 'bulk') { setConfirm(null); void runBulk('apply'); }
        } }}>
        {confirm?.kind === 'bulk'
          ? <p>Vous allez fusionner {selectedCount} secteurs obsolètes vers {selectedTargets} secteurs actifs, modifiant {selectedAccounts} comptes au total. Confirmer ?</p>
          : confirm?.kind === 'single' && preview
            ? <p>Vous allez remplacer {preview.accountCount} comptes du secteur {preview.obsoleteLabel} par {preview.activeLabel}. Confirmer ?</p>
            : null}
      </Modal>

      <Modal open={success !== null} title="Fusion terminée" onClose={() => setSuccess(null)} primaryAction={{ label: 'Fermer', onClick: () => setSuccess(null) }}>
        <p>{success?.succeeded} fusion{success?.succeeded === 1 ? '' : 's'} réussie{success?.succeeded === 1 ? '' : 's'}, {success?.failed} échec{success?.failed === 1 ? '' : 's'}.</p>
        <button className="cleaner-sector-journal-link" type="button" onClick={() => { setSuccess(null); setSection('journal'); }}>Voir le journal</button>
      </Modal>
    </section>
  );
}

export default SectorsRecipeView;
