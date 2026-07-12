import { useEffect, useState } from 'react';
import { Button, GlassCard, Tag } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import TargetsEditor from './TargetsEditor';
import './hub.css';

type CleanerScoreSettings = Record<string, number>;
type CleanerSettings = {
  amountImplausibleMax: number;
  closeDateCriticalDays: number;
  opportunityOldDays: number;
  opportunityVeryOldDays: number;
  score: CleanerScoreSettings;
};
type CleanerSettingsEnvelope = {
  key: 'cleaner_v2';
  defaults: CleanerSettings;
  effective: CleanerSettings;
  warnings: Array<{ message: string }>;
};
type Status = {
  role: string;
  capabilities: { manageSettings: boolean; manageRoles: boolean };
  profile: {
    email: string | null;
    fullName: string | null;
    sfUserId: string | null;
    sfLinked?: boolean;
  };
  salesforce: {
    connected: boolean;
    userLinked?: boolean;
    dailyApiRequests: { max: number; remaining: number } | null;
  };
  cache: { cleaner: { version: string | null } };
  version: string;
  settings?: Array<{ id: number; key: string; value: unknown }>;
  cleanerSettings?: CleanerSettingsEnvelope;
  profiles?: Array<{
    id: string;
    email: string;
    full_name: string | null;
    sf_user_id: string | null;
    role: string;
  }>;
};

const DEFAULT_CLEANER_SETTINGS: CleanerSettings = {
  amountImplausibleMax: 100,
  closeDateCriticalDays: 90,
  opportunityOldDays: 365,
  opportunityVeryOldDays: 730,
  score: {
    overduePointEveryDays: 30,
    overdueCap: 12,
    neverActive: 8,
    inactive30Days: 2,
    inactive90Days: 5,
    inactive365Days: 5,
    amountMissing: 6,
    amountImplausible: 10,
    probabilityZero: 3,
    ownerInactive: 10,
    formerEmployee: 8,
    oldOpportunity: 2,
    veryOldOpportunity: 4,
    stalledStage: 3,
    amountPointEvery: 10000,
    amountCap: 5,
  },
};

const SETTING_FIELDS: Array<{
  path: string;
  label: string;
  min: number;
  max: number;
}> = [
  {
    path: 'amountImplausibleMax',
    label: 'Montant incohérent au-delà de',
    min: 1,
    max: 1_000_000,
  },
  {
    path: 'closeDateCriticalDays',
    label: 'CloseDate critique après (jours)',
    min: 1,
    max: 3650,
  },
  {
    path: 'opportunityOldDays',
    label: 'Opportunité ancienne après (jours)',
    min: 1,
    max: 3650,
  },
  {
    path: 'opportunityVeryOldDays',
    label: 'Opportunité très ancienne après (jours)',
    min: 1,
    max: 7300,
  },
  ...Object.entries(DEFAULT_CLEANER_SETTINGS.score).map(([path]) => ({
    path: `score.${path}`,
    label: `Score · ${path}`,
    min:
      path === 'amountPointEvery' || path === 'overduePointEveryDays' ? 1 : 0,
    max:
      path === 'amountPointEvery'
        ? 1_000_000_000
        : path === 'overduePointEveryDays'
          ? 365
          : path === 'amountCap' || path === 'overdueCap'
            ? 100
            : 1000,
  })),
];

function statusRequest(token: string) {
  return fetch('/api/status', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        typeof body.message === 'string' ? body.message : 'status_unavailable',
      );
    return body as Status;
  });
}

function cloneSettings(settings: CleanerSettings): CleanerSettings {
  return { ...settings, score: { ...settings.score } };
}

function valueAt(settings: CleanerSettings, path: string): number {
  const [root, child] = path.split('.');
  return child
    ? Number(settings.score[child])
    : Number(settings[root as keyof CleanerSettings]);
}

function updateValue(
  settings: CleanerSettings,
  path: string,
  value: number,
): CleanerSettings {
  const next = cloneSettings(settings);
  const [root, child] = path.split('.');
  if (child) next.score[child] = value;
  else
    next[
      root as
        | 'amountImplausibleMax'
        | 'closeDateCriticalDays'
        | 'opportunityOldDays'
        | 'opportunityVeryOldDays'
    ] = value;
  return next;
}

