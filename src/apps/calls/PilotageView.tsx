import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../auth/useSession";
import { WindowBootScreen } from "../../components/WindowBootScreen";
import { Button, GlassCard, Tag } from "../../components/ui";
import {
  fetchProspectionCockpit,
  PilotageApiError,
  type ProspectionCockpit,
} from "./pilotageApi";
import "./pilotage.css";

function pct(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  prospection: "Prospection",
  suivi_clients: "Suivi clients",
  suivi_opportunites: "Suivi opportunités",
  relance: "Relance",
};

export function PilotageView({
  onBack,
  onPin,
}: {
  onBack: () => void;
  onPin?: () => Promise<void>;
}) {
  const { session, loading: sessionLoading } = useSession();
  const token = session?.access_token ?? null;
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [data, setData] = useState<ProspectionCockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProspectionCockpit(token, period));
    } catch (err) {
      if (err instanceof PilotageApiError && err.code === "forbidden") {
        setError("Réservé aux managers.");
      } else {
        setError("Impossible de charger le cockpit.");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessionLoading || (loading && !data && !error)) {
    return <WindowBootScreen label="Pilotage" />;
  }

  if (!token) {
    return <div className="pilotage-app pilotage-app__state">Session requise.</div>;
  }

  if (error && !data) {
    return (
      <div className="pilotage-app pilotage-app__state">
        <p>{error}</p>
        <Button variant="secondary" onClick={() => void load()}>Réessayer</Button>
      </div>
    );
  }

  const kpis = data?.team_kpis;

  return (
    <div className="calls-view pilotage-app">
      <header className="calls-view__header pilotage-header">
        <div>
          <Tag variant="accent">Combo</Tag>
          <h2>Pilotage</h2>
          <p className="pilotage-header__sub">Cockpit équipe · funnel, séances et attribution RDV</p>
        </div>
        <div className="calls-view__actions pilotage-header__actions">
          <div className="calls-seg" role="group" aria-label="Période">
            <button
              type="button"
              className={`calls-seg__btn${period === "week" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={period === "week"}
              onClick={() => setPeriod("week")}
            >
              Semaine
            </button>
            <button
              type="button"
              className={`calls-seg__btn${period === "month" ? " calls-seg__btn--active" : ""}`}
              aria-pressed={period === "month"}
              onClick={() => setPeriod("month")}
            >
              Mois
            </button>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            Actualiser
          </Button>
          {onPin && (
            <Button
              variant="secondary"
              disabled={pinned}
              onClick={() => {
                void onPin()
                  .then(() => setPinned(true))
                  .catch(() => {});
              }}
            >
              {pinned ? "Épinglé ✓" : "Épingler au bureau"}
            </Button>
          )}
          <Button variant="secondary" onClick={onBack}>
            Séances
          </Button>
        </div>
      </header>

      {error && <p className="pilotage-error" role="alert">{error}</p>}

      <section className="pilotage-kpis" aria-label="Funnel équipe">
        <GlassCard className="pilotage-stat">
          <span>Appels</span>
          <strong className="xos-numeric">{kpis?.calls ?? 0}</strong>
        </GlassCard>
        <GlassCard className="pilotage-stat">
          <span>Taux décroché</span>
          <strong className="xos-numeric">{pct(kpis?.rate_decroche ?? 0)}</strong>
        </GlassCard>
        <GlassCard className="pilotage-stat">
          <span>Taux argumenté</span>
          <strong className="xos-numeric">{pct(kpis?.rate_argumente ?? 0)}</strong>
        </GlassCard>
        <GlassCard className="pilotage-stat">
          <span>RDV / décroché</span>
          <strong className="xos-numeric">{pct(kpis?.rate_rdv_per_decroche ?? 0)}</strong>
        </GlassCard>
        <GlassCard className="pilotage-stat pilotage-stat--accent">
          <span>RDV pris</span>
          <strong className="xos-numeric">{kpis?.rdv ?? 0}</strong>
        </GlassCard>
      </section>

      <p className="pilotage-secondary">
        RDV / argumenté <strong className="xos-numeric">{pct(kpis?.rate_rdv_per_argumente ?? 0)}</strong>
        <span aria-hidden="true"> · </span>
        NPA <strong className="xos-numeric">{kpis?.npa ?? 0}</strong>
        <span aria-hidden="true"> · </span>
        Décrochés <strong className="xos-numeric">{kpis?.decroche ?? 0}</strong>
        <span aria-hidden="true"> · </span>
        Argumentés <strong className="xos-numeric">{kpis?.argumente ?? 0}</strong>
      </p>

      <div className="pilotage-grid">
        <GlassCard className="pilotage-panel">
          <h3>Par appelant</h3>
          <p className="pilotage-panel__hint">Qui a passé les appels (owner de la séance Combo).</p>
          {(data?.by_caller.length ?? 0) === 0 ? (
            <p className="pilotage-empty">Aucune activité sur la période.</p>
          ) : (
            <table className="pilotage-table">
              <thead>
                <tr>
                  <th>Commercial</th>
                  <th>Appels</th>
                  <th>Décroché</th>
                  <th>RDV</th>
                  <th>RDV/déc.</th>
                  <th>Séances</th>
                </tr>
              </thead>
              <tbody>
                {data?.by_caller.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      <strong>{row.label}</strong>
                      {row.tracking === "sdr" && <Tag variant="muted">SDR</Tag>}
                    </td>
                    <td className="xos-numeric">{row.kpis.calls}</td>
                    <td className="xos-numeric">{pct(row.kpis.rate_decroche)}</td>
                    <td className="xos-numeric">{row.kpis.rdv}</td>
                    <td className="xos-numeric">{pct(row.kpis.rate_rdv_per_decroche)}</td>
                    <td className="xos-numeric">
                      {row.sessions_active}
                      <span className="pilotage-muted"> act.</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>

        <GlassCard className="pilotage-panel">
          <h3>RDV attribués</h3>
          <p className="pilotage-panel__hint">Chez qui le RDV est propriétaire dans Salesforce.</p>
          {(data?.by_rdv_owner.length ?? 0) === 0 ? (
            <p className="pilotage-empty">Aucun RDV sur la période.</p>
          ) : (
            <table className="pilotage-table">
              <thead>
                <tr>
                  <th>Propriétaire</th>
                  <th>RDV</th>
                  <th>Dont via SDR</th>
                </tr>
              </thead>
              <tbody>
                {data?.by_rdv_owner.map((row) => (
                  <tr key={row.sf_user_id || row.label}>
                    <td><strong>{row.label}</strong></td>
                    <td className="xos-numeric">{row.rdv}</td>
                    <td className="xos-numeric">{row.from_sdr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>
      </div>

      <GlassCard className="pilotage-panel">
        <h3>Séances</h3>
        {(data?.sessions.length ?? 0) === 0 ? (
          <p className="pilotage-empty">Aucune séance active ou touchée sur la période.</p>
        ) : (
          <table className="pilotage-table pilotage-table--sessions">
            <thead>
              <tr>
                <th>Séance</th>
                <th>Appelant</th>
                <th>Type</th>
                <th>Appels</th>
                <th>Décroché</th>
                <th>RDV</th>
                <th>Progression</th>
              </tr>
            </thead>
            <tbody>
              {data?.sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <strong>{session.name}</strong>
                    <span className="pilotage-muted">
                      {session.status === "active" ? " · active" : " · terminée"}
                    </span>
                  </td>
                  <td>{session.owner.label}</td>
                  <td>{SESSION_TYPE_LABEL[session.session_type] || session.session_type}</td>
                  <td className="xos-numeric">{session.kpis.calls}</td>
                  <td className="xos-numeric">{pct(session.kpis.rate_decroche)}</td>
                  <td className="xos-numeric">{session.kpis.rdv}</td>
                  <td className="xos-numeric">
                    {session.counts.called}/{session.counts.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>

      <GlassCard className="pilotage-panel">
        <h3>Détail des RDV</h3>
        <p className="pilotage-panel__hint">Qui a pris l’appel → à qui le RDV est attribué.</p>
        {(data?.rdv_attributions.length ?? 0) === 0 ? (
          <p className="pilotage-empty">Aucun RDV journalisé sur la période.</p>
        ) : (
          <table className="pilotage-table">
            <thead>
              <tr>
                <th>Quand</th>
                <th>Contact</th>
                <th>Appelant</th>
                <th>Attribué à</th>
                <th>Séance</th>
              </tr>
            </thead>
            <tbody>
              {data?.rdv_attributions.map((row) => (
                <tr key={row.session_contact_id}>
                  <td className="xos-numeric">{formatWhen(row.called_at)}</td>
                  <td>
                    <strong>{row.contact_name}</strong>
                    {row.account_name && (
                      <span className="pilotage-muted"> · {row.account_name}</span>
                    )}
                  </td>
                  <td>{row.caller.label}</td>
                  <td>
                    <strong>{row.rdv_owner_label}</strong>
                    {row.caller.sf_user_id
                      && row.rdv_owner_sf_user_id
                      && row.caller.sf_user_id !== row.rdv_owner_sf_user_id && (
                        <Tag variant="accent">SDR</Tag>
                    )}
                  </td>
                  <td className="pilotage-muted">{row.session_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}
