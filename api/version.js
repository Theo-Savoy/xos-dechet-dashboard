// GET /api/version — Marqueur de la dernière action de traitement.
// Sert de clé de cache au front : /api/refresh?v=<version> ; une action en lot
// crée un nouveau blob history/ => nouvelle version => le cache CDN (24h)
// saute pour tous les utilisateurs, pas seulement celui qui a agi.
// Auth cookie gérée par middleware.js, rien à faire ici.
import { list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    let latest = '0';
    let cursor;
    do {
      const page = await list({ prefix: 'history/', token, cursor });
      for (const b of page.blobs) {
        if (b.pathname > latest) latest = b.pathname;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return res.status(200).json({ version: latest });
  } catch (e) {
    // En cas de pépin Blob, une version stable dégrade en simple cache 24h.
    return res.status(200).json({ version: '0' });
  }
}
