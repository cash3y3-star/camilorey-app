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
  const playersById = new Map();

  async function recentForm(playerId) {
    const { data } = await supabase
      .from('matches')
      .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .eq('status', 'finished')
      .order('scheduled_at', { ascending: false })
      .limit(10);
    const rows = data || [];
    const opponentIds = [...new Set(rows.map((m) => (m.player_a_id === playerId ? m.player_b_id : m.player_a_id)))];
    const missing = opponentIds.filter((id) => id && !playersById.has(id));
    if (missing.length) {
      const { data: extra } = await supabase.from('players').select('id, name').in('id', missing);
      for (const p of extra || []) playersById.set(p.id, p);
    }
    return rows.map((m) => {
      const isA = m.player_a_id === playerId;
      const oppId = isA ? m.player_b_id : m.player_a_id;
      return {
        date: m.scheduled_at,
        opponent: playersById.get(oppId)?.name || '?',
        setsFor: isA ? m.sets_a : m.sets_b,
        setsAgainst: isA ? m.sets_b : m.sets_a,
        win: m.winner_id === playerId
      };
    });
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
