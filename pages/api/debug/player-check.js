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

  try {
    const detail = await fetchNuxtData(`/en/players/${id}`);
    const widget = detail['player-previous-tournaments'];
    const playerInfo = detail['player-page']?.pageData?.player || detail.player || null;
    return res.status(200).json({
      id,
      playerName: playerInfo ? `${playerInfo.first_name_en || ''} ${playerInfo.surname_en || ''}`.trim() : null,
      pagination: widget?.pagination,
      firstItems: (widget?.items || []).slice(0, 8)
    });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
