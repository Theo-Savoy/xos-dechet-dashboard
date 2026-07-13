import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOAL_REACTION_EMOJIS,
  PICKER_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
  fetchNotifications,
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
