import { apiFetch } from '../lib/apiClient';

export type UserNotification = {
  id: number;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  /** Present on Supabase Realtime rows; omitted by the notifications API. */
  recipient_id?: string;
};

export function reactionEmoji(item: UserNotification): string | null {
  if (item.kind !== 'goal_reaction') return null;
  const fromPayload =
    typeof item.payload?.emoji === 'string' ? item.payload.emoji : null;
  if (fromPayload) return fromPayload;
  return item.body?.trim() || null;
}

export async function fetchNotifications(
  token: string,
  sinceIso?: string,
): Promise<{ notifications: UserNotification[]; unread_count: number }> {
  const sinceParam = sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : '';
  return apiFetch<{ notifications: UserNotification[]; unread_count: number }>(
    token,
    `/api/notifications?limit=40${sinceParam}`,
  );
}

export async function markNotificationsRead(
  token: string,
  opts: { ids?: number[]; all?: boolean },
): Promise<void> {
  await apiFetch(token, '/api/notifications', {
    method: 'POST',
    body: JSON.stringify({
      action: 'mark_read',
      ...(opts.all ? { all: true } : { ids: opts.ids ?? [] }),
    }),
  });
}

const QUICK_REACTION_EMOJIS = ['👏', '🔥', '💪'] as const;
const PICKER_REACTION_EMOJIS = ['🎉', '🥳', '🙌', '💯', '⭐'] as const;
const GOAL_REACTION_EMOJIS = [
  ...QUICK_REACTION_EMOJIS,
  ...PICKER_REACTION_EMOJIS,
] as const;
export type GoalReactionEmoji = (typeof GOAL_REACTION_EMOJIS)[number];
export {
  GOAL_REACTION_EMOJIS,
  PICKER_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
};

export async function reactToNotification(
  token: string,
  notificationId: number,
  emoji: GoalReactionEmoji,
): Promise<void> {
  await apiFetch(token, '/api/notifications', {
    method: 'POST',
    body: JSON.stringify({
      action: 'react',
      notification_id: notificationId,
      emoji,
    }),
  });
}
