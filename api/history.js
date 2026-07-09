// GET /api/history — Journal des opportunités traitées (Vercel Blob).
// Auth cookie gérée par middleware.js, rien à faire ici.
import { get } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Méthode non autorisée, utiliser GET.' });
  }

  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const existing = await get('history.json', { access: 'private', token: blobToken });
    if (!existing) {
      return res.status(200).json({ entries: [] });
    }
    const text = await new Response(existing.stream).text();
    let journal;
    try {
      journal = JSON.parse(text);
    } catch {
      journal = { entries: [] };
    }
    if (!Array.isArray(journal.entries)) journal = { entries: [] };
    return res.status(200).json(journal);
  } catch (e) {
    return res.status(500).json({ error: 'blob_error', message: String(e && e.message || e).slice(0, 300) });
  }
}
