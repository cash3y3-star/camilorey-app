// ============================================================
// CAMILOREY — picks "exclusivos" completos para Picks VIP (solo
// admin/premium, con el JWT verificado en el servidor). A diferencia
// de getServerSideProps y /api/refresh-data (públicos, sin login), acá
// SÍ pueden viajar los picks con is_exclusive=true (decidido por el
// modelo de ML al generarse, ver lib/ml-exclusive.js) — nunca en
// ningún endpoint público, porque esos props/JSON son visibles sin
// autenticación (hasta con "ver código fuente").
//
// Mismo cálculo de forma reciente + H2H que refresh-data.js, adaptado
// para traer solo picks exclusivos (pendientes + resueltos recientes)
// en vez de todos los públicos.
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

function dayLabel(iso) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const target = fmt(new Date(iso));
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 24 * 3600 * 1000));
  if (target === today) return 'hoy';
  if (target === tomorrow) return 'mañana';
  return 'otro';
}

function confidenceTier(confidence) {
  if (confidence >= 85) return 'alta';
  if (confidence >= 70) return 'media';
  return 'baja';
}

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

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'sesión inválida' });

  const isAdmin = user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (!isAdmin) {
    const { data: profile } = await supabase.from('profiles').select('premium_until').eq('id', user.id).maybeSingle();
    const isPremium = Boolean(profile?.premium_until && new Date(profile.premium_until) > new Date());
    if (!isPremium) return res.status(403).json({ error: 'función exclusiva para cuentas premium' });
  }

  // players sin límite traía la tabla ENTERA en cada carga — mismo
  // arreglo que getServerSideProps/refresh-data.js.
  const [{ data: players }, { data: pendingPicks }] = await Promise.all([
    supabase.from('players').select('id, name, avatar_url, avatar_cutout_url, rating').order('updated_at', { ascending: false }).limit(1500),
    supabase
      .from('picks')
      .select('*')
      .eq('result', 'pending')
      .eq('published', true)
      .eq('is_exclusive', true)
      .order('confidence', { ascending: false })
  ]);

  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const pendingMatchIds = (pendingPicks || []).map((p) => p.match_id);
  const { data: pendingMatches } = pendingMatchIds.length
    ? await supabase.from('matches').select('*').in('id', pendingMatchIds)
    : { data: [] };
  const matchesById = new Map((pendingMatches || []).map((m) => [m.id, m]));

  const tournamentIds = [...new Set((pendingMatches || []).map((m) => m.tournament_id).filter(Boolean))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  // Los destacados (tipster_pick) resueltos no pueden depender del
  // límite de "últimos 30 resueltos" de abajo — con muchos partidos
  // resolviéndose de golpe, un destacado viejo quedaba empujado fuera
  // de esa ventana y desaparecía de "Picks recientes de CAMILOREY"
  // aunque siguiera marcado de verdad en la base. Se trae aparte, sin
  // límite de recencia, y se mezcla.
  const [{ data: resolvedPicksRecent }, { data: tipsterDestacadosResolved }] = await Promise.all([
    supabase
      .from('picks')
      .select('*')
      .neq('result', 'pending')
      .eq('published', true)
      .eq('is_exclusive', true)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('picks').select('*').eq('tipster_pick', true).eq('is_exclusive', true).neq('result', 'pending')
  ]);
  const resolvedPicksRaw = [
    ...new Map([...(resolvedPicksRecent || []), ...(tipsterDestacadosResolved || [])].map((p) => [p.id, p])).values()
  ];

  const resolvedMatchIds = [...new Set((resolvedPicksRaw || []).map((p) => p.match_id))];
  const { data: resolvedMatchesRaw } = resolvedMatchIds.length
    ? await supabase.from('matches').select('*').in('id', resolvedMatchIds)
    : { data: [] };
  const resolvedMatchesById = new Map((resolvedMatchesRaw || []).map((m) => [m.id, m]));

  const resolvedExtraPlayerIds = [
    ...new Set((resolvedMatchesRaw || []).flatMap((m) => [m.player_a_id, m.player_b_id]))
  ].filter((id) => id && !playersById.has(id));
  if (resolvedExtraPlayerIds.length) {
    const { data: extra } = await supabase
      .from('players')
      .select('id, name, avatar_url, avatar_cutout_url')
      .in('id', resolvedExtraPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const resolvedExtraTournamentIds = [...new Set((resolvedMatchesRaw || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (resolvedExtraTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', resolvedExtraTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  const HIDE_BEFORE_START_MS = 3 * 60 * 1000;

  const pendingPrelim = (pendingPicks || [])
    .map((pick) => {
      const match = matchesById.get(pick.match_id);
      if (!match) return null;
      // "El pick de CAMILOREY" (pick.tipster_pick) nunca se oculta por
      // estas dos reglas — si no, en cuanto el partido arrancara (o
      // estuviera por arrancar) el aviso/destacado desaparecía de
      // Inicio hasta que el próximo sync lo resolviera del todo, a
      // veces varios minutos después (bug real reportado: "se marca,
      // llega la notificación, pero al minuto se quita").
      const isTipsterPick = Boolean(pick.tipster_pick);
      if (!isTipsterPick && match.scheduled_at && new Date(match.scheduled_at).getTime() - Date.now() < HIDE_BEFORE_START_MS)
        return null;
      // El partido ya terminó pero el pick sigue "pending" — hueco
      // entre que el partido cierra y que el próximo sync corre
      // resolvePick(). No se muestra como pendiente mientras tanto; en
      // el próximo sync pasa a resueltos directamente.
      if (!isTipsterPick && match.status === 'finished') return null;
      const playerA = playersById.get(match.player_a_id);
      const playerB = playersById.get(match.player_b_id);
      const favored = playersById.get(pick.predicted_winner_id);
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const opponent = favoredIsA ? playerB : playerA;
      if (!favored || !opponent) return null;

      let matchStatus = 'soon';
      if (match.status === 'live') matchStatus = 'live';
      else if (match.scheduled_at && new Date(match.scheduled_at) <= new Date()) matchStatus = 'live';

      return { pick, match, favored, opponent, favoredIsA, tournament: tournamentsById.get(match.tournament_id), matchStatus };
    })
    .filter(Boolean);

  const resolvedPrelim = (resolvedPicksRaw || [])
    .map((pick) => {
      const match = resolvedMatchesById.get(pick.match_id);
      if (!match) return null;
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent =
        pick.predicted_winner_id === match.player_a_id
          ? playersById.get(match.player_b_id)
          : playersById.get(match.player_a_id);
      if (!favored || !opponent) return null;

      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const score =
        match.sets_a != null && match.sets_b != null
          ? favoredIsA
            ? `${match.sets_a}-${match.sets_b}`
            : `${match.sets_b}-${match.sets_a}`
          : null;
      const setScores = Array.isArray(match.set_scores)
        ? favoredIsA
          ? match.set_scores
          : match.set_scores.map((s) => ({ a: s.b, b: s.a }))
        : null;

      return { pick, match, favored, opponent, favoredIsA, tournament: tournamentsById.get(match.tournament_id), score, setScores };
    })
    .filter(Boolean);

  async function buildFormAndH2H(pairs) {
    const result = new Map();
    const allIds = [...new Set(pairs.flatMap((p) => [p.favoredId, p.opponentId]).filter(Boolean))];
    if (allIds.length === 0) return result;

    // Antes era UNA consulta POR JUGADOR en paralelo (y después, en
    // lotes de 20 con OR, que tampoco alcanzó) — causa real de un 504
    // en producción (ver refresh-data.js/pages/index.js). Ahora es UNA
    // SOLA consulta con .in(), que Postgres resuelve con el índice en
    // vez de evaluar un OR larguísimo.
    const rawHistoryByPlayer = new Map(allIds.map((id) => [id, []]));
    if (allIds.length) {
      const idList = allIds.join(',');
      const { data } = await supabase
        .from('matches')
        .select('id, scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
        .eq('status', 'finished')
        .or(`player_a_id.in.(${idList}),player_b_id.in.(${idList})`)
        .order('scheduled_at', { ascending: false })
        .limit(5000);
      for (const m of data || []) {
        if (rawHistoryByPlayer.has(m.player_a_id)) rawHistoryByPlayer.get(m.player_a_id).push(m);
        if (rawHistoryByPlayer.has(m.player_b_id)) rawHistoryByPlayer.get(m.player_b_id).push(m);
      }
    }
    for (const [id, rows] of rawHistoryByPlayer) {
      const deduped = [...new Map(rows.map((m) => [m.id, m])).values()];
      deduped.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
      rawHistoryByPlayer.set(id, deduped.slice(0, 20));
    }

    const missingOpponentIds = [
      ...new Set([...rawHistoryByPlayer.values()].flat().flatMap((m) => [m.player_a_id, m.player_b_id]))
    ].filter((id) => id && !playersById.has(id));
    if (missingOpponentIds.length) {
      const { data: extra } = await supabase
        .from('players')
        .select('id, name, avatar_url, avatar_cutout_url')
        .in('id', missingOpponentIds);
      for (const p of extra || []) playersById.set(p.id, p);
    }

    const historyFor = (playerId) =>
      (rawHistoryByPlayer.get(playerId) || []).map((m) => {
        const isA = m.player_a_id === playerId;
        const oppId = isA ? m.player_b_id : m.player_a_id;
        return {
          date: m.scheduled_at,
          opponent: playersById.get(oppId)?.name || '?',
          setsFor: isA ? m.sets_a : m.sets_b,
          setsAgainst: isA ? m.sets_b : m.sets_a,
          win: m.winner_id === playerId,
          viewedWasHome: isA
        };
      });

    const pairKey = (id1, id2) => (id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`);
    const uniquePairKeys = [
      ...new Set(pairs.filter((p) => p.favoredId && p.opponentId).map((p) => pairKey(p.favoredId, p.opponentId)))
    ];
    const h2hRowsByPair = new Map();
    if (uniquePairKeys.length > 0) {
      const CHUNK = 15;
      const chunks = [];
      for (let i = 0; i < uniquePairKeys.length; i += CHUNK) chunks.push(uniquePairKeys.slice(i, i + CHUNK));
      const chunkResults = await Promise.all(
        chunks.map(async (keys) => {
          const orClauses = keys
            .map((k) => {
              const [a, b] = k.split(':');
              return `and(player_a_id.eq.${a},player_b_id.eq.${b}),and(player_a_id.eq.${b},player_b_id.eq.${a})`;
            })
            .join(',');
          const { data: h2hData } = await supabase
            .from('matches')
            .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
            .eq('status', 'finished')
            .or(orClauses)
            .order('scheduled_at', { ascending: false })
            .limit(5000);
          return h2hData || [];
        })
      );
      for (const m of chunkResults.flat()) {
        const key = pairKey(m.player_a_id, m.player_b_id);
        if (!h2hRowsByPair.has(key)) h2hRowsByPair.set(key, []);
        h2hRowsByPair.get(key).push(m);
      }
    }

    for (const { pickId, favoredId, opponentId, opponentName } of pairs) {
      const history = historyFor(favoredId);
      const opponentHistory = historyFor(opponentId);
      const h2hMatches = (h2hRowsByPair.get(pairKey(favoredId, opponentId)) || [])
        .slice(0, 20)
        .map((m) => {
          const isA = m.player_a_id === favoredId;
          return {
            date: m.scheduled_at,
            opponent: opponentName,
            setsFor: isA ? m.sets_a : m.sets_b,
            setsAgainst: isA ? m.sets_b : m.sets_a,
            win: m.winner_id === favoredId,
            favoredWasHome: isA
          };
        });
      const winsFavored = h2hMatches.filter((m) => m.win).length;
      result.set(pickId, {
        history,
        streakLabel: streakLabelFromHistory(history),
        opponentHistory,
        opponentStreakLabel: streakLabelFromHistory(opponentHistory),
        h2h: `${winsFavored}-${h2hMatches.length - winsFavored}`,
        h2hTotal: h2hMatches.length,
        h2hMatches
      });
    }
    return result;
  }

  const formByPickId = await buildFormAndH2H([
    ...pendingPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    })),
    ...resolvedPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    }))
  ]);
  const EMPTY_FORM = {
    history: [],
    streakLabel: null,
    opponentHistory: [],
    opponentStreakLabel: null,
    h2h: '0-0',
    h2hTotal: 0,
    h2hMatches: []
  };

  const picks = pendingPrelim.map(({ pick, match, favored, opponent, favoredIsA, tournament, matchStatus }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
    return {
      id: pick.id,
      matchId: match.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
      player: favored?.name || '—',
      initials: initialsOf(favored?.name),
      avatarUrl: favored?.avatar_cutout_url || favored?.avatar_url || null,
      hasCutout: Boolean(favored?.avatar_cutout_url),
      opponent: opponent?.name || '—',
      opponentInitials: initialsOf(opponent?.name),
      opponentAvatarUrl: opponent?.avatar_cutout_url || opponent?.avatar_url || null,
      opponentHasCutout: Boolean(opponent?.avatar_cutout_url),
      favoredIsA,
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      exclusive: true,
      analysis: buildAnalysis(pick.factors),
      history: form.history,
      streakLabel: form.streakLabel,
      opponentHistory: form.opponentHistory,
      opponentStreakLabel: form.opponentStreakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score: null,
      setScores: null,
      result: 'pending',
      matchStatus,
      sourceId: match.source_id,
      tournamentId: match.tournament_id,
      tipsterPick: Boolean(pick.tipster_pick),
      tipsterPickAt: pick.tipster_pick_at || null
    };
  });
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);

  const resolvedPicks = resolvedPrelim.map(({ pick, match, favored, opponent, favoredIsA, tournament, score, setScores }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
    return {
      id: pick.id,
      matchId: match.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
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
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      exclusive: true,
      analysis: buildAnalysis(pick.factors),
      history: form.history,
      streakLabel: form.streakLabel,
      opponentHistory: form.opponentHistory,
      opponentStreakLabel: form.opponentStreakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score,
      setScores,
      result: pick.result,
      matchStatus: 'done',
      tipsterPick: Boolean(pick.tipster_pick),
      tipsterPickAt: pick.tipster_pick_at || null
    };
  });
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

  return res.status(200).json({ picks, resolvedPicks });
}
