// ============================================================
// CAMILOREY — detalle completo de los picks que alguien sigue
// Se usa en la pestaña Seguidos, que NO debe ocultar un pick solo
// porque el partido ya arrancó o está por arrancar (esa regla es
// para "Picks", no para lo que alguien está siguiendo a propósito
// para recibir notificación). Los ids vienen de una consulta ya
// protegida por RLS en el cliente (followed_picks), así que esto solo
// resuelve el detalle público de esos ids — no hace falta autenticar
// esta llamada.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function initialsOf(name) {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function timeLabel(iso) {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

function confidenceTier(confidence) {
  if (confidence >= 85) return 'alta';
  if (confidence >= 70) return 'media';
  return 'baja';
}

// history viene del más reciente al más viejo (index 0 = último
// partido jugado) — la racha se cuenta desde el principio del array.
function streakLabelFromHistory(history) {
  if (!history || history.length === 0) return null;
  const last = history[0].win;
  let count = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].win === last) count++;
    else break;
  }
  return `${count}${last ? 'W' : 'L'}`;
}

function buildAnalysis(factors) {
  if (!factors) return 'Pick generado sin desglose disponible.';
  const pct = (x) => Math.round(Math.abs(x) * 100);
  const bits = [];
  if (factors.ratingScore) bits.push(`rating (${pct(factors.ratingScore)}%)`);
  if (factors.streakScore) bits.push(`racha reciente (${pct(factors.streakScore)}%)`);
  if (factors.h2hScore) bits.push(`cruce directo (${pct(factors.h2hScore)}%)`);
  if (bits.length === 0) return 'Pick generado sin suficiente historial todavía.';
  return `Favorito según ${bits.join(', ')}.`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const ids = (req.query.ids || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return res.status(200).json({ picks: [] });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: picks } = await supabase.from('picks').select('*').in('id', ids);
  if (!picks || picks.length === 0) return res.status(200).json({ picks: [] });

  const matchIds = [...new Set(picks.map((p) => p.match_id))];
  const { data: matches } = await supabase.from('matches').select('*').in('id', matchIds);
  const matchesById = new Map((matches || []).map((m) => [m.id, m]));

  const playerIds = [...new Set((matches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
  const { data: players } = playerIds.length
    ? await supabase.from('players').select('id, name, avatar_url, avatar_cutout_url').in('id', playerIds)
    : { data: [] };
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const tournamentIds = [...new Set((matches || []).map((m) => m.tournament_id).filter(Boolean))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  async function recentForm(playerId) {
    if (!playerId) return [];
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
      const { data: extra } = await supabase.from('players').select('id, name, avatar_url, avatar_cutout_url').in('id', missing);
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

  async function h2hRecord(idA, idB, nameB) {
    if (!idA || !idB) return { winsA: 0, winsB: 0, matches: [] };
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
          opponent: nameB,
          setsFor: isA ? m.sets_a : m.sets_b,
          setsAgainst: isA ? m.sets_b : m.sets_a,
          win: m.winner_id === idA
        };
      })
    };
  }

  const result = (
    await Promise.all(
      picks.map(async (pick) => {
      const match = matchesById.get(pick.match_id);
      if (!match) return null;
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent =
        pick.predicted_winner_id === match.player_a_id
          ? playersById.get(match.player_b_id)
          : playersById.get(match.player_a_id);
      if (!favored || !opponent) return null;
      const tournament = tournamentsById.get(match.tournament_id);

      let status = 'soon';
      if (match.status === 'finished') status = 'done';
      else if (match.status === 'live') status = 'live';
      else if (match.scheduled_at && new Date(match.scheduled_at) <= new Date()) status = 'live';

      const confidence = Math.round(pick.confidence);

      // El resultado final se guarda relativo a jugador A/B, no a
      // favorito/rival — hay que reordenarlo para que quede a favor
      // de "player" (izquierda, el favorito) igual que en el resto de
      // la tarjeta.
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const finalScore =
        status === 'done' && match.sets_a != null && match.sets_b != null
          ? favoredIsA
            ? `${match.sets_a}-${match.sets_b}`
            : `${match.sets_b}-${match.sets_a}`
          : null;
      const finalSetScores =
        status === 'done' && Array.isArray(match.set_scores)
          ? favoredIsA
            ? match.set_scores
            : match.set_scores.map((s) => ({ a: s.b, b: s.a }))
          : null;

      const [history, h2h] = await Promise.all([
        recentForm(favored.id),
        h2hRecord(favored.id, opponent.id, opponent.name)
      ]);

      return {
        id: pick.id,
        matchId: match.id,
        player: favored.name,
        initials: initialsOf(favored.name),
        avatarUrl: favored.avatar_cutout_url || favored.avatar_url || null,
        hasCutout: Boolean(favored.avatar_cutout_url),
        opponent: opponent.name,
        opponentInitials: initialsOf(opponent.name),
        opponentAvatarUrl: opponent.avatar_cutout_url || opponent.avatar_url || null,
        opponentHasCutout: Boolean(opponent.avatar_cutout_url),
        favoredIsA,
        time: timeLabel(match.scheduled_at),
        scheduledAt: match.scheduled_at ? new Date(match.scheduled_at).getTime() : null,
        tournament: tournament?.name || 'Torneo',
        market: pick.market,
        confidence,
        tier: confidenceTier(confidence),
        odds: pick.odds ? Number(pick.odds) : null,
        analysis: buildAnalysis(pick.factors),
        history,
        streakLabel: streakLabelFromHistory(history),
        h2h: `${h2h.winsA}-${h2h.winsB}`,
        h2hTotal: h2h.winsA + h2h.winsB,
        h2hMatches: h2h.matches,
        result: pick.result,
        matchStatus: status,
        score: finalScore,
        setScores: finalSetScores,
        sourceId: match.source_id,
        tournamentId: match.tournament_id
      };
      })
    )
  ).filter(Boolean);

  return res.status(200).json({ picks: result });
}
