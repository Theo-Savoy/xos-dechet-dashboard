/** Icônes dock/launcher — glyphes XOS cohérents, distinctifs et lisibles à 48px. */

import type { ReactNode } from "react";

type IconProps = { className?: string };

function IconShell({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 48 48" width="100%" height="100%" fill="none" aria-hidden="true">
      <path
        d="M13.5 7.5h21c3.3 0 6 2.7 6 6v21c0 3.3-2.7 6-6 6h-21c-3.3 0-6-2.7-6-6v-21c0-3.3 2.7-6 6-6Z"
        fill="currentColor"
        opacity=".1"
      />
      {children}
    </svg>
  );
}

/** Labo — diamant de déduplication + éclat de donnée propre */
export function CleanerIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <path d="M24 6.5 41.5 24 24 41.5 6.5 24 24 6.5Z" fill="currentColor" opacity=".18" />
      <path d="M24 11 37 24 24 37 11 24 24 11Z" fill="currentColor" />
      <path d="m18 24 4.4 4.4L31.5 19" stroke="white" strokeOpacity=".78" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M33.5 9.5v5M31 12h5" stroke="white" strokeOpacity=".72" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.5 34.5h7" stroke="white" strokeOpacity=".42" strokeWidth="2" strokeLinecap="round" />
    </IconShell>
  );
}

/** Combo — combiné + onde d'action */
export function CallsIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <path
        d="M15.5 10.2c1.1-1.1 2.9-1.1 4 0l3.1 3.1c.9.9.9 2.4 0 3.3l-2 2c-.4.4-.5 1.1-.2 1.6 1.5 2.8 3.6 4.9 6.4 6.4.5.3 1.2.2 1.6-.2l2-2c.9-.9 2.4-.9 3.3 0l3.1 3.1c1.1 1.1 1.1 2.9 0 4l-1.5 1.5c-1.3 1.3-3.2 1.8-5 1.3-4-1.2-8.2-3.8-11.9-7.5s-6.3-7.9-7.5-11.9c-.5-1.8 0-3.7 1.3-5l1.5-1.5Z"
        fill="currentColor"
      />
      <path d="M30 12.5c3 .8 5.7 3.5 6.5 6.5" stroke="white" strokeOpacity=".58" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M31.5 6.8c5.2 1.2 9.4 5.4 10.6 10.7" stroke="white" strokeOpacity=".32" strokeWidth="2.2" strokeLinecap="round" />
    </IconShell>
  );
}

/** Lundi — histogramme premium + trajectoire */
export function WeeklyIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <path d="M10 37.5h28" stroke="currentColor" strokeOpacity=".38" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="11" y="25" width="6.5" height="12" rx="2.2" fill="currentColor" opacity=".55" />
      <rect x="20.8" y="18" width="6.5" height="19" rx="2.2" fill="currentColor" opacity=".78" />
      <rect x="30.5" y="10" width="6.5" height="27" rx="2.2" fill="currentColor" />
      <path d="m12.5 20.5 9-6 6 3 8-9" stroke="white" strokeOpacity=".68" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35.5" cy="8.5" r="2.7" fill="white" fillOpacity=".76" />
    </IconShell>
  );
}

/** Coulisses — réseau de pilotage */
export function HubIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <path d="M24 14v20M14 24h20M17 17l14 14M31 17 17 31" stroke="currentColor" strokeOpacity=".42" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="24" cy="24" r="8.2" fill="currentColor" />
      <circle cx="24" cy="24" r="3.2" fill="white" fillOpacity=".72" />
      <circle cx="24" cy="10" r="4.5" fill="currentColor" />
      <circle cx="38" cy="24" r="4.5" fill="currentColor" opacity=".82" />
      <circle cx="24" cy="38" r="4.5" fill="currentColor" opacity=".7" />
      <circle cx="10" cy="24" r="4.5" fill="currentColor" opacity=".82" />
    </IconShell>
  );
}

export function DemoOverviewIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <rect x="9" y="10" width="30" height="28" rx="5" fill="currentColor" opacity=".25" />
      <path d="M15 17h12M15 23h18M15 29h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="33" cy="18" r="3" fill="white" fillOpacity=".65" />
    </IconShell>
  );
}

export function DemoNotesIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <path fill="currentColor" d="M14 8h17a4 4 0 0 1 4 4v23l-6-4H14a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" />
      <path stroke="white" strokeOpacity=".62" strokeWidth="2.2" strokeLinecap="round" d="M16 16h12M16 21h10M16 26h8" />
    </IconShell>
  );
}

export function DemoUiIcon({ className }: IconProps) {
  return (
    <IconShell className={className}>
      <rect x="9" y="9" width="13" height="13" rx="3.5" fill="currentColor" />
      <rect x="26" y="9" width="13" height="13" rx="3.5" fill="currentColor" opacity=".62" />
      <rect x="9" y="26" width="13" height="13" rx="3.5" fill="currentColor" opacity=".62" />
      <rect x="26" y="26" width="13" height="13" rx="3.5" fill="currentColor" opacity=".35" />
      <path d="M16 14.5v3M14.5 16h3" stroke="white" strokeOpacity=".7" strokeWidth="1.8" strokeLinecap="round" />
    </IconShell>
  );
}

export const APP_ICONS = {
  cleaner: CleanerIcon,
  calls: CallsIcon,
  weekly: WeeklyIcon,
  hub: HubIcon,
  "overview-demo": DemoOverviewIcon,
  "notes-demo": DemoNotesIcon,
  "ui-demo": DemoUiIcon,
} as const;
