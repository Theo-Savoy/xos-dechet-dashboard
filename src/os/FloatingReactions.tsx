import { useEffect, useRef, useState } from 'react';
import type { FloatingReactionBurst } from './notificationsStore';
import './floatingReactions.css';

export type { FloatingReactionBurst } from './notificationsStore';

type FloatingReactionsProps = {
  bursts: FloatingReactionBurst[];
  onDone: (id: string) => void;
};

const PARTICLE_COUNT = 30;
const PARTICLE_LIFETIME_MS = 4_300;

type Particle = {
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

export function FloatingReactions({ bursts, onDone }: FloatingReactionsProps) {
  const [particles, setParticles] = useState<Record<string, Particle[]>>({});
  const startedRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, number>());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    for (const burst of bursts) {
      if (startedRef.current.has(burst.id)) continue;
      startedRef.current.add(burst.id);
      setParticles((prev) => ({
        ...prev,
        [burst.id]: particlesFor(burst.emoji),
      }));
      const timer = window.setTimeout(() => {
        timersRef.current.delete(burst.id);
        setParticles((prev) => {
          const next = { ...prev };
          delete next[burst.id];
          return next;
        });
        startedRef.current.delete(burst.id);
        onDoneRef.current(burst.id);
      }, PARTICLE_LIFETIME_MS);
      timersRef.current.set(burst.id, timer);
    }
  }, [bursts]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values())
        window.clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  if (bursts.length === 0) return null;

  return (
    <div className="xos-float-reactions" aria-hidden="true">
      {bursts.map((burst) =>
        (particles[burst.id] ?? []).map((p) => (
          <span
            key={`${burst.id}-${p.key}`}
            className="xos-float-reactions__emoji"
            style={{
              left: p.left,
              fontSize: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
              ['--xos-float-drift' as string]: p.drift,
              ['--xos-float-scale' as string]: p.scale,
              ['--xos-float-rotate' as string]: p.rotate,
            }}
          >
            {p.emoji}
          </span>
        )),
      )}
    </div>
  );
}
