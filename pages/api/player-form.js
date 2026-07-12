// ============================================================
// CAMILOREY — forma reciente + H2H de los dos jugadores de un partido
// Se consulta bajo demanda cuando alguien abre el modal de un partido
// desde Calendario (o cualquier otro lado que use MatchDetailModal),
// para no calcularlo de más en cada fila de la lista.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const playerAId = Number(req.query.playerAId);
  const playerBId = Number(req.query.playerBId);
  if (!playerAId || !playerBId) return res.status(400).json({ error: 'faltan playerAId/playerBId' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  async function recentForm(playerId) {
    const { data } = await supabase
      .from('matches')
      .select('winner_id, player_a_id, player_b_id')
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .eq('status', 'finished')
      .order('scheduled_at', { ascending: false })
      .limit(10);
    return (data || []).map((m) => (m.winner_id === playerId ? 1 : 0)).reverse();
  }

  async function h2hRecord(idA, idB) {
    const { data } = await supabase
      .from('matches')
      .select('winner_id')
      .eq('status', 'finished')
      .or(`and(player_a_id.eq.${idA},player_b_id.eq.${idB}),and(player_a_id.eq.${idB},player_b_id.eq.${idA})`)
      .limit(20);
    return {
      winsA: (data || []).filter((m) => m.winner_id === idA).length,
      winsB: (data || []).filter((m) => m.winner_id === idB).length
    };
  }

  const [historyA, historyB, h2h] = await Promise.all([
    recentForm(playerAId),
    recentForm(playerBId),
    h2hRecord(playerAId, playerBId)
  ]);

  return res.status(200).json({
    historyA,
    historyB,
    h2h: `${h2h.winsA}-${h2h.winsB}`,
    h2hTotal: h2h.winsA + h2h.winsB
  });
}
