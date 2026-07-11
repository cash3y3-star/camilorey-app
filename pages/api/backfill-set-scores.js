// ============================================================
// CAMILOREY — relleno de marcador set por set vía Sofascore
// Vive en Vercel (no en GitHub Actions) porque Sofascore bloquea con
// 403 las IPs de los runners de GitHub Actions — confirmado con
// headers de navegador real, sigue bloqueado, así que es bloqueo por
// reputación de IP, no de headers. Vercel corre en otra
// infraestructura y sí llega.
//
// Disparado por un cronjob externo (cron-job.org) cada cierto tiempo.
// Revisa los partidos ya terminados en las últimas 24h que todavía no
// tienen set_scores, y los llena si los encuentra en Sofascore.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { fetchRecentFinishedEvents, findSetScores } from '../../lib/sofascore';

export default async function handler(req, res) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: missing, error } = await supabase
      .from('matches')
      .select('id, player_a_id, player_b_id')
      .eq('status', 'finished')
      .is('set_scores', null)
      .gte('scheduled_at', since)
      .limit(200);
    if (error) throw new Error(error.message);

    if (!missing || missing.length === 0) {
      return res.status(200).json({ checked: 0, updated: 0 });
    }

    const playerIds = [...new Set(missing.flatMap((m) => [m.player_a_id, m.player_b_id]))];
    const { data: players } = await supabase.from('players').select('id, name').in('id', playerIds);
    const playersById = new Map((players || []).map((p) => [p.id, p]));

    const events = await fetchRecentFinishedEvents();

    let updated = 0;
    for (const m of missing) {
      const a = playersById.get(m.player_a_id);
      const b = playersById.get(m.player_b_id);
      if (!a || !b) continue;
      const sets = findSetScores(events, a.name, b.name);
      if (!sets) continue;
      const { error: updErr } = await supabase.from('matches').update({ set_scores: sets }).eq('id', m.id);
      if (!updErr) updated++;
    }

    return res.status(200).json({ checked: missing.length, updated });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
