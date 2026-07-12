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

function streakLabelFromHistory(history) {
  if (!history || history.length === 0) return null;
  const last = history[history.length - 1];
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] === last) count++;
    else break;
  }
  return `${count}${last === 1 ? 'W' : 'L'}`;
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

  async function recentForm(playerId) {
    if (!playerId) return [];
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
    if (!idA || !idB) return { winsA: 0, winsB: 0 };
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

  const HIDE_BEFORE_START_MS = 3 * 60 * 1000;

  const pickResults = await Promise.all(
    (pendingPicks || []).map(async (pick) => {
      const match = matchesById.get(pick.match_id);
      if (!match) return null;
      if (match.scheduled_at && new Date(match.scheduled_at).getTime() - Date.now() < HIDE_BEFORE_START_MS) return null;
      const playerA = playersById.get(match.player_a_id);
      const playerB = playersById.get(match.player_b_id);
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent = pick.predicted_winner_id === match.player_a_id ? playerB : playerA;
      if (!favored || !opponent) return null;
      const tournament = tournamentsById.get(match.tournament_id);
      const confidence = Math.round(pick.confidence);
      const [history, h2h] = await Promise.all([recentForm(pick.predicted_winner_id), h2hRecord(favored.id, opponent.id)]);

      let matchStatus = 'soon';
      if (match.status === 'finished') matchStatus = 'done';
      else if (match.status === 'live') matchStatus = 'live';
      else if (match.scheduled_at && new Date(match.scheduled_at) <= new Date()) matchStatus = 'live';

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
        time: timeLabel(match.scheduled_at),
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
        result: 'pending',
        matchStatus,
        sourceId: match.source_id,
        tournamentId: match.tournament_id
      };
    })
  );
  const picks = pickResults.filter(Boolean);
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  // El pick destacado prioriza cuota real arriba de 1.60 — entre esos,
  // el de mayor confianza. Si ninguno tiene cuota >1.60 (o cuota del
  // todo), cae al de mayor confianza general para no dejar Inicio sin
  // destacado solo porque el cruce con Rushbet no encontró esa cuota.
  const picksWithGoodOdds = picks.filter((p) => p.odds && p.odds > 1.6);
  const topConfidence =
    (picksWithGoodOdds.length ? picksWithGoodOdds : picks).slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

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

  const resolvedPicks = [];
  for (const pick of resolvedPicksRaw || []) {
    const match = resolvedMatchesById.get(pick.match_id);
    if (!match) continue;
    const favored = playersById.get(pick.predicted_winner_id);
    const opponent =
      pick.predicted_winner_id === match.player_a_id
        ? playersById.get(match.player_b_id)
        : playersById.get(match.player_a_id);
    if (!favored || !opponent) continue;
    const tournament = tournamentsById.get(match.tournament_id);
    const confidence = Math.round(pick.confidence);

    resolvedPicks.push({
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
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      analysis: buildAnalysis(pick.factors),
      history: [],
      streakLabel: null,
      h2h: null,
      h2hTotal: 0,
      result: pick.result
    });
  }
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

  const { data: bankrollRows } = await supabase
    .from('bankroll_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
  const { data: bkPicks } = bkPickIds.length
    ? await supabase.from('picks').select('id, odds').in('id', bkPickIds)
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

  return res.status(200).json({
    stats: { efectividad, racha, cuotaProm, roi, unidades },
    picks,
    resolvedPicks,
    tournamentGroups
  });
}
