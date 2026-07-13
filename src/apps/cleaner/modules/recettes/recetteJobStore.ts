import {
  createContext,
  createElement,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type RecetteJobStatus = 'idle' | 'pending' | 'running' | 'done' | 'error';
export type RecetteJobError = { obsoleteId: string; message: string };
export type RecetteJobSnapshot = {
  status: Exclude<RecetteJobStatus, 'idle'>;
  total: number;
  processed: number;
  errors: RecetteJobError[];
  results?: unknown[];
  error?: string | null;
};
export type RecetteJobPoller = () => Promise<RecetteJobSnapshot>;

type RecetteJobContextValue = {
  jobId: string | null;
  status: RecetteJobStatus;
  progress: {
    total: number;
    processed: number;
    errors: RecetteJobError[];
    results: unknown[];
  };
  error: string | null;
  start: (jobId: string, poll: RecetteJobPoller) => Promise<void>;
  reset: () => void;
};

const RecetteJobContext = createContext<RecetteJobContextValue | null>(null);

export function RecetteJobProvider({
  children,
  pollInterval = 2000,
}: PropsWithChildren<{ pollInterval?: number }>) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<RecetteJobStatus>('idle');
  const [progress, setProgress] = useState({
    total: 0,
    processed: 0,
    errors: [] as RecetteJobError[],
    results: [] as unknown[],
  });
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    clearTimer();
    setJobId(null);
    setStatus('idle');
    setProgress({ total: 0, processed: 0, errors: [], results: [] });
    setError(null);
  }, [clearTimer]);

  const start = useCallback(
    async (nextJobId: string, poll: RecetteJobPoller) => {
      generation.current += 1;
      const currentGeneration = generation.current;
      clearTimer();
      setJobId(nextJobId);
      setStatus('pending');
      setProgress({ total: 0, processed: 0, errors: [], results: [] });
      setError(null);
      const tick = async () => {
        try {
          const snapshot = await poll();
          if (generation.current !== currentGeneration) return;
          setStatus(snapshot.status);
          setProgress({
            total: snapshot.total,
            processed: snapshot.processed,
            errors: snapshot.errors || [],
            results: snapshot.results || [],
          });
          setError(snapshot.error || null);
          if (snapshot.status === 'pending' || snapshot.status === 'running')
            timer.current = setTimeout(() => void tick(), pollInterval);
        } catch (cause) {
          if (generation.current !== currentGeneration) return;
          setStatus('error');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };
      await tick();
    },
    [clearTimer, pollInterval],
  );

  useEffect(
    () => () => {
      generation.current += 1;
      clearTimer();
    },
    [clearTimer],
  );

  return createElement(
    RecetteJobContext.Provider,
    { value: { jobId, status, progress, error, start, reset } },
    children,
  );
}

export function useRecetteJob() {
  const value = useContext(RecetteJobContext);
  if (!value)
    throw new Error('useRecetteJob must be used within RecetteJobProvider.');
  return value;
}
