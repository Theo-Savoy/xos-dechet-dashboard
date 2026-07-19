import type { HTMLAttributes } from "react";
import "./ui.css";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "subdued";
};

export function GlassCard({ className, variant = "default", ...props }: GlassCardProps) {
  const classes = [
    "xos-glass-card",
    variant === "subdued" ? "xos-glass-card--subdued" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes} {...props} />;
}
