const PARTICLE_COUNT = 30;

export type Particle = {
  key: number;
  emoji: string;
  left: string;
  delay: string;
  duration: string;
  drift: string;
  size: string;
  scale: string;
  rotate: string;
};

export function particlesFor(emoji: string): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    key: i,
    emoji,
    left: `${6 + Math.random() * 88}%`,
    delay: `${Math.random() * 0.35}s`,
    duration: `${2.8 + Math.random()}s`,
    drift: `${(Math.random() - 0.5) * 180}px`,
    size: `${1.2 + Math.random() * 1.6}rem`,
    scale: `${1 + Math.random()}`,
    rotate: `${(Math.random() - 0.5) * 80}deg`,
  }));
}
