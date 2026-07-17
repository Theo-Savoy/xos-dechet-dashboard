import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type PicklistValue = {
  label: string;
  active: boolean;
  default: boolean;
};

type CacheEntry = {
  values: PicklistValue[];
  ts: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const picklistCache = new Map<string, CacheEntry>();
const PicklistAccessTokenContext = createContext<string | undefined>(
  undefined,
);

export function PicklistValuesProvider({
  accessToken,
  children,
}: {
  accessToken?: string;
  children: ReactNode;
}) {
  return createElement(
    PicklistAccessTokenContext.Provider,
    { value: accessToken },
    children,
  );
}

export function __resetPicklistValuesCache() {
  picklistCache.clear();
}

function cachedValues(field: string): PicklistValue[] | null {
  const cached = picklistCache.get(field);
  if (!cached) return null;
  if (Date.now() - cached.ts < CACHE_TTL_MS) return cached.values;
  picklistCache.delete(field);
  return null;
}

function parseValues(body: unknown): PicklistValue[] {
  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { values?: unknown }).values)
  ) {
    throw new Error('La réponse de la picklist est invalide.');
  }
  return (body as { values: unknown[] }).values
    .filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as { label?: unknown }).label === 'string',
    )
    .map((value) => ({
      label: value.label as string,
      active: value.active === true,
      default: value.default === true,
    }));
}

export function usePicklistValues(field: string): {
  values: PicklistValue[];
  loading: boolean;
  error: string | null;
} {
  const accessToken = useContext(PicklistAccessTokenContext);
  const initialValues = cachedValues(field);
  const [values, setValues] = useState<PicklistValue[]>(initialValues ?? []);
  const [loading, setLoading] = useState(initialValues === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const cached = cachedValues(field);
    if (cached) {
      setValues(cached);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setValues([]);
    setLoading(Boolean(field));
    setError(null);
    if (!field) return () => undefined;

    void (async () => {
      try {
        if (!accessToken) throw new Error('Session expirée.');
        const response = await fetch(
          `/api/crm/picklists?field=${encodeURIComponent(field)}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (!response.ok)
          throw new Error('Le chargement de la picklist a échoué.');
        const nextValues = parseValues(await response.json());
        picklistCache.set(field, { values: nextValues, ts: Date.now() });
        if (active) setValues(nextValues);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Le chargement de la picklist a échoué.',
          );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [accessToken, field]);

  return { values, loading, error };
}
