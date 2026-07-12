import { useEffect, useMemo, useState } from "react";
import type { RdvHeat } from "./rdvCelebrate";

type RdvConfettiProps = {
  burstKey: number;
  heat: RdvHeat;
  goalHit?: boolean;
};

type Particle = {
  id: number;
  left: string;
  delay: string;
  duration: string;
  drift: string;
  color: string;
  size: string;
  rotate: string;
  kind: "chip" | "ember" | "spark";
};

const PALETTES: Record<RdvHeat, string[]> = {
  1: ["var(--xos-accent)", "#7aa2ff", "#5ecf8e", "#a8b4ff"],
  2: ["var(--xos-accent)", "#f5c542", "#7aa2ff", "#5ecf8e", "#ffd98a"],
  3: ["#ff9f43", "#f5c542", "#ff6b35", "var(--xos-accent)", "#ffd98a"],
  4: ["#ff6b35", "#ff9f43", "#ff3d00", "#f5c542", "#ffb347", "#ff5722"],
  5: ["#ffe566", "#fff1a8", "#ff9f43", "#ffffff", "#f5c542", "#ff6b35"],
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function particleCount(heat: RdvHeat): number {
  if (heat >= 5) return 64;
  if (heat === 4) return 48;
  if (heat === 3) return 36;
  if (heat === 2) return 28;
  return 18;
}

export function RdvConfetti({ burstKey, heat, goalHit = false }: RdvConfettiProps) {
  const [visible, setVisible] = useState(false);

  const particles = useMemo(() => {
    if (!burstKey) return [] as Particle[];
    const colors = PALETTES[heat];
    const count = particleCount(heat);
    return Array.from({ length: count }, (_, i) => {
      const kind: Particle["kind"] =
        heat >= 4 && i % 4 === 0 ? "ember" : heat >= 5 && i % 5 === 0 ? "spark" : "chip";
      return {
        id: i,
        left: `${4 + ((i * 19) % 92)}%`,
        delay: `${(i % 10) * 0.025}s`,
        duration: `${1.1 + (i % 6) * 0.18 + (heat >= 4 ? 0.35 : 0) + (goalHit ? 0.4 : 0)}s`,
        drift: `${((i % 9) - 4) * (12 + heat * 3)}px`,
        color: colors[i % colors.length],
        size: kind === "spark" ? "3px" : kind === "ember" ? `${8 + (i % 3) * 2}px` : `${5 + (i % 4) * 2}px`,
        rotate: `${(i * 53) % 360}deg`,
        kind,
      };
    });
  }, [burstKey, heat, goalHit]);

  useEffect(() => {
    if (!burstKey || prefersReducedMotion()) return;
    setVisible(true);
    const timer = window.setTimeout(
      () => setVisible(false),
      goalHit ? 5200 : heat >= 4 ? 3800 : heat >= 3 ? 3000 : 2200,
    );
    return () => window.clearTimeout(timer);
  }, [burstKey, heat, goalHit]);

  if (!visible || particles.length === 0) return null;

  return (
    <div
      className={`calls-rdv-confetti calls-rdv-confetti--heat-${heat}${goalHit ? " calls-rdv-confetti--goal" : ""}`}
      aria-hidden="true"
    >
      {goalHit && <div className="calls-rdv-confetti__flare" />}
      {particles.map((p) => (
        <span
          key={`${burstKey}-${p.id}`}
          className={`calls-rdv-confetti__piece calls-rdv-confetti__piece--${p.kind}`}
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            ["--drift" as string]: p.drift,
            ["--spin" as string]: p.rotate,
            background: p.color,
            width: p.size,
            height: p.size,
          }}
        />
      ))}
    </div>
  );
}