function validateSettings(settings: CleanerSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of SETTING_FIELDS) {
    const value = valueAt(settings, field.path);
    if (!Number.isFinite(value))
      errors[field.path] = 'Une valeur numérique est requise.';
    else if (value < field.min || value > field.max)
      errors[field.path] =
        `Doit être compris entre ${field.min} et ${field.max}.`;
  }
  if (settings.opportunityVeryOldDays <= settings.opportunityOldDays)
    errors.opportunityVeryOldDays = 'Doit être supérieur au seuil ancien.';
  if (settings.closeDateCriticalDays > settings.opportunityOldDays)
    errors.closeDateCriticalDays = 'Ne peut pas dépasser le seuil ancien.';
  return errors;
}

export default function HubApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleanerValue, setCleanerValue] = useState<CleanerSettings>(
    cloneSettings(DEFAULT_CLEANER_SETTINGS),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const refresh = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('missing_session');
    setToken(session.access_token);
    const next = await statusRequest(session.access_token);
    setStatus(next);
    setCleanerValue(
      cloneSettings(
        next.cleanerSettings?.effective ||
          next.cleanerSettings?.defaults ||
          DEFAULT_CLEANER_SETTINGS,
      ),
    );
  };

  useEffect(() => {
    refresh().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Impossible de charger les Coulisses.',
      ),
    );
  }, []);

  const post = async (body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const response = await fetch('/api/status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const bodyResponse = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof bodyResponse.message === 'string'
            ? bodyResponse.message
            : 'Écriture refusée.',
        );
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveCleanerSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validateSettings(cleanerValue);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length || !token) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update_settings',
          operation: 'upsert',
          key: 'cleaner_v2',
          value: cleanerValue,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof body.message === 'string'
            ? body.message
            : 'Les seuils Labo n’ont pas été enregistrés.',
        );
      await refresh();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Les seuils Labo n’ont pas été enregistrés.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (error && !status)
    return (
      <div className="hub-app hub-app__state" role="alert">
        {error}
      </div>
    );
  if (!status)
    return (
      <div className="hub-app hub-app__state">Chargement des Coulisses…</div>
    );
  const quota = status.salesforce.dailyApiRequests;
  const cleanerSettings = status.cleanerSettings;
  return (
    <main className="hub-app">
      <header className="hub-header">
        <div>
          <Tag variant="accent">Panneau système</Tag>
          <h2>Coulisses</h2>
        </div>
        <Button
          variant="secondary"
          disabled={saving}
          onClick={() =>
            refresh().catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Actualisation impossible.',
              ),
            )
          }
        >
          Actualiser
        </Button>
      </header>
      {error ? (
        <div className="hub-error" role="alert">
          {error}
        </div>
      ) : null}
      <section className="hub-grid">
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Compte</p>
          <h3>{status.profile.fullName || 'Utilisateur X OS'}</h3>
          <dl className="hub-details">
            <div>
              <dt>Email</dt>
              <dd>{status.profile.email || '—'}</dd>
            </div>
            <div>
              <dt>Rôle</dt>
              <dd>
                <Tag>{status.role}</Tag>
              </dd>
            </div>
            <div>
              <dt>Salesforce</dt>
              <dd>
                {status.profile.sfUserId
                  ? `Mappé · ${status.profile.sfUserId}`
                  : 'Non mappé'}
              </dd>
            </div>
          </dl>
        </GlassCard>
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Statut</p>
          <h3>Services</h3>
          <div className="hub-status">
            <span>
              Salesforce{' '}
              <Tag
                variant={status.salesforce.connected ? 'success' : 'warning'}
              >
                {status.salesforce.connected ? 'OK' : 'KO'}
              </Tag>
            </span>
            <span>
              Compte lié{' '}
              <Tag
                variant={status.salesforce.userLinked ? 'success' : 'warning'}
              >
                {status.salesforce.userLinked ? 'Oui' : 'Non'}
              </Tag>
            </span>
            <span>
              API SF (24 h glissantes){' '}
              <strong>
                {quota
                  ? `${(quota.max - quota.remaining).toLocaleString('fr-FR')} utilisés / ${quota.max.toLocaleString('fr-FR')} — ${quota.remaining.toLocaleString('fr-FR')} restants`
                  : 'Indisponible'}
              </strong>
            </span>
            {!status.salesforce.connected ? (
              <span className="hub-status__hint">
                {status.salesforce.userLinked
                  ? 'Token Salesforce expiré ou révoqué — reconnectez-vous via le bandeau menubar.'
                  : 'Aucun compte Salesforce lié — utilisez « Lier Salesforce » dans le bandeau menubar.'}
              </span>
            ) : null}
            <span>
              Cache Labo{' '}
              <strong>
                {status.cache.cleaner.version || 'Non disponible'}
              </strong>
            </span>
            <span>
              Déploiement <strong>{status.version}</strong>
            </span>
          </div>
        </GlassCard>
      </section>
      {status.capabilities.manageSettings ? (
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Objectifs</p>
          <h3>Trimestre en cours</h3>
          {token && <TargetsEditor token={token} />}
        </GlassCard>
      ) : null}
      {status.capabilities.manageSettings && cleanerSettings ? (
        <GlassCard className="hub-panel hub-settings-editor">
          <div>
            <p className="hub-eyebrow">Labo · Opportunités</p>
            <h3>Seuils cleaner_v2</h3>
            <p className="hub-help">
              Valeurs effectives. Les bornes sont contrôlées par champ avant
              enregistrement.
            </p>
          </div>
          {cleanerSettings.warnings.map((warning, index) => (
            <p
              className="hub-error"
              role="alert"
              key={`${warning.message}-${index}`}
            >
              {warning.message}
            </p>
          ))}
          <form className="hub-typed-form" onSubmit={saveCleanerSettings}>
            {SETTING_FIELDS.map((field) => {
              const value = valueAt(cleanerValue, field.path);
              const fieldError = fieldErrors[field.path];
              return (
                <label key={field.path}>
                  {field.label}
                  <input
                    aria-label={field.label}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step="any"
                    value={Number.isFinite(value) ? value : ''}
                    disabled={saving}
                    onChange={(event) => {
                      const parsed =
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value);
                      setCleanerValue((current) => {
                        const next = updateValue(current, field.path, parsed);
                        setFieldErrors(validateSettings(next));
                        return next;
                      });
                    }}
                  />
                  {fieldError ? (
                    <small className="hub-field-error" role="alert">
                      {fieldError}
                    </small>
                  ) : null}
                </label>
              );
            })}
            <Button
              disabled={
                saving || Object.keys(validateSettings(cleanerValue)).length > 0
              }
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les seuils'}
            </Button>
          </form>
        </GlassCard>
      ) : null}
      {!status.capabilities.manageSettings ? (
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Labo</p>
          <h3>Seuils non éditables</h3>
          <p className="hub-help">
            Les seuils cleaner_v2 sont réservés aux managers et administrateurs.
          </p>
        </GlassCard>
      ) : null}
      {status.capabilities.manageSettings && status.settings?.length ? (
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Paramètres conservés</p>
          <h3>Autres paramètres</h3>
          <div className="hub-settings">
            {status.settings
              .filter((setting) => setting.key !== 'weekly_targets')
              .map((setting) => (
                <div className="hub-setting" key={setting.id}>
                  <code>{setting.key}</code>
                  <span>{JSON.stringify(setting.value)}</span>
                </div>
              ))}
          </div>
        </GlassCard>
      ) : null}
      {status.capabilities.manageSettings &&
      !status.capabilities.manageRoles ? (
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Équipe</p>
          <h3>Profils</h3>
          <div className="hub-profiles">
            {status.profiles?.map((profile) => (
              <div className="hub-profile" key={profile.id}>
                <span>
                  <strong>{profile.full_name || profile.email}</strong>
                  <small>{profile.email}</small>
                </span>
                <Tag>{profile.role}</Tag>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
      {status.capabilities.manageRoles ? (
        <GlassCard className="hub-panel">
          <p className="hub-eyebrow">Administration</p>
          <h3>Accès & rôles</h3>
          <div className="hub-profiles">
            {status.profiles?.map((profile) => (
              <div className="hub-profile" key={profile.id}>
                <span>
                  <strong>{profile.full_name || profile.email}</strong>
                  <small>{profile.email}</small>
                </span>
                <select
                  aria-label={`Rôle de ${profile.email}`}
                  value={profile.role}
                  disabled={saving}
                  onChange={(event) => {
                    if (
                      window.confirm(`Modifier le rôle de ${profile.email} ?`)
                    )
                      void post({
                        action: 'set_role',
                        profileId: profile.id,
                        role: event.target.value,
                      });
                  }}
                >
                  <option value="commercial">commercial</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </main>
  );
}
