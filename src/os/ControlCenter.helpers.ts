export const NOTIFICATION_CLIENT_TTL_MS = 6 * 60 * 1000;
export const REALTIME_EVENT_TTL_MS = 60 * 1000;

export function shouldPollNotifications(
  realtimeHealthy: boolean,
  realtimeLastEventAt: number | null,
  now = Date.now(),
): boolean {
  return (
    !realtimeHealthy ||
    realtimeLastEventAt === null ||
    now - realtimeLastEventAt >= REALTIME_EVENT_TTL_MS
  );
}
