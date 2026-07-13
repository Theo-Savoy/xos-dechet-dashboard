import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
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
  setNotifications: (notifications: UserNotification[]) => void;
  bursts: FloatingReactionBurst[];
  addBurst: (burst: AddBurstInput) => string;
  removeBurst: (id: string) => void;
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
  const [controlCenterOpenRequest, setControlCenterOpenRequest] = useState(0);

  const addBurstToStore = useCallback((input: AddBurstInput) => {
    const burst = { id: input.id ?? createBurstId(), emoji: input.emoji };
    setBursts((previous) => addBurst(previous, burst));
    return burst.id;
  }, []);

  const removeBurst = useCallback((id: string) => {
    setBursts((previous) => previous.filter((burst) => burst.id !== id));
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
      removeBurst,
      controlCenterOpenRequest,
      requestOpenControlCenter,
    }),
    [
      notifications,
      bursts,
      addBurstToStore,
      removeBurst,
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
