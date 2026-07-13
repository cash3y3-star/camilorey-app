// ============================================================
// CAMILOREY — estado de partidos del día, para refrescar Calendario
// solo (sin recargar la página). Misma lógica de ventana/estado que
// getServerSideProps usa para "matches", pero como endpoint aparte
// para poder consultarlo cada tantos segundos desde el cliente.
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const selectedDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;

  let windowStart, windowEnd;
  if (selectedDate) {
    windowStart = new Date(`${selectedDate}T00:00:00-05:00`).toISOString();
    windowEnd = new Date(`${selectedDate}T23:59:59-05:00`).toISOString();
  } else {
    windowStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    windowEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  }

  // OJO: con .order ascending + .limit, un límite bajo corta los
  // partidos MÁS RECIENTES cuando el día ya acumuló más partidos que
  // el límite antes de "ahora" — así desaparecían los que están en
  // vivo al entrar a un día específico (ej. "hoy" desde el selector
  // de día, que sí manda ?date= aunque sea hoy mismo). 1000 deja
  // margen de sobra para un día completo de esta liga.
  const { data: windowMatches } = await supabase
    .from('matches')
    .select('*')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(1000);

  const playerIds = [...new Set((windowMatches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
  const { data: players } = playerIds.length
    ? await supabase.from('players').select('id, name, avatar_url, avatar_cutout_url').in('id', playerIds)
    : { data: [] };
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const tournamentIds = [...new Set((windowMatches || []).map((m) => m.tournament_id))].filter(Boolean);
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  const windowMatchIds = (windowMatches || []).map((m) => m.id);
  const { data: windowPicks } = windowMatchIds.length
    ? await supabase.from('picks').select('id, match_id, result').in('match_id', windowMatchIds)
    : { data: [] };
  const pickResultByMatchId = new Map((windowPicks || []).map((p) => [p.match_id, p.result]));
  const pendingPickIdByMatchId = new Map(
    (windowPicks || []).filter((p) => p.result === 'pending').map((p) => [p.match_id, p.id])
  );

  const matches = (windowMatches || []).map((m) => {
    const a = playersById.get(m.player_a_id);
    const b = playersById.get(m.player_b_id);
    const t = tournamentsById.get(m.tournament_id);
    let status = 'soon';
    if (m.status === 'finished') status = 'done';
    else if (m.status === 'live') status = 'live';
    else if (new Date(m.scheduled_at) <= new Date()) status = 'live';
    const pickResult = pickResultByMatchId.get(m.id);
    return {
      matchId: m.id,
      pickId: pendingPickIdByMatchId.get(m.id) || null,
      time: timeLabel(m.scheduled_at),
      tournament: t?.name || 'Torneo',
      players: `${a?.name || '?'} vs ${b?.name || '?'}`,
      playerA: a?.name || null,
      playerB: b?.name || null,
      playerAId: m.player_a_id,
      playerBId: m.player_b_id,
      playerAInitials: initialsOf(a?.name),
      playerBInitials: initialsOf(b?.name),
      playerAAvatar: a?.avatar_cutout_url || a?.avatar_url || null,
      playerBAvatar: b?.avatar_cutout_url || b?.avatar_url || null,
      playerAHasCutout: Boolean(a?.avatar_cutout_url),
      playerBHasCutout: Boolean(b?.avatar_cutout_url),
      tournamentId: m.tournament_id,
      sourceId: m.source_id,
      status,
      score: status === 'done' && m.sets_a != null && m.sets_b != null ? `${m.sets_a}-${m.sets_b}` : null,
      setScores: status === 'done' ? m.set_scores || null : null,
      pickResult: status === 'done' && (pickResult === 'hit' || pickResult === 'miss') ? pickResult : null
    };
  });

  return res.status(200).json({ matches });
}
