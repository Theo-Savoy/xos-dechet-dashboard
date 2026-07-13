import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, GlassCard, Select, Tag } from '../../../../../components/ui';
import type { CleanerModuleProps } from '../../../shell/moduleRegistry';
import {
  applySectorMerge,
  fetchSectorRecipe,
  previewSectorMerge,
  type SectorMergePreview,
  type SectorRecipeState,
} from './api';

export function SectorsRecipeView({ accessToken }: CleanerModuleProps) {
  const [state, setState] = useState<SectorRecipeState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SectorMergePreview | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const next = await fetchSectorRecipe(accessToken);
      setState(next);
      setTargets(next.suggestedMappings || {});
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

  const affectedAccounts = useMemo(
    () =>
      state?.obsoleteSectors.reduce(
        (total, sector) => total + sector.accountCount,
        0,
      ) || 0,
    [state],
  );

  const askPreview = async (obsoleteId: string) => {
    const activeId = targets[obsoleteId];
    if (!activeId) return;
    setWorkingId(obsoleteId);
    setError(null);
    setPreview(null);
    setPreviewConfirmed(false);
    try {
      setPreview(await previewSectorMerge(accessToken, obsoleteId, activeId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Preview indisponible.',
      );
    } finally {
      setWorkingId(null);
    }
  };

  const apply = async (
    sector: SectorRecipeState['obsoleteSectors'][number],
  ) => {
    const activeId = targets[sector.id];
    const active = state?.activeSectors.find((item) => item.id === activeId);
    if (
      !active ||
      !previewConfirmed ||
      preview?.obsoleteId !== sector.id ||
      preview.activeId !== activeId
    )
      return;
    const confirmed = window.confirm(
      `Vous allez remplacer ${preview.accountCount} comptes du secteur ${sector.label} par ${active.label}. Continuer ?`,
    );
    if (!confirmed) return;
    setWorkingId(sector.id);
    setError(null);
    try {
      const result = await applySectorMerge(
        accessToken,
        sector.id,
        activeId,
        preview.accountIds,
      );
      setToast(
        `${result.updated} compte${result.updated > 1 ? 's' : ''} mis à jour`,
      );
      setPreview(null);
      setPreviewConfirmed(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La fusion a échoué.');
    } finally {
      setWorkingId(null);
    }
  };

  if (status === 'loading' && !state)
    return <div role="status">Analyse des secteurs des comptes…</div>;
  if (status === 'error' && !state) return <div role="alert">{error}</div>;
  if (!state) return null;

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
            Remplacez les anciennes valeurs par les 50 secteurs canoniques,
            après contrôle des comptes concernés.
          </p>
        </div>
        <Tag variant={state.capabilities.canApplyMerge ? 'accent' : 'muted'}>
          {state.capabilities.canApplyMerge
            ? 'Fusion autorisée'
            : 'Prévisualisation seule'}
        </Tag>
      </div>

      <div
        className="cleaner-sector-recipe__kpis"
        aria-label="Indicateurs de la recette"
      >
        {[
          ['Secteurs obsolètes', state.obsoleteSectors.length],
          ['Comptes concernés', affectedAccounts],
          ['Secteurs actifs', state.activeSectors.length],
        ].map(([label, value]) => (
          <GlassCard key={label} data-testid="sector-recipe-kpi">
            <strong>{value}</strong>
            <span>{label}</span>
          </GlassCard>
        ))}
      </div>

      {error ? (
        <p className="cleaner-sector-recipe__error" role="alert">
          {error}
        </p>
      ) : null}
      {toast ? (
        <div className="cleaner-sector-recipe__toast" role="status">
          ✓ {toast}
        </div>
      ) : null}

      {state.obsoleteSectors.length === 0 ? (
        <GlassCard className="cleaner-sector-recipe__empty" role="status">
          <strong>Aucun secteur obsolète détecté</strong>
          <span>
            Les comptes de votre périmètre utilisent la liste canonique.
          </span>
        </GlassCard>
      ) : (
        <div className="cleaner-sector-recipe__workspace">
          <div
            className="cleaner-sector-recipe__list"
            aria-label="Secteurs à fusionner"
          >
            {state.obsoleteSectors.map((sector) => {
              const target = targets[sector.id] || '';
              const previewMatches =
                preview?.obsoleteId === sector.id &&
                preview.activeId === target;
              return (
                <article className="cleaner-sector-row" key={sector.id}>
                  <div className="cleaner-sector-row__source">
                    <Tag variant="warning">Obsolète</Tag>
                    <div>
                      <h3>{sector.label}</h3>
                      <span>
                        {sector.accountCount} compte
                        {sector.accountCount > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <Select
                    aria-label={`Cible pour ${sector.label}`}
                    value={target}
                    options={[
                      { value: '', label: 'Choisir une cible' },
                      ...state.activeSectors.map((item) => ({
                        value: item.id,
                        label: item.label,
                      })),
                    ]}
                    onChange={(activeId) => {
                      setTargets((current) => ({
                        ...current,
                        [sector.id]: activeId,
                      }));
                      if (preview?.obsoleteId === sector.id) {
                        setPreview(null);
                        setPreviewConfirmed(false);
                      }
                    }}
                  />
                  <div className="cleaner-sector-row__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label={`Prévisualiser ${sector.label}`}
                      disabled={!target || workingId === sector.id}
                      onClick={() => void askPreview(sector.id)}
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      aria-label={`Appliquer ${sector.label}`}
                      disabled={
                        !state.capabilities.canApplyMerge ||
                        !target ||
                        !previewMatches ||
                        !previewConfirmed ||
                        workingId === sector.id
                      }
                      onClick={() => void apply(sector)}
                    >
                      Apply
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <aside
            className="cleaner-sector-preview"
            aria-label="Preview de fusion"
          >
            {preview ? (
              <>
                <p className="cleaner-eyebrow">Impact avant écriture</p>
                <h3>
                  {preview.obsoleteLabel} → {preview.activeLabel}
                </h3>
                <p>{preview.accountCount} comptes seront modifiés.</p>
                <ul>
                  {preview.accounts.map((account) => (
                    <li key={account.id}>
                      <strong>{account.name || account.id}</strong>
                      <span>{account.id}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPreviewConfirmed(true)}
                  disabled={previewConfirmed}
                >
                  {previewConfirmed
                    ? 'Preview confirmé'
                    : 'Confirmer ce preview'}
                </Button>
              </>
            ) : (
              <div className="cleaner-sector-preview__placeholder">
                <span aria-hidden="true">⌁</span>
                <p>Choisissez une cible puis lancez le preview.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

export default SectorsRecipeView;
