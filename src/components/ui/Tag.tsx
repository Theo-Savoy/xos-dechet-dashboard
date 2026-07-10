import type { HTMLAttributes } from "react";
import "./ui.css";

type TagProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "accent" | "alert";
};

export function Tag({ variant = "default", className, ...props }: TagProps) {
  const classes = [
    "xos-tag",
    variant !== "default" && `xos-tag--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes} {...props} />;
}
