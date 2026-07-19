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

/** Kinds célébratoires Combo (spec combo-gamification-v1.md §3.1) — reçus via /api/notifications, jamais émis ici. */
export type GamificationToastKind =
  | 'xp_palier_atteint'
  | 'badge_one_timer'
  | 'streak_palier_atteint';

export const GAMIFICATION_TOAST_KINDS: readonly GamificationToastKind[] = [
  'xp_palier_atteint',
  'badge_one_timer',
  'streak_palier_atteint',
];

export function isGamificationToastKind(
  kind: string,
): kind is GamificationToastKind {
  return (GAMIFICATION_TOAST_KINDS as readonly string[]).includes(kind);
}

export const GAMIFICATION_TOAST_EMOJI: Record<GamificationToastKind, string> =
  {
    xp_palier_atteint: '📈',
    badge_one_timer: '🏅',
    streak_palier_atteint: '🔥',
  };

export const GAMIFICATION_TOAST_LABEL: Record<GamificationToastKind, string> =
  {
    xp_palier_atteint: 'Palier',
    badge_one_timer: 'Badge',
    streak_palier_atteint: 'Streak',
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
