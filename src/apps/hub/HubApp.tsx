import { useEffect, useState } from "react";
import { Button, GlassCard, Tag } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import "./hub.css";

type Status = {
  role: string;
  capabilities: { manageSettings: boolean; manageRoles: boolean };
  profile: { email: string | null; fullName: string | null; sfUserId: string | null };
  salesforce: { connected: boolean; dailyApiRequests: { max: number; remaining: number } | null };
  cache: { cleaner: { version: string | null } };
  version: string;
  settings?: Array<{ id: number; key: string; value: unknown }>;
  profiles?: Array<{ id: string; email: string; full_name: string | null; sf_user_id: string | null; role: string }>;
};

async function statusRequest(token: string) {
  const response = await fetch("/api/status", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("status_unavailable");
  return response.json() as Promise<Status>;
}

export default function HubApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("{}");

  const refresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("missing_session");
    setToken(session.access_token);
    setStatus(await statusRequest(session.access_token));
  };

  useEffect(() => { refresh().catch(() => setError(true)); }, []);

  const post = async (body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const response = await fetch("/api/status", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("write_failed");
      await refresh();
    } finally { setSaving(false); }
  };

  if (error) return <div className="hub-app hub-app__state">Impossible de charger le Hub.</div>;
  if (!status) return <div className="hub-app hub-app__state">Chargement du Hub…</div>;
  const quota = status.salesforce.dailyApiRequests;

  return (
    <main className="hub-app">
      <header className="hub-header">
        <div><Tag variant="accent">Panneau système</Tag><h2>Hub</h2></div>
        <Button variant="secondary" onClick={() => refresh().catch(() => setError(true))}>Actualiser</Button>
      </header>
      <section className="hub-grid">
        <GlassCard className="hub-panel"><p className="hub-eyebrow">Compte</p><h3>{status.profile.fullName || "Utilisateur X OS"}</h3>
          <dl className="hub-details"><div><dt>Email</dt><dd>{status.profile.email || "—"}</dd></div><div><dt>Rôle</dt><dd><Tag>{status.role}</Tag></dd></div><div><dt>Salesforce</dt><dd>{status.profile.sfUserId ? `Mappé · ${status.profile.sfUserId}` : "Non mappé"}</dd></div></dl>
          <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Déconnexion</Button>
        </GlassCard>
        <GlassCard className="hub-panel"><p className="hub-eyebrow">Statut</p><h3>Services</h3>
          <div className="hub-status"><span>Salesforce <Tag variant={status.salesforce.connected ? "success" : "warning"}>{status.salesforce.connected ? "OK" : "KO"}</Tag></span><span>Quota <strong>{quota ? `${quota.remaining.toLocaleString("fr-FR")} / ${quota.max.toLocaleString("fr-FR")}` : "Indisponible"}</strong></span><span>Cache Cleaner <strong>{status.cache.cleaner.version || "Non disponible"}</strong></span><span>Déploiement <strong>{status.version}</strong></span></div>
        </GlassCard>
      </section>
      {status.capabilities.manageSettings && <GlassCard className="hub-panel"><p className="hub-eyebrow">Équipe</p><h3>Configuration équipe</h3>
        <div className="hub-settings">{status.settings?.map((setting) => <div className="hub-setting" key={setting.id}><code>{setting.key}</code><span>{JSON.stringify(setting.value)}</span><Button variant="secondary" disabled={saving} onClick={() => post({ action: "update_settings", operation: "delete", key: setting.key })}>Supprimer</Button></div>)}</div>
        <form className="hub-form" onSubmit={(event) => { event.preventDefault(); try { void post({ action: "update_settings", operation: "upsert", key, value: JSON.parse(value) }); setKey(""); } catch { setError(true); } }}>
          <input aria-label="Clé du paramètre" value={key} onChange={(event) => setKey(event.target.value)} placeholder="cleaner_late_days" required />
          <input aria-label="Valeur JSON" value={value} onChange={(event) => setValue(event.target.value)} required />
          <Button disabled={saving}>Enregistrer</Button>
        </form>
      </GlassCard>}
      {status.capabilities.manageSettings && !status.capabilities.manageRoles && <GlassCard className="hub-panel"><p className="hub-eyebrow">Équipe</p><h3>Profils</h3>
        <div className="hub-profiles">{status.profiles?.map((profile) => <div className="hub-profile" key={profile.id}><span><strong>{profile.full_name || profile.email}</strong><small>{profile.email}</small></span><Tag>{profile.role}</Tag></div>)}</div>
      </GlassCard>}
      {status.capabilities.manageRoles && <GlassCard className="hub-panel"><p className="hub-eyebrow">Administration</p><h3>Accès & rôles</h3>
        <div className="hub-profiles">{status.profiles?.map((profile) => <div className="hub-profile" key={profile.id}><span><strong>{profile.full_name || profile.email}</strong><small>{profile.email}</small></span><select aria-label={`Rôle de ${profile.email}`} value={profile.role} disabled={saving} onChange={(event) => { if (window.confirm(`Modifier le rôle de ${profile.email} ?`)) void post({ action: "set_role", profileId: profile.id, role: event.target.value }); }}><option value="commercial">commercial</option><option value="manager">manager</option><option value="admin">admin</option></select></div>)}</div>
      </GlassCard>}
    </main>
  );
}
