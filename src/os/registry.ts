import { lazy, type FC, type LazyExoticComponent, type ReactNode } from "react";

export type AppRole = "manager" | "commercial";

export interface AppManifest {
  id: string;
  title: string;
  icon: ReactNode;
  component: LazyExoticComponent<FC>;
  defaultSize: { w: number; h: number };
  roles?: AppRole[];
}

export const appRegistry: AppManifest[] = [
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
    component: lazy(() => import("../lib/ui/demo")),
    defaultSize: { w: 800, h: 580 },
  },
];

export function getAppManifest(appId: string): AppManifest | undefined {
  return appRegistry.find((app) => app.id === appId);
}
