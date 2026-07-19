import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAMIFICATION_TOAST_KINDS,
  GOAL_REACTION_EMOJIS,
  PICKER_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
  fetchNotifications,
  isGamificationToastKind,
} from './notifications';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notifications: [], unread_count: 0 }), {
        status: 200,
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('goal reaction palette', () => {
  it('contains the quick, picker, and combined emoji palettes', () => {
    expect(QUICK_REACTION_EMOJIS).toEqual(['👏', '🔥', '💪']);
    expect(PICKER_REACTION_EMOJIS).toEqual(['🎉', '🥳', '🙌', '💯', '⭐']);
    expect(GOAL_REACTION_EMOJIS).toEqual([
      '👏',
      '🔥',
      '💪',
      '🎉',
      '🥳',
      '🙌',
      '💯',
      '⭐',
    ]);
    expect(GOAL_REACTION_EMOJIS).toHaveLength(8);
  });
});

describe('gamification toast kinds', () => {
  it('lists the 3 celebratory kinds from spec §3.1', () => {
    expect(GAMIFICATION_TOAST_KINDS).toEqual([
      'xp_palier_atteint',
      'badge_one_timer',
      'streak_palier_atteint',
    ]);
  });

  it('recognizes gamification kinds and rejects other kinds', () => {
    expect(isGamificationToastKind('xp_palier_atteint')).toBe(true);
    expect(isGamificationToastKind('badge_one_timer')).toBe(true);
    expect(isGamificationToastKind('streak_palier_atteint')).toBe(true);
    expect(isGamificationToastKind('session_goal_hit')).toBe(false);
    expect(isGamificationToastKind('goal_reaction')).toBe(false);
  });
});

describe('fetchNotifications', () => {
  it('includes sinceIso when provided', async () => {
    const since = '2026-07-13T18:00:00.000Z';

    await fetchNotifications('token', since);

    expect(fetch).toHaveBeenCalledWith(
      `/api/notifications?limit=40&since=${encodeURIComponent(since)}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });
});
