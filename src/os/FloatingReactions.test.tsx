import { afterEach, describe, expect, it, vi } from 'vitest';
import { particlesFor } from './FloatingReactions.helpers';

describe('floating reaction particles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses a larger burst with the slower duration range and wider drift', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const particles = particlesFor('🎉');
    const [particle] = particles;

    expect(particles).toHaveLength(30);
    expect(particle?.duration).toBe('3.799s');
    expect(particle?.drift).toBe('89.82px');
    expect(particle?.scale).toBe('1.999');
  });
});
