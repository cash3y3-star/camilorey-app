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

  // Antes solo traía winner_id y devolvía el conteo agregado — sin
  // scheduled_at/sets no había forma de armar la lista partido a
  // partido con fecha real que sí tiene el H2H de la tarjeta de picks
  // (H2HMatchList). Pedido 2026-07-19: "arregla el H2H de todos con
  // fecha real" — este modal (Calendario → detalle de partido) era el
  // único lugar que se había quedado con el H2H "mudo", solo el
  // marcador agregado.
  async function h2hRecord(idA, idB) {
    const { data } = await supabase
      .from('matches')
      .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
      .eq('status', 'finished')
      .or(`and(player_a_id.eq.${idA},player_b_id.eq.${idB}),and(player_a_id.eq.${idB},player_b_id.eq.${idA})`)
      .order('scheduled_at', { ascending: false })
      .limit(20);
    const rows = data || [];
    return {
      winsA: rows.filter((m) => m.winner_id === idA).length,
      winsB: rows.filter((m) => m.winner_id === idB).length,
      matches: rows.map((m) => {
        const isA = m.player_a_id === idA;
        return {
          date: m.scheduled_at,
          setsFor: isA ? m.sets_a : m.sets_b,
          setsAgainst: isA ? m.sets_b : m.sets_a,
          win: m.winner_id === idA,
          favoredWasHome: isA
        };
      })
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
    h2hTotal: h2h.winsA + h2h.winsB,
    h2hMatches: h2h.matches
  });
}
