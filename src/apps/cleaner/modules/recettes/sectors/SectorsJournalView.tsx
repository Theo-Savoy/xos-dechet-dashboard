import { useCallback, useEffect, useState } from 'react';
import { Button, GlassCard, Tag } from '../../../../../components/ui';
import {
  fetchSectorJournal,
  undoSectorMergeApi,
  type SectorJournalEntry,
} from './api';

export function SectorsJournalView({ accessToken }: { accessToken?: string }) {
  const [items, setItems] = useState<SectorJournalEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<number | string | null>(null);
  const [undoResult, setUndoResult] = useState<{ restored: number } | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setItems(await fetchSectorJournal(accessToken, 50));
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Journal indisponible.');
      setStatus('error');
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const undo = async (entry: SectorJournalEntry) => {
    setUndoing(entry.id);
    try {
      const result = await undoSectorMergeApi(accessToken, entry.id);
      setUndoResult({ restored: result.restored });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'annulation a échoué.");
    } finally {
      setUndoing(null);
    }
  };

  if (status === 'loading') return <div role="status">Chargement du journal…</div>;
  if (status === 'error') return <p role="alert" className="cleaner-sector-recipe__error">{error}</p>;
  if (!items.length) return <GlassCard role="status">Aucune fusion de secteurs n'a encore été journalisée.</GlassCard>;

  return (
    <ol className="cleaner-sector-journal" aria-label="Historique des fusions de secteurs">
      {undoResult ? <GlassCard className="cleaner-sector-journal__undo-result"><Tag variant="success">✓</Tag>Annulation terminée : {undoResult.restored} compte{undoResult.restored > 1 ? 's' : ''} restauré{undoResult.restored > 1 ? 's' : ''}.</GlassCard> : null}
      {items.map((entry) => {
        const merge = entry.kind === 'recette_sectors_apply_merge';
        return (
          <li key={entry.id} className="cleaner-sector-journal__item">
            <div className="cleaner-sector-journal__head">
              <strong>{entry.obsoleteLabel || entry.obsoleteId} → {entry.activeLabel || entry.activeId}</strong>
              <span>par {entry.actorLabel}</span>
            </div>
            <div className="cleaner-sector-journal__meta">
              <Tag variant="muted">{entry.accountCount} compte{entry.accountCount > 1 ? 's' : ''}</Tag>
              <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</time>
              {merge ? <Button variant="secondary" disabled={undoing === entry.id} onClick={() => void undo(entry)}>{undoing === entry.id ? 'Annulation…' : 'Annuler la fusion'}</Button> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default SectorsJournalView;
