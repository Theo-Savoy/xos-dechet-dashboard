// GET /api/history — Journal des opportunités traitées (Vercel Blob).
// Un blob immuable par action sous history/ ; on liste puis on agrège.
// Auth cookie gérée par middleware.js, rien à faire ici.
import { get, list } from '@vercel/blob';

const MAX_ENTRIES = 200; // ponytail: au-delà, paginer via le cursor de list()

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Méthode non autorisée, utiliser GET.' });
  }

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const blobs = [];
    let cursor;
    do {
      const page = await list({ prefix: 'history/', token, cursor });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    // Pathnames préfixés par Date.now() => tri décroissant = plus récentes en premier
    blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    const latest = blobs.slice(0, MAX_ENTRIES);

    const entries = (
      await Promise.all(
        latest.map(async (b) => {
          try {
            const blob = await get(b.pathname, { access: 'private', token });
            if (!blob) return null;
            return JSON.parse(await new Response(blob.stream).text());
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);

    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: 'blob_error', message: String(e && e.message || e).slice(0, 300) });
  }
}
