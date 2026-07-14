// ============================================================
// CAMILOREY — refresco de Inicio y Picks sin recargar la página
// Mismo cálculo de picks/resolvedPicks/tournamentGroups/stats que
// getServerSideProps, como endpoint aparte para poder consultarlo
// cada tantos segundos desde el cliente (Sofascore-style) mientras
// esas vistas estén abiertas.
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

// Pick "exclusivo" (solo premium/admin, ver 2026-07-14) = confianza
// alta + cuota real de valor — mismo criterio que en getServerSideProps
// (pages/index.js), duplicado acá porque este endpoint arma su propio
// picks/resolvedPicks para el refresco en vivo sin recargar la página.
const EXCLUSIVE_MIN_CONFIDENCE = 85;
const EXCLUSIVE_MIN_ODDS = 1.6;
function isExclusivePick(confidence, odds) {
  return confidence >= EXCLUSIVE_MIN_CONFIDENCE && Boolean(odds) && Number(odds) >= EXCLUSIVE_MIN_ODDS;
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
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ data: players }, { data: pendingPicks }] = await Promise.all([
    supabase.from('players').select('id, name, avatar_url, avatar_cutout_url, rating'),
    supabase.from('picks').select('*').eq('result', 'pending').order('confidence', { ascending: false })
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

  const { data: resolvedPicksRaw } = await supabase
    .from('picks')
    .select('*')
    .neq('result', 'pending')
    .order('created_at', { ascending: false })
    .limit(60);

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
      if (match.scheduled_at && new Date(match.scheduled_at).getTime() - Date.now() < HIDE_BEFORE_START_MS) return null;
      const playerA = playersById.get(match.player_a_id);
      const playerB = playersById.get(match.player_b_id);
      const favored = playersById.get(pick.predicted_winner_id);
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const opponent = favoredIsA ? playerB : playerA;
      if (!favored || !opponent) return null;

      let matchStatus = 'soon';
      if (match.status === 'finished') matchStatus = 'done';
      else if (match.status === 'live') matchStatus = 'live';
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

  // Antes, cada pick disparaba 2 consultas propias a Supabase (forma
  // reciente + H2H) — con decenas de picks pendientes y resueltos a la
  // vez (y este endpoint se consulta cada 20s mientras Inicio/Picks
  // está abierto), eso eran cientos de round-trips repetidos y era la
  // causa real de que el sitio se sintiera cada vez más lento. Ahora
  // se trae en una sola consulta TODOS los partidos terminados de
  // TODOS los jugadores involucrados (pendientes + resueltos juntos),
  // y la forma reciente + el cruce directo de cada pick se calculan
  // en memoria a partir de ese único resultado.
  async function buildFormAndH2H(pairs) {
    const result = new Map();
    const allIds = [...new Set(pairs.flatMap((p) => [p.favoredId, p.opponentId]).filter(Boolean))];
    if (allIds.length === 0) return result;

    // Forma reciente de cada jugador: consulta directa y acotada por
    // jugador (antes salía de UN lote compartido entre TODOS los
    // jugadores de TODOS los picks a la vez, con un límite fijo — un
    // jugador poco activo terminaba con 1 solo partido en su
    // historial en vez de sus reales, porque el límite se llenaba con
    // la actividad de jugadores más activos antes de llegar a él). Se
    // piden todas en paralelo, cada una acotada a 20 filas (el tope
    // real que puede pedir premium con el selector L20; el recorte a
    // 5 para cuentas gratis pasa en PickDetailModal, no acá).
    const rawHistoryByPlayer = new Map();
    await Promise.all(
      allIds.map(async (id) => {
        const { data } = await supabase
          .from('matches')
          .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
          .eq('status', 'finished')
          .or(`player_a_id.eq.${id},player_b_id.eq.${id}`)
          .order('scheduled_at', { ascending: false })
          .limit(20);
        rawHistoryByPlayer.set(id, data || []);
      })
    );

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
          win: m.winner_id === playerId
        };
      });

    // H2H: mismo problema que la forma reciente de arriba tenía antes
    // (un lote compartido con límite fijo se quedaba corto para
    // parejas poco activas — confirmado: un cruce con 20 partidos
    // reales salía como "0 enfrentamientos"). Esta consulta va directo
    // por cada pareja exacta (favorito↔rival), en lotes de 15 para no
    // armar una sola consulta gigante.
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
      exclusive: isExclusivePick(confidence, pick.odds),
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
      tournamentId: match.tournament_id
    };
  });
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  // El pick destacado prioriza cuota real arriba de 1.60 — entre esos,
  // el de mayor confianza. Si ninguno tiene cuota >1.60 (o cuota del
  // todo), cae al de mayor confianza general para no dejar Inicio sin
  // destacado solo porque el cruce con Rushbet no encontró esa cuota.
  // Los picks exclusivos quedan afuera de este cálculo a propósito: el
  // destacado se ve sin login premium, nunca puede ser uno de los que
  // se supone son solo para quien paga.
  const publicPicks = picks.filter((p) => !p.exclusive);
  const picksWithGoodOdds = publicPicks.filter((p) => p.odds && p.odds > 1.6);
  const topConfidence =
    (picksWithGoodOdds.length ? picksWithGoodOdds : publicPicks).slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

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
      exclusive: isExclusivePick(confidence, pick.odds),
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
      matchStatus: 'done'
    };
  });
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

  const tournamentGroups = (
    await Promise.all(
      tournamentIds.map(async (tId) => {
        const { data: groupMatches } = await supabase
          .from('matches')
          .select('player_a_id, player_b_id, sets_a, sets_b, set_scores, status, scheduled_at')
          .eq('tournament_id', tId);
        if (!groupMatches || groupMatches.length === 0) return null;

        const now = Date.now();
        const isLive = groupMatches.some(
          (m) => m.status === 'live' || (m.status !== 'finished' && m.scheduled_at && new Date(m.scheduled_at).getTime() <= now)
        );
        if (!isLive) return null;

        const groupPlayerIds = [...new Set(groupMatches.flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
        if (groupPlayerIds.length < 3) return null;

        const missingIds = groupPlayerIds.filter((id) => !playersById.has(id));
        if (missingIds.length) {
          const { data: extra } = await supabase
            .from('players')
            .select('id, name, avatar_url, avatar_cutout_url, rating')
            .in('id', missingIds);
          for (const p of extra || []) playersById.set(p.id, p);
        }

        const matchupByPlayer = new Map(groupPlayerIds.map((id) => [id, new Map()]));
        const ballsByPlayer = new Map(groupPlayerIds.map((id) => [id, { for: 0, against: 0, hasData: false }]));
        for (const m of groupMatches) {
          if (m.sets_a == null || m.sets_b == null) continue;
          matchupByPlayer.get(m.player_a_id)?.set(m.player_b_id, { for: m.sets_a, against: m.sets_b });
          matchupByPlayer.get(m.player_b_id)?.set(m.player_a_id, { for: m.sets_b, against: m.sets_a });

          if (Array.isArray(m.set_scores) && m.set_scores.length > 0) {
            const ballsA = m.set_scores.reduce((s, set) => s + (set.a || 0), 0);
            const ballsB = m.set_scores.reduce((s, set) => s + (set.b || 0), 0);
            const ba = ballsByPlayer.get(m.player_a_id);
            const bb = ballsByPlayer.get(m.player_b_id);
            if (ba) {
              ba.for += ballsA;
              ba.against += ballsB;
              ba.hasData = true;
            }
            if (bb) {
              bb.for += ballsB;
              bb.against += ballsA;
              bb.hasData = true;
            }
          }
        }

        const rows = groupPlayerIds.map((id) => {
          const p = playersById.get(id);
          let wins = 0;
          let losses = 0;
          let setsFor = 0;
          let setsAgainst = 0;
          for (const res of matchupByPlayer.get(id).values()) {
            setsFor += res.for;
            setsAgainst += res.against;
            if (res.for > res.against) wins++;
            else losses++;
          }
          const balls = ballsByPlayer.get(id);
          return {
            id,
            name: p?.name || '—',
            initials: initialsOf(p?.name),
            avatarUrl: p?.avatar_cutout_url || p?.avatar_url || null,
            rating: p?.rating != null ? Math.round(Number(p.rating)) : null,
            wins,
            setsFor,
            setsAgainst,
            points: wins * 2 + losses,
            ballsFor: balls.hasData ? balls.for : null,
            ballsAgainst: balls.hasData ? balls.against : null
          };
        });
        rows.sort((a, b) => b.wins - a.wins || b.setsFor - b.setsAgainst - (a.setsFor - a.setsAgainst));
        rows.forEach((r, i) => (r.place = i + 1));

        const matchup = {};
        for (const id of groupPlayerIds) {
          matchup[id] = {};
          for (const [oppId, res] of matchupByPlayer.get(id)) {
            matchup[id][oppId] = `${res.for}:${res.against}`;
          }
        }

        const tournament = tournamentsById.get(tId);
        return { tournamentId: tId, name: tournament?.name || 'Torneo', players: rows, matchup };
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const { data: bankrollRows } = await supabase
    .from('bankroll_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
  const { data: bkPicks } = bkPickIds.length
    ? await supabase.from('picks').select('id, odds, market').in('id', bkPickIds)
    : { data: [] };
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const hits = (bankrollRows || []).filter((r) => Number(r.units) > 0).length;
  const misses = (bankrollRows || []).filter((r) => Number(r.units) < 0).length;
  const efectividad = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;

  let racha = 0;
  for (const r of bankrollRows || []) {
    const won = Number(r.units) > 0;
    if (racha === 0) racha = won ? 1 : -1;
    else if (racha > 0 === won) racha += won ? 1 : -1;
    else break;
  }

  function stakeOf(r) {
    const units = Number(r.units);
    if (units < 0) return -units;
    const pick = bkPicksById.get(r.pick_id);
    const odds = pick?.odds ? Number(pick.odds) : null;
    return odds && odds > 1 ? units / (odds - 1) : units;
  }
  const totalStake = (bankrollRows || []).reduce((sum, r) => sum + stakeOf(r), 0);
  const totalProfit = (bankrollRows || []).reduce((sum, r) => sum + Number(r.units), 0);
  const roi = totalStake > 0 ? Math.round((totalProfit / totalStake) * 1000) / 10 : 0;
  const unidades = bankrollRows && bankrollRows.length ? Number(bankrollRows[0].balance) : 0;

  const picksWithOdds = picks.filter((p) => p.odds);
  const cuotaProm = picksWithOdds.length
    ? Math.round((picksWithOdds.reduce((sum, p) => sum + p.odds, 0) / picksWithOdds.length) * 100) / 100
    : null;

  // El log detallado (bankrollLog/bankrollSeries, apuesta por apuesta)
  // ya NO se manda desde este endpoint público — antes cualquiera
  // podía pedirlo sin login y ver el bankroll completo del admin. Ese
  // detalle ahora sale solo de /api/bankroll-log, con el login
  // verificado de verdad en el servidor (igual que /api/error-log y
  // /api/model-stats). Las estadísticas agregadas de abajo sí siguen
  // siendo públicas a propósito.
  return res.status(200).json({
    stats: { efectividad, racha, cuotaProm, roi, unidades },
    picks,
    resolvedPicks,
    tournamentGroups
  });
}
