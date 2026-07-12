import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import "./targets.css";

type MonthlyIndicative = { month: string; label: string; weight: number; raw: number; indicative: number };
type MonthTemplate = { month: string; weight: number };

type TargetRow = {
  sf_user_id: string;
  name: string;
  email: string | null;
  role: string | null;
  quarterly_target: number | null;
  monthly_indicative: MonthlyIndicative[];
};

type TargetsPayload = {
  quarter: { label: string; from: string; to: string };
  seasonality: { as_of: string; sample_years: number[] } | null;
  month_template: MonthTemplate[];
  rows: TargetRow[];
};

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const MONTH_LABELS: Record<string, string> = {
  "01": "Janv.", "02": "Fév.", "03": "Mars", "04": "Avr.", "05": "Mai", "06": "Juin",
  "07": "Juil.", "08": "Août", "09": "Sept.", "10": "Oct.", "11": "Nov.", "12": "Déc.",
};

async function fetchTargets(token: string) {
  const response = await fetch("/api/weekly-targets", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("targets_unavailable");
  return response.json() as Promise<TargetsPayload>;
}

async function saveTargets(token: string, quarter: string, values: Record<string, number | null>) {
  const response = await fetch("/api/weekly-targets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ quarter, values }),
  });
  if (!response.ok) throw new Error("targets_save_failed");
}

function parseInput(value: string) {
  const trimmed = value.replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

function roundToMagnitude(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const normalized = value / base;
  let factor = 10;
  if (normalized < 1.5) factor = 1;
  else if (normalized < 3.5) factor = 2.5;
  else if (normalized < 7.5) factor = 5;
  return Math.round(factor * base);
}

function monthlyFromTemplate(quarterly: number, template: MonthTemplate[]) {
  if (!quarterly || !template.length) return [];
  return template.map((entry) => {
    const raw = quarterly * entry.weight;
    return {
      month: entry.month,
      label: MONTH_LABELS[entry.month] || entry.month,
      weight: entry.weight,
      raw,
      indicative: roundToMagnitude(raw),
    };
  });
}

export default function TargetsEditor({ token }: { token: string }) {
  const [payload, setPayload] = useState<TargetsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const next = await fetchTargets(token);
      setPayload(next);
      setDraft(Object.fromEntries(next.rows.map((row) => [
        row.sf_user_id,
        row.quarterly_target === null ? "" : String(row.quarterly_target),
      ])));
      setSaved(false);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const preview = useMemo(() => {
    if (!payload) return [];
    return payload.rows.map((row) => {
      const parsed = parseInput(draft[row.sf_user_id] ?? "");
      const quarterly = parsed === null || Number.isNaN(parsed) ? null : parsed;
      return {
        ...row,
        quarterly_target: quarterly,
        monthly_indicative: quarterly ? monthlyFromTemplate(quarterly, payload.month_template) : [],
      };
    });
  }, [draft, payload]);

  if (error) return <p className="hub-targets-error">Impossible de charger les objectifs.</p>;
  if (!payload) return <p className="hub-targets-loading">Chargement des objectifs…</p>;

  const dirty = payload.rows.some((row) => {
    const parsed = parseInput(draft[row.sf_user_id] ?? "");
    const current = row.quarterly_target;
    if (parsed === null && current === null) return false;
    if (parsed === null || current === null) return true;
    return parsed !== current;
  });

  return (
    <div className="hub-targets">
      <div className="hub-targets-intro">
        <p>
          <strong>{payload.quarter.label}</strong>
          {payload.seasonality
            ? ` · pondération sur ${payload.seasonality.sample_years.length || "—"} ans`
            : " · mois répartis à parts égales"}
        </p>
        <p className="hub-targets-hint">Objectif trimestre en €. Les mois sont indicatifs, arrondis à l’ordre de grandeur.</p>
      </div>
      <div className="hub-targets-table" role="table" aria-label="Objectifs trimestre">
        <div className="hub-targets-head" role="row">
          <span role="columnheader">Commercial</span>
          <span role="columnheader">Objectif TQ</span>
          <span role="columnheader">Mois indicatifs</span>
        </div>
        {preview.map((row) => (
          <div className="hub-targets-row" role="row" key={row.sf_user_id}>
            <div className="hub-targets-person" role="cell">
              <strong>{row.name}</strong>
              <small>{row.email}</small>
            </div>
            <div className="hub-targets-input" role="cell">
              <input
                type="text"
                inputMode="numeric"
                aria-label={`Objectif trimestre de ${row.name}`}
                value={draft[row.sf_user_id] ?? ""}
                placeholder="—"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, [row.sf_user_id]: event.target.value }));
                  setSaved(false);
                }}
              />
              <span>€</span>
            </div>
            <div className="hub-targets-months" role="cell">
              {row.monthly_indicative.length
                ? row.monthly_indicative.map((month) => (
                  <span className="hub-targets-month" key={month.month} title={`${Math.round(month.weight * 100)} % · ${money.format(month.raw)} brut`}>
                    {month.label} ~{money.format(month.indicative)}
                  </span>
                ))
                : <span className="hub-targets-month hub-targets-month--empty">—</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="hub-targets-actions">
        <Button disabled={saving || !dirty} onClick={() => {
          void (async () => {
            setSaving(true);
            try {
              const values: Record<string, number | null> = {};
              for (const row of payload.rows) {
                const parsed = parseInput(draft[row.sf_user_id] ?? "");
                if (Number.isNaN(parsed)) return;
                values[row.sf_user_id] = parsed;
              }
              await saveTargets(token, payload.quarter.label, values);
              await load();
              setSaved(true);
            } catch {
              setError(true);
            } finally {
              setSaving(false);
            }
          })();
        }}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {saved && !dirty && <span className="hub-targets-saved">Enregistré</span>}
      </div>
    </div>
  );
}
