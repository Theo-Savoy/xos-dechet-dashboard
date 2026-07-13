import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { UserNotification } from './notifications';

export type FloatingReactionBurst = {
  id: string;
  emoji: string;
};

export type AddBurstInput = {
  id?: string;
  emoji: string;
};

export const MAX_BURSTS = 6;

export function addBurst(
  bursts: FloatingReactionBurst[],
  burst: FloatingReactionBurst,
): FloatingReactionBurst[] {
  if (bursts.some((existing) => existing.id === burst.id)) return bursts;
  return [...bursts, burst].slice(-MAX_BURSTS);
}

/** Adds a burst originating from this user's own click. */
export function addLocalBurst(
  bursts: FloatingReactionBurst[],
  burst: FloatingReactionBurst,
): FloatingReactionBurst[] {
  return addBurst(bursts, burst);
}

function createBurstId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `burst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type NotificationsStoreValue = {
  notifications: UserNotification[];
  setNotifications: Dispatch<SetStateAction<UserNotification[]>>;
  bursts: FloatingReactionBurst[];
  addBurst: (burst: AddBurstInput) => string;
  addLocalBurst: (burst: AddBurstInput) => string;
  removeBurst: (id: string) => void;
  reactedAt: Record<number, number>;
  markReacted: (id: number, at?: number) => void;
  realtimeHealthy: boolean;
  realtimeLastEventAt: number | null;
  setRealtimeHealthy: (healthy: boolean) => void;
  markRealtimeEvent: (at?: number) => void;
  controlCenterOpenRequest: number;
  requestOpenControlCenter: () => void;
};

const NotificationsStoreContext = createContext<NotificationsStoreValue | null>(
  null,
);

type NotificationsProviderProps = {
  children: ReactNode;
  initialNotifications?: UserNotification[];
};

export function NotificationsProvider({
  children,
  initialNotifications = [],
}: NotificationsProviderProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [bursts, setBursts] = useState<FloatingReactionBurst[]>([]);
  const [reactedAt, setReactedAt] = useState<Record<number, number>>({});
  const [realtimeHealthy, setRealtimeHealthy] = useState(false);
  const [realtimeLastEventAt, setRealtimeLastEventAt] = useState<number | null>(
    null,
  );
  const [controlCenterOpenRequest, setControlCenterOpenRequest] = useState(0);

  const addBurstToStore = useCallback((input: AddBurstInput) => {
    const burst = { id: input.id ?? createBurstId(), emoji: input.emoji };
    setBursts((previous) => addBurst(previous, burst));
    return burst.id;
  }, []);

  const addLocalBurstToStore = useCallback((input: AddBurstInput) => {
    const burst = { id: input.id ?? createBurstId(), emoji: input.emoji };
    setBursts((previous) => addLocalBurst(previous, burst));
    return burst.id;
  }, []);

  const removeBurst = useCallback((id: string) => {
    setBursts((previous) => previous.filter((burst) => burst.id !== id));
  }, []);

  const markReacted = useCallback((id: number, at = Date.now()) => {
    setReactedAt((previous) =>
      previous[id] !== undefined ? previous : { ...previous, [id]: at },
    );
  }, []);

  const setRealtimeHealthyState = useCallback((healthy: boolean) => {
    setRealtimeHealthy(healthy);
    if (!healthy) setRealtimeLastEventAt(null);
  }, []);

  const markRealtimeEvent = useCallback((at = Date.now()) => {
    setRealtimeHealthy(true);
    setRealtimeLastEventAt(at);
  }, []);

  const requestOpenControlCenter = useCallback(() => {
    setControlCenterOpenRequest((request) => request + 1);
  }, []);

  const value = useMemo<NotificationsStoreValue>(
    () => ({
      notifications,
      setNotifications,
      bursts,
      addBurst: addBurstToStore,
      addLocalBurst: addLocalBurstToStore,
      removeBurst,
      reactedAt,
      markReacted,
      realtimeHealthy,
      realtimeLastEventAt,
      setRealtimeHealthy: setRealtimeHealthyState,
      markRealtimeEvent,
      controlCenterOpenRequest,
      requestOpenControlCenter,
    }),
    [
      notifications,
      bursts,
      addBurstToStore,
      addLocalBurstToStore,
      removeBurst,
      reactedAt,
      markReacted,
      realtimeHealthy,
      realtimeLastEventAt,
      setRealtimeHealthyState,
      markRealtimeEvent,
      controlCenterOpenRequest,
      requestOpenControlCenter,
    ],
  );

  return createElement(NotificationsStoreContext.Provider, { value }, children);
}

export function useNotificationsStore(): NotificationsStoreValue {
  const value = useContext(NotificationsStoreContext);
  if (!value)
    throw new Error(
      'useNotificationsStore must be used inside NotificationsProvider',
    );
  return value;
}
