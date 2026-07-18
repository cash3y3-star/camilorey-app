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
const { fetchLigaProChecaOdds, findOdds } = require('../lib/rushbet');
const { ensureAvatarCutout } = require('../lib/avatarCutout');
const { fetchNuxtData } = require('../lib/tt');
const {
  trainLogisticRegression,
  predictProbability,
  computeExclusiveThreshold,
  MIN_TRAINING_SAMPLES
} = require('../lib/ml-exclusive');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Las fotos de jugadores no viven en el dominio principal, sino en
// este subdominio de API (confirmado inspeccionando las URLs reales
// que renderiza el sitio, ej. src="/_ipx/f_webp/https://api.league-pro.com/...").
const MEDIA_BASE = 'https://api.league-pro.com';

function playerName(p) {
  return p.short_name_en || `${p.first_name_en} ${p.surname_en}`.trim();
}

async function upsertPlayer(player, rating) {
  if (!player?.id) return;
  const { error } = await supabase.from('players').upsert({
    id: player.id,
    name: playerName(player),
    rating: rating ?? null,
    avatar_url: player.avatar ? `${MEDIA_BASE}${player.avatar}` : null,
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

// Ordenado por fecha DESC porque, además del ratio agregado, nos
// importa el patrón de RACHAS dentro de este cruce directo — no toda
// pareja alterna partido a partido (gana uno, gana el otro); hay
// parejas donde el mismo jugador gana 2 seguidos y recién ahí corta
// el otro. Por eso agrupamos el historial en rachas consecutivas
// (ej. P1,P1,P2,P1,P1,P2 -> rachas [P1:2, P2:1, P1:2]) y medimos
// cuánto duran normalmente ANTES de cortarse (typicalRunLength), para
// comparar contra la racha que está activa ahora mismo.
async function getH2H(playerAId, playerBId) {
  const { data, error } = await supabase
    .from('matches')
    .select('winner_id, scheduled_at')
    .eq('status', 'finished')
    .or(
      `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`
    )
    .order('scheduled_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`select matches (h2h, ${playerAId} vs ${playerBId}): ${error.message}`);

  if (!data || data.length === 0) {
    return {
      h2hWinsA: 0,
      h2hTotal: 0,
      currentStreakPlayerId: null,
      currentStreakLength: 0,
      typicalRunLength: null,
      isPerfectAlternation: false
    };
  }

  const chronological = [...data].reverse(); // data viene DESC (más nuevo primero); acá lo damos vuelta
  const runs = [];
  for (const m of chronological) {
    const last = runs[runs.length - 1];
    if (last && last.winnerId === m.winner_id) last.length++;
    else runs.push({ winnerId: m.winner_id, length: 1 });
  }
  // La racha activa (la última) todavía puede seguir o cortarse — las
  // ya COMPLETADAS (todas menos la última) son las que nos dicen
  // cuánto suele durar una racha para esta pareja antes de cortarse.
  const completedRuns = runs.slice(0, -1);
  const currentRun = runs[runs.length - 1];
  const typicalRunLength = completedRuns.length
    ? completedRuns.reduce((sum, r) => sum + r.length, 0) / completedRuns.length
    : null;
  // Alternancia PERFECTA: nunca, en ningún cruce de la ventana
  // observada, el mismo jugador repitió victoria — ni siquiera una
  // vez. Exigimos al menos 3 rachas completadas (o sea, al menos 3
  // "cortes" confirmados) para no confundir esto con que solo
  // llevamos 1-2 cruces de casualidad. Es la versión más confiable
  // del patrón — la mayoría no la sigue de cerca partido a partido,
  // así que cuando se da, es una ventaja real.
  const isPerfectAlternation = completedRuns.length >= 3 && runs.every((r) => r.length === 1);

  return {
    h2hWinsA: data.filter((m) => m.winner_id === playerAId).length,
    h2hTotal: data.length,
    currentStreakPlayerId: currentRun.winnerId,
    currentStreakLength: currentRun.length,
    typicalRunLength,
    isPerfectAlternation
  };
}

// Si el partido ya se jugó y tiene un pick pendiente, lo resuelve a
// hit/miss y registra la apuesta (sintética) en bankroll_log.
// Devuelve null si no había nada que resolver (para no contar dos
// veces si el pick ya se había cerrado en una corrida anterior).
async function resolvePick(matchRow) {
  const { data: pick, error } = await supabase
    .from('picks')
    .select('id, confidence, predicted_winner_id, result, odds')
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

  // El tamaño de la apuesta sigue siendo nuestra convención (según
  // confianza); el pago sí usa la cuota real de Rushbet cuando la
  // tenemos — si no, cae al viejo esquema simétrico 1:1.
  const stake = computeStake(pick.confidence);
  const units = hit ? (pick.odds ? stake * (pick.odds - 1) : stake) : -stake;
  const balance = (last?.balance || 0) + units;

  const { error: logErr } = await supabase.from('bankroll_log').insert({
    pick_id: pick.id,
    units,
    balance
  });
  if (logErr) throw new Error(`insert bankroll_log(pick_id=${pick.id}): ${logErr.message}`);

  return hit ? 'hit' : 'miss';
}

// Reentrena desde cero el modelo de ML de Exclusivo (ver
// lib/ml-exclusive.js) con TODOS los picks ya resueltos hasta este
// momento — se llama una sola vez por corrida, no por partido.
async function trainExclusiveModel() {
  const { data: resolvedPicks, error } = await supabase
    .from('picks')
    .select('factors, predicted_winner_id, result, match_id')
    .in('result', ['hit', 'miss']);
  if (error) throw new Error(`select picks (entrenamiento ML): ${error.message}`);
  if (!resolvedPicks || resolvedPicks.length === 0) return { weights: null, trainingCount: 0, threshold: null };

  const matchIds = [...new Set(resolvedPicks.map((p) => p.match_id))];
  const { data: matches, error: mErr } = await supabase.from('matches').select('id, player_a_id').in('id', matchIds);
  if (mErr) throw new Error(`select matches (entrenamiento ML): ${mErr.message}`);
  const matchById = new Map((matches || []).map((m) => [m.id, m]));

  const rows = resolvedPicks
    .map((p) => {
      const match = matchById.get(p.match_id);
      if (!match || !p.factors) return null;
      const sign = p.predicted_winner_id === match.player_a_id ? 1 : -1;
      return {
        hit: p.result === 'hit',
        ratingScore: (p.factors.ratingScore ?? 0) * sign,
        streakScore: (p.factors.streakScore ?? 0) * sign,
        h2hScore: (p.factors.h2hScore ?? 0) * sign,
        altScore: (p.factors.altScore ?? 0) * sign
      };
    })
    .filter(Boolean);

  const weights = trainLogisticRegression(rows);
  const threshold = computeExclusiveThreshold(weights, rows);
  return { weights, trainingCount: rows.length, threshold };
}

async function generatePick(matchRow, sideA, sideB, rushbetEvents, mlModel, tournamentName) {
  const [streakA, streakB, h2h] = await Promise.all([
    getRecentStreak(sideA.player.id),
    getRecentStreak(sideB.player.id),
    getH2H(sideA.player.id, sideB.player.id)
  ]);

  const h2hCurrentStreakIsA =
    h2h.currentStreakPlayerId === sideA.player.id ? true : h2h.currentStreakPlayerId === sideB.player.id ? false : null;

  const { confidence: rawConfidence, factors } = computeConfidence({
    ratingDiff: (sideA.rating_before_tournament || 0) - (sideB.rating_before_tournament || 0),
    streakA,
    streakB,
    h2hWinsA: h2h.h2hWinsA,
    h2hTotal: h2h.h2hTotal,
    h2hCurrentStreakIsA,
    h2hCurrentStreakLength: h2h.currentStreakLength,
    h2hTypicalRunLength: h2h.typicalRunLength,
    h2hIsPerfectAlternation: h2h.isPerfectAlternation
  });

  // computeConfidence devuelve qué tan favorecido está A (70 = parejo,
  // 92 = A muy favorito, 50 = B muy favorito). Para guardar "confianza
  // en el pick impreso" hay que reflejarlo cuando el favorito es B —
  // si no, un pick clarísimo por B queda guardado con la confianza
  // mínima, y arruina el staking de abajo.
  const favored = rawConfidence >= 70 ? sideA.player : sideB.player;
  const rival = favored.id === sideA.player.id ? sideB.player : sideA.player;
  const pickConfidence = rawConfidence >= 70 ? rawConfidence : 140 - rawConfidence;

  // Piso de publicación — agregado 2026-07-14 después de una racha
  // floja (4/14). Antes CUALQUIER partido generaba un pick, hasta con
  // confianza pegada al mínimo de 50 (básicamente un empate técnico
  // del modelo). Ahora, si no llega a 60, el pick se guarda igual
  // (published=false) para no perder el seguimiento/calibración, pero
  // NO se muestra en ningún lado público — solo en "Descartados" del
  // panel admin. No es una garantía de que suba el acierto (la muestra
  // real sigue siendo chica), pero saca del medio, para el usuario
  // final, los picks con menos razón de ser "nuestro pick".
  const MIN_CONFIDENCE_TO_PUBLISH = 60;
  let published = pickConfidence >= MIN_CONFIDENCE_TO_PUBLISH;

  // Cuota real de Rushbet si logramos cruzar el partido por nombre+hora
  // en su feed de "Liga Pro checa" — queda null si no hay match (no
  // bloquea la generación del pick).
  const odds = findOdds(rushbetEvents, playerName(sideA.player), playerName(sideB.player), matchRow.scheduled_at);
  const favoredOdds = odds ? (favored.id === sideA.player.id ? odds.oddsA : odds.oddsB) : null;

  // Tope de picks VIP por día — pedido 2026-07-14: máximo 6 picks
  // "exclusivos" por día. El 7mo en adelante NO se publica (mismo
  // trato que uno de confianza baja), aunque individualmente sí
  // califique — es a propósito, para que "VIP" siga significando algo
  // selecto y no se diluya en un día con muchos partidos parejos.
  const EXCLUSIVE_MIN_CONFIDENCE = 85;
  const EXCLUSIVE_MIN_ODDS = 1.6;
  const MAX_EXCLUSIVE_PER_DAY = 6;

  // Qué entra a Exclusivo ya NO lo decide directamente la confianza de
  // arriba — lo decide el modelo de ML (lib/ml-exclusive.js),
  // reentrenado desde cero en esta misma corrida con los picks ya
  // resueltos, usando las mismas 4 señales (rating/racha/H2H/alternancia)
  // pero con pesos aprendidos en vez de fijados a mano. Mientras la
  // muestra de resueltos sea chica (< MIN_TRAINING_SAMPLES) no hay
  // confianza suficiente en esos pesos, así que se cae al criterio
  // viejo (confianza>=85) mientras tanto.
  const sign = favored.id === sideA.player.id ? 1 : -1;
  const mlFeatures = {
    ratingScore: factors.ratingScore * sign,
    streakScore: factors.streakScore * sign,
    h2hScore: factors.h2hScore * sign,
    altScore: factors.altScore * sign
  };
  const hasTrainedModel = mlModel?.weights && mlModel.trainingCount >= MIN_TRAINING_SAMPLES;
  const mlProbability = mlModel?.weights ? predictProbability(mlModel.weights, mlFeatures) : null;
  const mlConfidence = mlProbability != null ? Math.round(mlProbability * 100) : null;

  // Boolean(...) a propósito: picks.is_exclusive es NOT NULL, y una
  // cadena de && en JS no siempre da true/false — si favoredOdds es
  // null (sin cuota de Rushbet todavía, algo común en partidos sin
  // mucho movimiento de apuestas), toda la expresión quedaba en null
  // en vez de false, y el insert de abajo rompía con "null value in
  // column is_exclusive violates not-null constraint" para CUALQUIER
  // partido sin cuota — no era específico de ningún jugador.
  const isExclusiveCandidate = Boolean(
    published &&
      favoredOdds &&
      favoredOdds >= EXCLUSIVE_MIN_ODDS &&
      (hasTrainedModel ? mlProbability >= mlModel.threshold : pickConfidence >= EXCLUSIVE_MIN_CONFIDENCE)
  );
  if (isExclusiveCandidate) {
    const countToday = await countExclusivePublishedOnDay(matchRow.scheduled_at);
    if (countToday >= MAX_EXCLUSIVE_PER_DAY) published = false;
  }

  const { error } = await supabase.from('picks').insert({
    match_id: matchRow.id,
    market: `${playerName(favored)} gana`,
    confidence: pickConfidence,
    factors,
    predicted_winner_id: favored.id,
    odds: favoredOdds,
    result: 'pending',
    published,
    ml_confidence: mlConfidence,
    is_exclusive: isExclusiveCandidate
  });
  if (error) throw new Error(`insert picks(match_id=${matchRow.id}): ${error.message}`);
  return {
    published,
    highConfidence: published && pickConfidence >= EXCLUSIVE_MIN_CONFIDENCE,
    // Detalle real del pick solo cuando es Exclusivo — es lo único que
    // avisa /api/notify/new-picks.js (pedido 2026-07-16: "solo va
    // avisar de picks vips a los usuarios exclusivos").
    exclusivePick:
      published && isExclusiveCandidate
        ? {
            player: playerName(favored),
            opponent: playerName(rival),
            market: `${playerName(favored)} gana`,
            confidence: pickConfidence,
            odds: favoredOdds,
            tournament: tournamentName || null
          }
        : null
  };
}

// Cuenta cuántos picks "exclusivos" (mismo criterio de arriba) ya
// quedaron publicados para el mismo día calendario (huso de Bogotá)
// del partido que se está por generar — para el tope de 6/día.
async function countExclusivePublishedOnDay(scheduledAt) {
  const dayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(scheduledAt));
  const dayStart = new Date(`${dayStr}T00:00:00-05:00`).toISOString();
  const dayEnd = new Date(`${dayStr}T23:59:59-05:00`).toISOString();

  const { data: dayMatches, error: mErr } = await supabase
    .from('matches')
    .select('id')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd);
  if (mErr) throw new Error(`select matches (tope VIP diario): ${mErr.message}`);
  const matchIds = (dayMatches || []).map((m) => m.id);
  if (!matchIds.length) return 0;

  const { count, error } = await supabase
    .from('picks')
    .select('id', { count: 'exact', head: true })
    .eq('published', true)
    .eq('is_exclusive', true)
    .in('match_id', matchIds);
  if (error) throw new Error(`count picks exclusivos del día: ${error.message}`);
  return count || 0;
}

// El cruce con Rushbet en generatePick es "una sola oportunidad": si
// en ese momento el partido todavía no aparecía en su tablero (Rushbet
// suele publicar la cuota más cerca de la hora del partido que
// nuestra ventana de descubrimiento, que ahora mira varias horas
// adelante), el pick se queda con odds=null para siempre, aunque
// Rushbet sí lo liste minutos después. Esto reintenta el cruce en
// cada corrida para todo pick pendiente que aún no tenga cuota.
async function backfillMissingOdds(rushbetEvents) {
  if (!rushbetEvents.length) return 0;

  const { data: pendingPicks, error } = await supabase
    .from('picks')
    .select('id, match_id, predicted_winner_id')
    .eq('result', 'pending')
    .is('odds', null);
  if (error) throw new Error(`select picks (odds backfill): ${error.message}`);
  if (!pendingPicks || pendingPicks.length === 0) return 0;

  const matchIds = [...new Set(pendingPicks.map((p) => p.match_id))];
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id, scheduled_at')
    .in('id', matchIds);
  if (mErr) throw new Error(`select matches (odds backfill): ${mErr.message}`);
  const matchesById = new Map((matches || []).map((m) => [m.id, m]));

  const playerIds = [...new Set((matches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))];
  const { data: players, error: plErr } = await supabase.from('players').select('id, name').in('id', playerIds);
  if (plErr) throw new Error(`select players (odds backfill): ${plErr.message}`);
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  let updated = 0;
  for (const pick of pendingPicks) {
    const match = matchesById.get(pick.match_id);
    if (!match) continue;
    const playerA = playersById.get(match.player_a_id);
    const playerB = playersById.get(match.player_b_id);
    if (!playerA || !playerB) continue;

    const odds = findOdds(rushbetEvents, playerA.name, playerB.name, match.scheduled_at);
    if (!odds) continue;
    const favoredOdds = pick.predicted_winner_id === match.player_a_id ? odds.oddsA : odds.oddsB;
    if (!favoredOdds) continue;

    const { error: upErr } = await supabase.from('picks').update({ odds: favoredOdds }).eq('id', pick.id);
    if (upErr) throw new Error(`update picks odds(${pick.id}): ${upErr.message}`);
    updated++;
  }
  return updated;
}

// Recalcula cuál pick es el "destacado" — mismo criterio que Inicio en
// el frontend (pages/index.js): prioriza cuota real >1.60 y entre esos
// el de mayor confianza; si ninguno tiene cuota buena, cae al de mayor
// confianza general. Antes esto SOLO se calculaba en el navegador en
// cada carga de página y nunca se guardaba, así que no había forma de
// auditar después "cuál destacamos" ni si acertó. Acá lo persistimos
// en picks.featured (la columna ya existe en el esquema, solo no se
// escribía). Solo tocamos picks PENDIENTES: uno que ya se resolvió
// conserva el featured que tenía en ese momento, así queda como
// historial real en vez de recalcularse para siempre.
async function updateFeaturedPick() {
  // published=true a propósito: un pick descartado (confianza < piso)
  // nunca puede terminar destacado en Inicio, aunque tenga cuota
  // buena — no es "nuestro pick" real.
  const { data: pending, error } = await supabase
    .from('picks')
    .select('id, confidence, odds, featured, is_exclusive')
    .eq('result', 'pending')
    .eq('published', true);
  if (error) throw new Error(`select picks (featured): ${error.message}`);
  if (!pending || pending.length === 0) return;

  // Un pick "exclusivo" (is_exclusive, decidido por el modelo de ML al
  // generarse — ver generatePick/lib/ml-exclusive.js) NUNCA puede
  // quedar destacado en Inicio — Inicio lo ve cualquiera sin login, y
  // ese pick es beneficio pago de Picks VIP. Se sacan del todo del
  // pool antes de elegir destacado.
  const nonExclusive = pending.filter((p) => !p.is_exclusive);
  if (nonExclusive.length === 0) return;

  const withGoodOdds = nonExclusive.filter((p) => p.odds && p.odds > 1.6);
  const pool = withGoodOdds.length ? withGoodOdds : nonExclusive;
  const winner = pool.slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (!winner) return;

  const toUnfeature = pending.filter((p) => p.featured && p.id !== winner.id).map((p) => p.id);
  if (toUnfeature.length) {
    const { error: unErr } = await supabase.from('picks').update({ featured: false }).in('id', toUnfeature);
    if (unErr) throw new Error(`unset featured: ${unErr.message}`);
  }
  if (!winner.featured) {
    const { error: setErr } = await supabase.from('picks').update({ featured: true }).eq('id', winner.id);
    if (setErr) throw new Error(`set featured(${winner.id}): ${setErr.message}`);
  }
}

async function syncTournamentMatches(t, widgets, rushbetEvents, mlModel) {
  const sidesById = new Map(widgets.sides.map((s) => [s.id, s]));
  let matchesProcessed = 0;
  let picksGenerated = 0;
  let picksResolved = 0;
  let highConfidenceGenerated = 0;
  const newExclusivePicks = [];

  for (const match of widgets.matches || []) {
    // Las fases eliminatorias (3er puesto, final) existen como filas
    // antes de que se definan sus participantes reales, y usan el
    // mismo side_id en ambos lados como placeholder — no es un partido
    // real todavía.
    if (match.side_one_id === match.side_two_id) continue;

    const sideA = sidesById.get(match.side_one_id);
    const sideB = sidesById.get(match.side_two_id);
    if (!sideA?.player || !sideB?.player) continue;

    // Aislado por partido — antes un error generando el pick de UN
    // partido (ej. una consulta que fallara para un jugador puntual)
    // abortaba el resto del torneo entero para esa corrida, dejando
    // sin pick tanto a ese partido como a los que venían después en la
    // lista, corrida tras corrida. Ahora se loguea con el detalle
    // exacto (partido + jugadores) y se sigue con el próximo.
    try {
      // OJO: results.score_one ya viene con el marcador parcial mientras
      // el partido está en curso (status 2), no solo cuando termina — no
      // sirve para saber si ya cerró. status === 3 es la señal real
      // (1 = no empezado, 2 = en curso, 3 = terminado).
      const played = match.status === 3;
      const winnerId = played
        ? match.results.score_one > match.results.score_two
          ? sideA.player.id
          : sideB.player.id
        : null;

      // El detalle set por set (matches.set_scores) ya NO se llena
      // acá: Sofascore bloquea las IPs de GitHub Actions con 403. Lo
      // llena pages/api/backfill-set-scores.js, que corre en Vercel.
      const { data: matchRow, error: mErr } = await supabase
        .from('matches')
        .upsert(
          {
            source_id: match.id,
            tournament_id: t.id,
            player_a_id: sideA.player.id,
            player_b_id: sideB.player.id,
            scheduled_at: match.start_game,
            status: match.status === 3 ? 'finished' : match.status === 2 ? 'live' : 'scheduled',
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

      const created = await generatePick(matchRow, sideA, sideB, rushbetEvents, mlModel, t.name_en);
      if (created.published) {
        picksGenerated++;
        if (created.highConfidence) highConfidenceGenerated++;
        if (created.exclusivePick) newExclusivePicks.push(created.exclusivePick);
      }
    } catch (e) {
      console.error(
        `Error procesando partido ${match.id} (${playerName(sideA.player)} vs ${playerName(sideB.player)}, torneo ${t.id}): ${e.message}`
      );
    }
  }

  return { matchesProcessed, picksGenerated, picksResolved, highConfidenceGenerated, newExclusivePicks };
}

// La portada (main-page-tournaments) solo muestra lo "reciente" — no
// alcanza a ver un torneo hasta que ya casi va a empezar o ya empezó,
// lo cual es demasiado tarde para un pick pre-partido de verdad. El
// listado completo (/en/tournaments) sí publica el calendario con
// horas de anticipación (confirmado: a la 1pm Colombia ya se ven ahí
// los torneos de las 18:00 UTC con status 1, sin empezar). Paginamos
// ese listado y nos quedamos con los que caen en nuestra ventana de
// interés (recientes + próximas unas horas).
async function fetchUpcomingTournamentIds() {
  const now = Date.now();
  const TRAILING_MS = 3 * 3600 * 1000;
  const LOOKAHEAD_MS = 6 * 3600 * 1000;
  const dateFrom = new Date(now).toISOString().slice(0, 10);
  const dateTo = new Date(now + 24 * 3600 * 1000).toISOString().slice(0, 10);

  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const data = await fetchNuxtData(`/en/tournaments?date_from=${dateFrom}&date_to=${dateTo}&page=${page}`);
    const items = data['tournaments-page-data']?.tournaments?.items || [];
    if (items.length === 0) break;

    for (const t of items) {
      const startMs = new Date(t.start_at).getTime();
      if (startMs >= now - TRAILING_MS && startMs <= now + LOOKAHEAD_MS) ids.push(t.id);
    }

    const lastStart = new Date(items[items.length - 1].start_at).getTime();
    if (lastStart > now + LOOKAHEAD_MS) break;
  }
  return ids;
}

async function run() {
  console.log('Leyendo tt.league-pro.com...');
  const upcomingTournamentIds = await fetchUpcomingTournamentIds();

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

  const tournamentIds = [...new Set([...upcomingTournamentIds, ...pendingTournamentIds])];
  console.log(
    `Torneos a revisar: ${tournamentIds.length} (${upcomingTournamentIds.length} en ventana ±horas, ${pendingTournamentIds.length} con picks pendientes)`
  );

  // Cuotas reales de Rushbet — una sola llamada por corrida. Si el
  // feed falla (o Rushbet cambia algo), seguimos sin cuotas en vez de
  // tronar toda la corrida por esto.
  let rushbetEvents = [];
  try {
    rushbetEvents = await fetchLigaProChecaOdds();
    console.log(`Cuotas de Rushbet leídas: ${rushbetEvents.length} partidos de Liga Pro checa`);
  } catch (e) {
    console.error(`No se pudieron leer las cuotas de Rushbet: ${e.message}`);
  }

  // Reentrena el modelo de ML de Exclusivo desde cero, con lo que haya
  // resuelto hasta ESTE momento — así el modelo "entrena solo" en cada
  // corrida sin que nadie tenga que tocar pesos a mano.
  const mlModel = await trainExclusiveModel();
  console.log(
    mlModel.trainingCount >= MIN_TRAINING_SAMPLES
      ? `Modelo ML de Exclusivo: reentrenado con ${mlModel.trainingCount} picks resueltos, umbral ${Math.round(mlModel.threshold * 100)}%.`
      : `Modelo ML de Exclusivo: solo ${mlModel.trainingCount} picks resueltos (mínimo ${MIN_TRAINING_SAMPLES}) — usando el criterio viejo (confianza>=85) mientras tanto.`
  );

  const totals = {
    matchesProcessed: 0,
    picksGenerated: 0,
    picksResolved: 0,
    tournamentsUpdated: 0,
    highConfidenceGenerated: 0,
    newExclusivePicks: []
  };

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
          const avatarUrl = side.player.avatar ? `${MEDIA_BASE}${side.player.avatar}` : null;
          await ensureAvatarCutout(supabase, side.player.id, avatarUrl);
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

      const result = await syncTournamentMatches(t, pageData.widgets, rushbetEvents, mlModel);
      totals.matchesProcessed += result.matchesProcessed;
      totals.picksGenerated += result.picksGenerated;
      totals.picksResolved += result.picksResolved;
      totals.highConfidenceGenerated += result.highConfidenceGenerated;
      totals.newExclusivePicks.push(...result.newExclusivePicks);
    } catch (e) {
      console.error(`Error procesando torneo ${id}: ${e.message}`);
    }
  }

  try {
    const oddsBackfilled = await backfillMissingOdds(rushbetEvents);
    totals.oddsBackfilled = oddsBackfilled;
  } catch (e) {
    console.error(`Error completando cuotas pendientes: ${e.message}`);
  }

  try {
    await updateFeaturedPick();
  } catch (e) {
    console.error(`Error actualizando pick destacado: ${e.message}`);
  }

  // Avisa SOLO de picks Exclusivos, SOLO a usuarios Exclusivo/Premium
  // (pedido 2026-07-16) — vive en Vercel (no acá) porque ahí ya están
  // las llaves VAPID y web-push instalado para check-follows.js;
  // sync.js solo manda el detalle de los picks Exclusivos de esta
  // corrida, protegido con el mismo CRON_SECRET que usa el cron
  // externo de resultados en vivo.
  if (totals.newExclusivePicks.length > 0 && process.env.CRON_SECRET) {
    try {
      const r = await fetch('https://camilorey-app.vercel.app/api/notify/new-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({ picks: totals.newExclusivePicks })
      });
      if (!r.ok) console.error(`Aviso de picks nuevos falló: HTTP ${r.status} — ${await r.text()}`);
    } catch (e) {
      console.error(`Aviso de picks nuevos falló: ${e.message}`);
    }
  }

  // Revisa los partidos que alguien esté siguiendo (arrancó / set
  // cerrado / terminó, con acierto o fallo) y avisa por push a quien
  // los sigue — pages/api/notify/check-follows.js. El plan original
  // era que esto lo disparara un cronjob externo aparte (cron-job.org)
  // cada 30-60s, pero nunca se llegó a configurar, así que esa
  // notificación nunca salía. Se engancha acá, al final de cada
  // corrida de sync (que sí dispara un cronjob externo cada pocos
  // minutos, confirmado con GitHub Actions), en vez de necesitar
  // configurar otro cronjob más.
  if (process.env.CRON_SECRET) {
    try {
      const r = await fetch('https://camilorey-app.vercel.app/api/notify/check-follows', {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
      });
      if (!r.ok) console.error(`check-follows falló: HTTP ${r.status} — ${await r.text()}`);
    } catch (e) {
      console.error(`check-follows falló: ${e.message}`);
    }
  }

  console.log('--- RESUMEN ---');
  console.log(totals);
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
