import { useEffect, useState } from 'react';
import { GlassCard, Tag } from '../../../../../components/ui';
import { fetchSectorJournal, type SectorJournalEntry } from './api';

export function SectorsJournalView({ accessToken }: { accessToken?: string }) {
  const [items, setItems] = useState<SectorJournalEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    fetchSectorJournal(accessToken, 50).then(
      (next) => {
        if (!active) return;
        setItems(next);
        setStatus('ready');
      },
      (cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Journal indisponible.');
        setStatus('error');
      },
    );
    return () => { active = false; };
  }, [accessToken]);

  if (status === 'loading') return <div role="status">Chargement du journal…</div>;
  if (status === 'error') return <p role="alert" className="cleaner-sector-recipe__error">{error}</p>;
  if (!items.length)
    return <GlassCard role="status">Aucune fusion de secteurs n’a encore été journalisée.</GlassCard>;

  return (
    <ol className="cleaner-sector-journal" aria-label="Historique des fusions de secteurs">
      {items.map((entry) => (
        <li key={entry.id}>
          <div>
            <strong>{entry.obsoleteLabel || entry.obsoleteId} → {entry.activeLabel || entry.activeId}</strong>
            <span>par {entry.actorLabel}</span>
          </div>
          <div>
            <Tag variant="muted">{entry.accountCount} compte{entry.accountCount > 1 ? 's' : ''}</Tag>
            <time dateTime={entry.createdAt}>
              {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
