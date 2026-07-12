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

  const result = picks
    .map((pick) => {
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
        time: timeLabel(match.scheduled_at),
        tournament: tournament?.name || 'Torneo',
        market: pick.market,
        confidence,
        tier: confidenceTier(confidence),
        odds: pick.odds ? Number(pick.odds) : null,
        analysis: null,
        history: [],
        streakLabel: null,
        h2h: null,
        h2hTotal: 0,
        result: pick.result,
        matchStatus: status
      };
    })
    .filter(Boolean);

  return res.status(200).json({ picks: result });
}
