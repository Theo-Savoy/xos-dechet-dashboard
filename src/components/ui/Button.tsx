import type { ButtonHTMLAttributes } from "react";
import "./ui.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonProps) {
  const classes = ["xos-btn", `xos-btn--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return <button className={classes} {...props} />;
}
