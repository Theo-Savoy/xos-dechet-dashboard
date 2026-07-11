// POST /api/update — Mise à jour en lot d'opportunités Salesforce + journal Blob.
// Auth cookie gérée par middleware.js, rien à faire ici.
import { put } from '@vercel/blob';
import { verifyJWT } from './_auth.js';
import { getServiceClient } from './_calls/http.js';
import { fetchSFToken, updateSObjects } from './_crm/salesforce.js';

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

  const user = await verifyJWT(req);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Session X OS requise.' });
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
    if (changes.owner_id !== 'ACCOUNT_OWNER') {
      if (typeof changes.owner_id !== 'string' || !SF_ID.test(changes.owner_id)) {
        return res.status(400).json({ error: 'invalid_payload', message: 'owner_id doit être un id Salesforce valide.' });
      }
      fields.OwnerId = changes.owner_id;
    }
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
  if (changes.type_vente != null && changes.type_vente !== '') {
    if (typeof changes.type_vente !== 'string') {
      return res.status(400).json({ error: 'invalid_payload', message: 'type_vente doit être une chaîne de caractères.' });
    }
    fields.Type_de_vente__c = changes.type_vente;
    journalChanges.type_vente = changes.type_vente;
  }
  if (!journalChanges.owner_id && !journalChanges.close_date && !journalChanges.stage && !journalChanges.type_vente) {
    return res.status(400).json({ error: 'invalid_payload', message: 'changes doit contenir au moins une clé parmi owner_id, close_date, stage, type_vente.' });
  }

  // Credential personnel si le commercial a lié Salesforce ; fallback intégration.
  let tokenResult;
  try {
    tokenResult = await fetchSFToken({ client: getServiceClient(), userId: user.id });
  } catch (e) {
    return res.status(502).json({ error: 'salesforce_auth_error', message: String(e && e.message || e).slice(0, 500) });
  }
  if (tokenResult.error || !tokenResult.accessToken) {
    return res.status(502).json({ error: 'salesforce_auth_error', message: tokenResult.error || 'Token Salesforce indisponible.' });
  }

  // ── PATCH composite en lot (≤200) ──
  let results;
  try {
    const updateResult = await updateSObjects(tokenResult.accessToken, 'Opportunity', opps.map(o => {
      const rec = { id: o.id, ...fields };
      const tv = o.type_vente;
      if (fields.Raison_de_perte_V2__c && tv && tv !== '—' && tv !== 'null') rec.Type_de_vente__c = tv;
      if (changes.owner_id === 'ACCOUNT_OWNER' && o.account_owner_id) rec.OwnerId = o.account_owner_id;
      return rec;
    }));
    if (updateResult.error) {
      return res.status(502).json({ error: 'salesforce_api_error', message: updateResult.message || updateResult.error });
    }
    results = updateResult.records;
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
