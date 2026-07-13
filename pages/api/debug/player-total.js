// ============================================================
// CAMILOREY — verificación temporal: cuántos torneos de carrera tiene
// un jugador en tt.league-pro.com. Se borra después de usarlo.
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
    return res.status(200).json({ id, pagination: widget?.pagination });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
