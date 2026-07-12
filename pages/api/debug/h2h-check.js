// ============================================================
// CAMILOREY — verificación temporal: ¿le falta a nuestra base algún
// cruce directo real entre dos jugadores puntuales? Se borra después.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let idA = Number(req.query.idA);
  let idB = Number(req.query.idB);

  if (!idA && req.query.nameA) {
    const { data } = await supabase.from('players').select('id, name').ilike('name', `%${req.query.nameA}%`);
    return res.status(200).json({ searchA: data });
  }
  if (!idB && req.query.nameB) {
    const { data } = await supabase.from('players').select('id, name').ilike('name', `%${req.query.nameB}%`);
    return res.status(200).json({ searchB: data });
  }
  if (!idA || !idB) return res.status(400).json({ error: 'faltan idA/idB (o nameA/nameB)' });

  const { data: matches } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, sets_a, sets_b, tournament_id')
    .or(`and(player_a_id.eq.${idA},player_b_id.eq.${idB}),and(player_a_id.eq.${idB},player_b_id.eq.${idA})`);

  const { count: tournamentsA } = await supabase
    .from('matches')
    .select('tournament_id', { count: 'exact', head: true })
    .or(`player_a_id.eq.${idA},player_b_id.eq.${idA}`);
  const { count: tournamentsB } = await supabase
    .from('matches')
    .select('tournament_id', { count: 'exact', head: true })
    .or(`player_a_id.eq.${idB},player_b_id.eq.${idB}`);

  return res.status(200).json({ idA, idB, matches, matchesForA: tournamentsA, matchesForB: tournamentsB });
}
