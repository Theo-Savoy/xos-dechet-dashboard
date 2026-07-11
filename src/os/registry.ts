import { lazy, type FC, type LazyExoticComponent, type ReactNode } from "react";

export type AppRole = "admin" | "manager" | "commercial";

export interface AppManifest {
  id: string;
  title: string;
  icon: ReactNode;
  component: LazyExoticComponent<FC<{ params?: Record<string, string> }>>;
  defaultSize: { w: number; h: number };
  roles?: AppRole[];
}

export const appRegistry: AppManifest[] = [
  {
    id: "cleaner",
    title: "CRM Cleaner",
    icon: "◈",
    component: lazy(() => import("../apps/cleaner/CleanerApp")),
    defaultSize: { w: 1100, h: 540 },
  },
  {
    id: "calls",
    title: "Call Manager",
    icon: "☎",
    component: lazy(() => import("../apps/calls/CallManagerApp")),
    defaultSize: { w: 960, h: 620 },
  },
  {
    id: "weekly",
    title: "Weekly Perf",
    icon: "◔",
    component: lazy(() => import("../apps/weekly/WeeklyApp")),
    defaultSize: { w: 1040, h: 680 },
  },
  {
    id: "hub",
    title: "Hub",
    icon: "◌",
    component: lazy(() => import("../apps/hub/HubApp")),
    defaultSize: { w: 820, h: 620 },
    // Panneau système : bruit pour un commercial, réservé au pilotage.
    roles: ["manager", "admin"],
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: "overview-demo",
          title: "Aperçu commercial",
          icon: "◒",
          component: lazy(() => import("../apps/demo/OverviewDemo")),
          defaultSize: { w: 760, h: 520 },
        },
        {
          id: "notes-demo",
          title: "Notes d’équipe",
          icon: "✦",
          component: lazy(() => import("../apps/demo/NotesDemo")),
          defaultSize: { w: 620, h: 460 },
        },
        {
          id: "ui-demo",
          title: "Design system",
          icon: "⌘",
          component: lazy(() => import("../components/ui/demo")),
          defaultSize: { w: 800, h: 580 },
        },
      ]
    : []),
];

export function getAppManifest(appId: string): AppManifest | undefined {
  return appRegistry.find((app) => app.id === appId);
}
