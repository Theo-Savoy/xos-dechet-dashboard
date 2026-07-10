import type { HTMLAttributes } from "react";
import "./ui.css";

type GlassCardProps = HTMLAttributes<HTMLDivElement>;

export function GlassCard({ className, ...props }: GlassCardProps) {
  const classes = ["xos-glass-card", className].filter(Boolean).join(" ");

  return <div className={classes} {...props} />;
}
