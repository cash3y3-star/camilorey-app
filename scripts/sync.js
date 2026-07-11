// ============================================================
// CAMILOREY — sincronización real
// Corre en GitHub Actions cada 30 min.
//
// tt.league-pro.com es una app Nuxt con SSR: cada página trae
// embebido un <script id="__NUXT_DATA__"> con toda la data ya
// estructurada (torneos, jugadores, partidos, resultados) en JSON.
// En vez de abrir un navegador y adivinar selectores CSS (que se
// rompen con cualquier rediseño), hacemos un fetch normal y leemos
// ese JSON directamente. Es la misma data que usa el sitio para
// pintar la página, así que es la fuente más confiable posible.
//
// Por cada torneo, procesamos TODOS sus partidos (no solo "el
// próximo"): los que ya tienen resultado real se cierran (matches
// finished + se resuelve el pick a hit/miss + bankroll_log); los que
// todavía no se juegan generan un pick nuevo si no tenían uno.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { computeConfidence } = require('../lib/confidence');
const { computeStake } = require('../lib/staking');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE = 'https://tt.league-pro.com';

// Nuxt serializa el payload como un array plano: cada objeto/array
// referencia a otros valores por su índice en ese mismo array (para
// no repetir valores iguales). Esto lo "desenrolla" a un árbol normal.
const REVIVE_TAGS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

function unflattenNuxtPayload(raw) {
  const cache = new Map();

  function resolve(i) {
    if (cache.has(i)) return cache.get(i);
    const v = raw[i];

    if (v === null || typeof v !== 'object') return v;

    if (Array.isArray(v) && typeof v[0] === 'string' && REVIVE_TAGS.has(v[0])) {
      const result = v.length > 1 ? resolve(v[1]) : undefined;
      cache.set(i, result);
      return result;
    }

    if (Array.isArray(v)) {
      const arr = [];
      cache.set(i, arr);
      for (const idx of v) arr.push(resolve(idx));
      return arr;
    }

    const obj = {};
    cache.set(i, obj);
    for (const key of Object.keys(v)) obj[key] = resolve(v[key]);
    return obj;
  }

  return resolve(0);
}

