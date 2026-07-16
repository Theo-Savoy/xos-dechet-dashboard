import { useEffect, useRef, useState } from 'react';
import type { FloatingReactionBurst } from './notificationsStore';
import { particlesFor, type Particle } from './FloatingReactions.helpers';
import './floatingReactions.css';

type FloatingReactionsProps = {
  bursts: FloatingReactionBurst[];
  onDone: (id: string) => void;
};

const PARTICLE_LIFETIME_MS = 4_300;

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
