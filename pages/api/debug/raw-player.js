// ============================================================
// CAMILOREY — debug temporal: JSON crudo de la página de un jugador
// en tt.league-pro.com, para ver si trae su historial completo de
// partidos (y así completar "forma reciente" sin depender de un
// tercero que nos pueda bloquear como Sofascore).
// ============================================================

import { fetchNuxtData } from '../../../lib/tt';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const id = req.query.id || '826';

  try {
    const detail = await fetchNuxtData(`/en/players/${id}`);
    return res.status(200).json({ id, keys: Object.keys(detail), detail });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
