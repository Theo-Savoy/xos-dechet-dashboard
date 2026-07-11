import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

/** Light empty-state illustration for polished zero states. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="calls-empty-state">
      <svg
        className="calls-empty-state__art"
        viewBox="0 0 160 120"
        width="160"
        height="120"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="callsEmptySky" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect x="8" y="12" width="144" height="96" rx="18" fill="url(#callsEmptySky)" />
        <circle cx="118" cy="36" r="14" fill="currentColor" opacity="0.12" />
        <path
          d="M34 78c10-18 22-28 36-28s26 10 36 28"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />
        <rect x="52" y="42" width="56" height="40" rx="10" fill="currentColor" opacity="0.14" />
        <path
          d="M64 58h32M64 68h20"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.45"
        />
        <circle cx="96" cy="68" r="4" fill="currentColor" opacity="0.55" />
        <path
          d="M108 52l10-6 4 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.5"
        />
      </svg>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
