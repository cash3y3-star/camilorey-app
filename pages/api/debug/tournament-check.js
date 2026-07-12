// ============================================================
// CAMILOREY — verificación temporal: por qué el backfill no agrega
// un torneo viejo puntual. Se borra después de usarlo.
// ============================================================

import { fetchNuxtData } from '../../../lib/tt';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'falta id' });

  try {
    const detail = await fetchNuxtData(`/en/tournaments/${id}`);
    const pageData = detail['tournament-page']?.pageData;
    if (!pageData) {
      return res.status(200).json({ id, hasPageData: false, topLevelKeys: Object.keys(detail) });
    }
    const sides = pageData.widgets.sides || [];
    const realSides = sides.filter((s) => !s.is_tba);
    return res.status(200).json({
      id,
      hasPageData: true,
      tournamentName: pageData.tournament.name_en,
      startAt: pageData.tournament.start_date,
      sidesCount: sides.length,
      realSidesCount: realSides.length,
      sidesPlaces: realSides.map((s) => ({ id: s.id, player: s.player?.short_name_en, place: s.place, is_tba: s.is_tba })),
      matchesCount: (pageData.widgets.matches || []).length,
      matchesStatuses: (pageData.widgets.matches || []).map((m) => m.status)
    });
  } catch (e) {
    return res.status(502).json({ error: e.message, stack: e.stack });
  }
}
