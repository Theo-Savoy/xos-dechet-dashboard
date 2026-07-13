import { describe, expect, it } from 'vitest';
import {
  GOAL_REACTION_EMOJIS,
  PICKER_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
} from './notifications';

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
