// ============================================================
// CAMILOREY — verificación temporal del resultado del backfill de
// historial (scripts/backfill-history.js). Se borra después de usarlo.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ count: tournamentsCount }, { count: matchesCount }, { count: finishedCount }] = await Promise.all([
    supabase.from('tournaments').select('*', { count: 'exact', head: true }),
    supabase.from('matches').select('*', { count: 'exact', head: true }),
    supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'finished')
  ]);

  const { data: players } = await supabase.from('players').select('id, name').or('name.ilike.%steffan%,name.ilike.%vitrovyj%');

  const details = [];
  for (const p of players || []) {
    const { count } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`)
      .eq('status', 'finished');
    details.push({ id: p.id, name: p.name, finishedMatches: count });
  }

  return res.status(200).json({ tournamentsCount, matchesCount, finishedCount, players: details });
}
