// POST /api/update — Mise à jour en lot d'opportunités Salesforce + journal Blob.
// Auth cookie gérée par middleware.js, rien à faire ici.
import { put } from '@vercel/blob';

const SF_ID = /^[a-zA-Z0-9]{15,18}$/;
const DATE_YMD = /^\d{4}-\d{2}-\d{2}$/;

// Horodatage ISO-8601 en Europe/Paris (ex: 2026-07-09T14:30:05+02:00).
function parisNowISO() {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  }).format(new Date());
  const m = s.match(/^(\S+) (\S+) GMT([+-]\d{2}:\d{2})$/);
  return m ? m[1] + 'T' + m[2] + m[3] : new Date().toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Méthode non autorisée, utiliser POST.' });
  }

  // ── Validation du payload (trust boundary) ──
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const opps = body.opps;
  const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};

  if (!Array.isArray(opps) || opps.length < 1 || opps.length > 200) {
    return res.status(400).json({ error: 'invalid_payload', message: 'opps doit être un tableau de 1 à 200 opportunités.' });
  }
  for (const o of opps) {
    if (!o || typeof o.id !== 'string' || !SF_ID.test(o.id)) {
      return res.status(400).json({ error: 'invalid_payload', message: 'Chaque opportunité doit avoir un id Salesforce valide (15 à 18 caractères alphanumériques).' });
    }
  }

  const fields = {};        // champs Salesforce
  const journalChanges = {}; // changes nettoyés pour le journal
  if (changes.owner_id != null && changes.owner_id !== '') {
    if (typeof changes.owner_id !== 'string' || !SF_ID.test(changes.owner_id)) {
      return res.status(400).json({ error: 'invalid_payload', message: 'owner_id doit être un id Salesforce valide.' });
    }
    fields.OwnerId = changes.owner_id;
    journalChanges.owner_id = changes.owner_id;
  }
  if (changes.close_date != null && changes.close_date !== '') {
    if (typeof changes.close_date !== 'string' || !DATE_YMD.test(changes.close_date)) {
      return res.status(400).json({ error: 'invalid_payload', message: 'close_date doit être au format YYYY-MM-DD.' });
    }
    fields.CloseDate = changes.close_date;
    journalChanges.close_date = changes.close_date;
  }
  if (changes.stage != null && changes.stage !== '') {
    if (typeof changes.stage !== 'string') {
      return res.status(400).json({ error: 'invalid_payload', message: 'stage doit être une chaîne de caractères.' });
    }
    // Validité de la valeur déléguée à Salesforce (picklist restreinte).
    fields.StageName = changes.stage;
    journalChanges.stage = changes.stage;
  }
  if (changes.loss_reason != null && changes.loss_reason !== '') {
    if (typeof changes.loss_reason !== 'string') {
      return res.status(400).json({ error: 'invalid_payload', message: 'loss_reason doit être une chaîne de caractères.' });
    }
    fields.Raison_de_perte_V2__c = changes.loss_reason;
    journalChanges.loss_reason = changes.loss_reason;
  }
  if (!('OwnerId' in fields) && !('CloseDate' in fields) && !('StageName' in fields)) {
    return res.status(400).json({ error: 'invalid_payload', message: 'changes doit contenir au moins une clé parmi owner_id, close_date, stage.' });
  }

  // ── OAuth Salesforce (même flux que api/refresh.py) ──
  const clientId = process.env.SF_CLIENT_ID || '';
  const clientSecret = process.env.SF_CLIENT_SECRET || '';
  const refreshToken = process.env.SF_REFRESH_TOKEN || '';
  const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';
  const instanceUrl = process.env.SF_INSTANCE_URL || 'https://db0000000d7rdeay.my.salesforce.com';

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'missing_env', message: 'SF credentials not configured' });
  }

  let accessToken;
  try {
    const tokenResp = await fetch(loginUrl + '/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      return res.status(502).json({ error: 'salesforce_auth_error', message: errText.slice(0, 500) });
    }
    accessToken = (await tokenResp.json()).access_token;
  } catch (e) {
    return res.status(502).json({ error: 'salesforce_auth_error', message: String(e && e.message || e).slice(0, 500) });
  }

  // ── PATCH composite en lot (≤200) ──
  let results;
  try {
    const patchResp = await fetch(instanceUrl + '/services/data/v67.0/composite/sobjects', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allOrNone: false,
        records: opps.map(o => ({ attributes: { type: 'Opportunity' }, id: o.id, ...fields })),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!patchResp.ok) {
      const errText = await patchResp.text();
      return res.status(502).json({ error: 'salesforce_api_error', message: errText.slice(0, 500) });
    }
    results = await patchResp.json(); // [{id, success, errors}] dans l'ordre des records
  } catch (e) {
    return res.status(502).json({ error: 'salesforce_api_error', message: String(e && e.message || e).slice(0, 500) });
  }

  const normalized = opps.map((o, i) => {
    const r = (Array.isArray(results) && results[i]) || {};
    return { id: r.id || o.id, success: !!r.success, errors: Array.isArray(r.errors) ? r.errors : [] };
  });
  const updated = normalized.filter(r => r.success).length;
  const failed = normalized.length - updated;

  // ── Journal Blob (seulement si au moins une réussite) ──
  // Un blob immuable par action (pathname unique) : pas de read-modify-write,
  // car la relecture d'un blob réécrit est servie par un cache (~60s) et
  // ferait perdre des entrées entre deux actions rapprochées.
  if (updated > 0) {
    try {
      const entry = {
        at: parisNowISO(),
        changes: journalChanges,
        opps: opps.map((o, i) => ({
          id: o.id,
          name: typeof o.name === 'string' ? o.name : '',
          account: typeof o.account === 'string' ? o.account : '',
          owner: typeof o.owner === 'string' ? o.owner : '',
          success: normalized[i].success,
          error: normalized[i].success
            ? null
            : (normalized[i].errors.map(e => e && e.message).filter(Boolean).join(' ; ') || 'Erreur inconnue'),
        })),
      };
      // Date.now() sur 13 chiffres => tri lexicographique = chronologique
      const pathname = 'history/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json';
      await put(pathname, JSON.stringify(entry), {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        contentType: 'application/json',
      });
    } catch (e) {
      return res.status(500).json({
        error: 'blob_error',
        message: 'Mise à jour Salesforce effectuée (' + updated + ' réussie(s), ' + failed + ' échouée(s)) mais échec de l\'écriture du journal : ' + String(e && e.message || e).slice(0, 300),
      });
    }
  }

  return res.status(200).json({ updated, failed, results: normalized });
}
