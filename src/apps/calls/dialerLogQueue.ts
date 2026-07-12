/**
 * File FIFO pour les écritures Salesforce du dialer.
 * Garantit qu'un log rapide n'annule / n'écrase pas le précédent :
 * chaque tâche s'exécute après la précédente, même en cas d'erreur.
 */

export type DialerLogQueue = {
  /** Enfile une tâche ; retourne immédiatement (UI non bloquée). */
  enqueue: (task: () => Promise<void>) => void;
  /** Nombre de tâches en cours ou en attente. */
  getPending: () => number;
  /** Résout quand la file est vide. */
  whenIdle: () => Promise<void>;
};

export function createDialerLogQueue(
  onPendingChange?: (pending: number) => void,
): DialerLogQueue {
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;

  const bump = (delta: number) => {
    pending = Math.max(0, pending + delta);
    onPendingChange?.(pending);
  };

  return {
    enqueue(task) {
      bump(1);
      chain = chain
        .catch(() => {
          /* une erreur amont ne doit pas stopper la file */
        })
        .then(async () => {
          try {
            await task();
          } catch {
            /* la tâche gère rollback / erreur UI ; la file continue */
          } finally {
            bump(-1);
          }
        });
    },
    getPending: () => pending,
    whenIdle: () =>
      chain.then(() => undefined).catch(() => undefined),
  };
}