async function fetchNuxtData(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CAMILOREY sync bot)' }
  });
  if (!res.ok) throw new Error(`Fetch failed ${path}: ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`No se encontró __NUXT_DATA__ en ${path}`);
  const payload = unflattenNuxtPayload(JSON.parse(match[1]));
  return payload.data;
}

function playerName(p) {
  return p.short_name_en || `${p.first_name_en} ${p.surname_en}`.trim();
}

async function upsertPlayer(player, rating) {
  if (!player?.id) return;
  const { error } = await supabase.from('players').upsert({
    id: player.id,
    name: playerName(player),
    rating: rating ?? null,
    updated_at: new Date()
  });
  if (error) throw new Error(`upsert players(${player.id}): ${error.message}`);
}

// Un torneo está terminado cuando todos sus lados (jugadores reales,
// sin contar cupos "por definir") ya tienen posición final asignada.
function isTournamentFinished(tournament) {
  const realSides = tournament.sides.filter((s) => !s.is_tba);
  return realSides.length > 0 && realSides.every((s) => s.place != null);
}

function tournamentWinnerSide(tournament) {
  return tournament.sides.find((s) => s.place === 1) || null;
}

async function getRecentStreak(playerId) {
  const { data, error } = await supabase
    .from('matches')
    .select('winner_id, player_a_id, player_b_id')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    .eq('status', 'finished')
    .order('scheduled_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`select matches (streak, player ${playerId}): ${error.message}`);

  if (!data || data.length === 0) return 0;
  let streak = 0;
  for (const m of data) {
    const won = m.winner_id === playerId;
    if (streak === 0) streak = won ? 1 : -1;
    else if ((streak > 0) === won) streak += won ? 1 : -1;
    else break;
  }
  return streak;
}

async function getH2H(playerAId, playerBId) {
  const { data, error } = await supabase
    .from('matches')
    .select('winner_id')
    .eq('status', 'finished')
    .or(
      `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`
    )
    .limit(10);
  if (error) throw new Error(`select matches (h2h, ${playerAId} vs ${playerBId}): ${error.message}`);

  if (!data) return { h2hWinsA: 0, h2hTotal: 0 };
  return {
    h2hWinsA: data.filter((m) => m.winner_id === playerAId).length,
    h2hTotal: data.length
  };
}

// Si el partido ya se jugó y tiene un pick pendiente, lo resuelve a
// hit/miss y registra la apuesta (sintética) en bankroll_log.
// Devuelve null si no había nada que resolver (para no contar dos
// veces si el pick ya se había cerrado en una corrida anterior).
async function resolvePick(matchRow) {
  const { data: pick, error } = await supabase
    .from('picks')
    .select('id, confidence, predicted_winner_id, result')
    .eq('match_id', matchRow.id)
    .maybeSingle();
  if (error) throw new Error(`select picks(match_id=${matchRow.id}): ${error.message}`);
  if (!pick || pick.result !== 'pending') return null;

  const hit = pick.predicted_winner_id === matchRow.winner_id;

  const { error: upErr } = await supabase
    .from('picks')
    .update({ result: hit ? 'hit' : 'miss' })
    .eq('id', pick.id);
  if (upErr) throw new Error(`update picks(${pick.id}): ${upErr.message}`);

  const { data: last, error: lastErr } = await supabase
    .from('bankroll_log')
    .select('balance')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(`select bankroll_log: ${lastErr.message}`);

  const stake = computeStake(pick.confidence);
  const units = hit ? stake : -stake;
  const balance = (last?.balance || 0) + units;

  const { error: logErr } = await supabase.from('bankroll_log').insert({
    pick_id: pick.id,
    units,
    balance
  });
  if (logErr) throw new Error(`insert bankroll_log(pick_id=${pick.id}): ${logErr.message}`);

  return hit ? 'hit' : 'miss';
}

async function generatePick(matchRow, sideA, sideB) {
  const [streakA, streakB, h2h] = await Promise.all([
    getRecentStreak(sideA.player.id),
    getRecentStreak(sideB.player.id),
    getH2H(sideA.player.id, sideB.player.id)
  ]);

  const { confidence: rawConfidence, factors } = computeConfidence({
    ratingDiff: (sideA.rating_before_tournament || 0) - (sideB.rating_before_tournament || 0),
    streakA,
    streakB,
    h2hWinsA: h2h.h2hWinsA,
    h2hTotal: h2h.h2hTotal
  });

  // computeConfidence devuelve qué tan favorecido está A (70 = parejo,
  // 92 = A muy favorito, 50 = B muy favorito). Para guardar "confianza
  // en el pick impreso" hay que reflejarlo cuando el favorito es B —
  // si no, un pick clarísimo por B queda guardado con la confianza
  // mínima, y arruina el staking de abajo.
  const favored = rawConfidence >= 70 ? sideA.player : sideB.player;
  const pickConfidence = rawConfidence >= 70 ? rawConfidence : 140 - rawConfidence;

  const { error } = await supabase.from('picks').insert({
    match_id: matchRow.id,
    market: `${playerName(favored)} gana`,
    confidence: pickConfidence,
    factors,
    predicted_winner_id: favored.id,
    result: 'pending'
  });
  if (error) throw new Error(`insert picks(match_id=${matchRow.id}): ${error.message}`);
}

async function syncTournamentMatches(t, widgets) {
  const sidesById = new Map(widgets.sides.map((s) => [s.id, s]));
  let matchesProcessed = 0;
  let picksGenerated = 0;
  let picksResolved = 0;

  for (const match of widgets.matches || []) {
    const sideA = sidesById.get(match.side_one_id);
    const sideB = sidesById.get(match.side_two_id);
    if (!sideA?.player || !sideB?.player) continue;

    const played = match.results?.score_one != null;
    const winnerId = played
      ? match.results.score_one > match.results.score_two
        ? sideA.player.id
        : sideB.player.id
      : null;

    const { data: matchRow, error: mErr } = await supabase
      .from('matches')
      .upsert(
        {
          source_id: match.id,
          tournament_id: t.id,
          player_a_id: sideA.player.id,
          player_b_id: sideB.player.id,
          scheduled_at: match.start_game,
          status: played ? 'finished' : 'scheduled',
          sets_a: played ? match.results.score_one : null,
          sets_b: played ? match.results.score_two : null,
          winner_id: winnerId,
          raw_data: match
        },
        { onConflict: 'source_id' }
      )
      .select()
      .single();
    if (mErr) throw new Error(`upsert matches(source_id=${match.id}): ${mErr.message}`);
    matchesProcessed++;

    if (played) {
      const result = await resolvePick(matchRow);
      if (result) picksResolved++;
      continue;
    }

    const { data: existingPick, error: pErr } = await supabase
      .from('picks')
      .select('id')
      .eq('match_id', matchRow.id)
      .maybeSingle();
    if (pErr) throw new Error(`select picks(match_id=${matchRow.id}): ${pErr.message}`);
    if (existingPick) continue;

    await generatePick(matchRow, sideA, sideB);
    picksGenerated++;
  }

  return { matchesProcessed, picksGenerated, picksResolved };
}

async function run() {
  console.log('Leyendo tt.league-pro.com...');
  const home = await fetchNuxtData('/en');
  // La portada solo trae los torneos más recientes/próximos. Si un
  // torneo con picks todavía pendientes se sale de esa ventana antes
  // de terminar, hay que seguir revisándolo explícitamente — si no,
  // esos picks se quedan huérfanos en 'pending' para siempre.
  const homeTournamentIds = (home['main-page-tournaments']?.items || []).map((t) => t.id);

  const { data: pendingPickRows, error: ppErr } = await supabase.from('picks').select('match_id').eq('result', 'pending');
  if (ppErr) throw new Error(`select picks (pending): ${ppErr.message}`);
  const pendingMatchIds = [...new Set((pendingPickRows || []).map((p) => p.match_id))];

  let pendingTournamentIds = [];
  if (pendingMatchIds.length) {
    const { data: pendingMatchRows, error: pmErr } = await supabase
      .from('matches')
      .select('tournament_id')
      .in('id', pendingMatchIds);
    if (pmErr) throw new Error(`select matches (pending tournaments): ${pmErr.message}`);
    pendingTournamentIds = [...new Set((pendingMatchRows || []).map((m) => m.tournament_id).filter(Boolean))];
  }

  const tournamentIds = [...new Set([...homeTournamentIds, ...pendingTournamentIds])];
  console.log(
    `Torneos a revisar: ${tournamentIds.length} (${homeTournamentIds.length} de portada, ${pendingTournamentIds.length} con picks pendientes)`
  );

  const totals = { matchesProcessed: 0, picksGenerated: 0, picksResolved: 0, tournamentsUpdated: 0 };

  for (const id of tournamentIds) {
    try {
      const detail = await fetchNuxtData(`/en/tournaments/${id}`);
      const pageData = detail['tournament-page']?.pageData;
      if (!pageData) continue;

      const t = {
        id: pageData.tournament.id,
        name_en: pageData.tournament.name_en,
        start_at: pageData.tournament.start_date,
        sides: pageData.widgets.sides
      };

      const finished = isTournamentFinished(t);
      const winnerSide = finished ? tournamentWinnerSide(t) : null;

      for (const side of t.sides) {
        if (side.player) {
          await upsertPlayer(side.player, side.rating_after_tournament ?? side.rating_before_tournament);
        }
      }

      const { error: tErr } = await supabase.from('tournaments').upsert({
        id: t.id,
        name: t.name_en,
        scheduled_at: t.start_at,
        status: finished ? 'finished' : 'scheduled',
        winner_id: winnerSide?.player?.id || null
      });
      if (tErr) throw new Error(`upsert tournaments(${t.id}): ${tErr.message}`);
      totals.tournamentsUpdated++;

      const result = await syncTournamentMatches(t, pageData.widgets);
      totals.matchesProcessed += result.matchesProcessed;
      totals.picksGenerated += result.picksGenerated;
      totals.picksResolved += result.picksResolved;
    } catch (e) {
      console.error(`Error procesando torneo ${id}: ${e.message}`);
    }
  }

  console.log('--- RESUMEN ---');
  console.log(totals);
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
