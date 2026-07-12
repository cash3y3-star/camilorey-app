// ============================================================
// CAMILOREY — verificación temporal: cuánto historial de carrera
// expone tt.league-pro.com para un jugador puntual. Se borra después.
// ============================================================

import { fetchNuxtData } from '../../../lib/tt';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'falta id' });
  const maxPages = Number(req.query.maxPages || 5);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const ids = [];
    const pageLog = [];
    let page = 1;
    while (page <= maxPages) {
      const detail = await fetchNuxtData(`/en/players/${id}?page=${page}`);
      const widget = detail['player-previous-tournaments'];
      const items = widget?.items || [];
      pageLog.push({ page, itemCount: items.length, pagination: widget?.pagination, firstId: items[0]?.id });
      if (items.length === 0) break;
      for (const item of items) ids.push(item.id);
      const { total_items, limit, offset } = widget.pagination || {};
      if (offset == null || offset + limit >= total_items) break;
      page++;
      await sleep(300);
    }
    return res.status(200).json({ id, totalCollected: ids.length, uniqueCollected: new Set(ids).size, pageLog });
  } catch (e) {
    return res.status(502).json({ error: e.message, stack: e.stack });
  }
}
