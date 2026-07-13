import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AppRole } from '../../os/registry';
import { fetchOpportunityWorkspace } from './modules/opportunities/api';
import { type CleanerCockpitState } from './CleanerCockpit';
import { CleanerShell } from './shell/CleanerShell';
import './cleaner.css';

type CleanerAppProps = {
  params?: Record<string, string>;
};

type CleanerSession = {
  accessToken: string;
  role: AppRole;
};

function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'manager' || value === 'commercial';
}

type ProfileClient = {
  from?: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{ data?: { role?: unknown } | null }>;
      };
    };
  };
};

export default function CleanerApp({ params }: CleanerAppProps) {
  const [session, setSession] = useState<CleanerSession | null>(null);
  const [cockpit, setCockpit] = useState<CleanerCockpitState>({
    status: 'loading',
    summaries: [],
  });

  useEffect(() => {
    let cancelled = false;

    void supabase.auth
      .getSession()
      .then(async ({ data: { session: currentSession } }) => {
        const accessToken = currentSession?.access_token;
        if (!accessToken || cancelled) return;

        const metadata = currentSession.user?.user_metadata as
          Record<string, unknown> | undefined;
        let role: AppRole = isAppRole(metadata?.role)
          ? metadata.role
          : 'commercial';
        const profileClient = supabase as unknown as ProfileClient;
        if (
          !isAppRole(metadata?.role) &&
          currentSession.user?.email &&
          profileClient.from
        ) {
          try {
            const { data } = await profileClient
              .from('profiles')
              .select('role')
              .eq('email', currentSession.user.email)
              .maybeSingle();
            if (isAppRole(data?.role)) role = data.role;
          } catch {
            // The desktop already guards this lookup; commercial is the safe shell default.
          }
        }
        if (cancelled) return;
        setSession({ accessToken, role });
      })
      .catch(() => {
        if (!cancelled) setSession({ accessToken: '', role: 'commercial' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || params?.q) return;
    let cancelled = false;
    setCockpit({ status: 'loading', summaries: [] });

    void fetchOpportunityWorkspace(session.accessToken)
      .then((workspace) => {
        if (cancelled) return;
        // The cleaner home only summarises the Opportunity workspace.
        // The 'Secteurs obsolètes' recipe is reachable from the Recettes
        // top-level tab (deduped in V17) and is no longer mirrored here
        // to avoid rendering the same recipe twice.
        if (workspace.items.length === 0) {
          setCockpit({
            status: 'ready',
            summaries: [
              {
                moduleId: 'recettes',
                recipeId: 'opportunities',
                label: 'Opportunités suspectes ou abandonnées',
                criticality: 'healthy',
                anomalyCount: 0,
                affectedRecordCount: 0,
                resolvedPeriodCount: 0,
                previousPeriodDelta: null,
                lastRefreshedAt: workspace.metadata?.fetchedAt ?? null,
              },
            ],
          });
          return;
        }

        const totalAnomalies = workspace.items.reduce(
          (total, item) => total + item.anomalies.length,
          0,
        );
        const criticality =
          workspace.items.length >= 5 ? 'critical' : 'warning';
        setCockpit({
          status: 'ready',
          summaries: [
            {
              moduleId: 'recettes',
              recipeId: 'opportunities',
              label: 'Opportunités suspectes ou abandonnées',
              criticality,
              anomalyCount: totalAnomalies,
              affectedRecordCount: workspace.items.length,
              resolvedPeriodCount: 0,
              previousPeriodDelta: null,
              lastRefreshedAt: workspace.metadata?.fetchedAt ?? null,
            },
          ],
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCockpit({
          status: 'error',
          summaries: [],
          error:
            error instanceof Error
              ? error.message
              : 'Les faits du Labo sont indisponibles.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [params?.q, session]);

  if (!session) {
    return (
      <div
        className="cleaner-app cleaner-app--booting"
        role="status"
        aria-busy="true"
      >
        Ouverture du Labo…
      </div>
    );
  }

  return (
    <CleanerShell
      accessToken={session.accessToken}
      role={session.role}
      params={params}
      cockpit={cockpit}
    />
  );
}
