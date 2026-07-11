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
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { computeConfidence } = require('../lib/confidence');

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
  await supabase.from('players').upsert({
    id: player.id,
    name: playerName(player),
    rating: rating ?? null,
    updated_at: new Date()
  });
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

// De los partidos de un torneo en curso, el próximo a jugarse todavía
// sin resultado — ese es el que nos interesa para generar un pick.
function nextUnplayedMatch(matches) {
  const pending = (matches || []).filter((m) => m.results?.score_one == null);
  if (pending.length === 0) return null;
  return pending.sort((a, b) => new Date(a.start_game) - new Date(b.start_game))[0];
}

async function getRecentStreak(playerId) {
  const { data } = await supabase
    .from('matches')
    .select('winner_id, player_a_id, player_b_id')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    .eq('status', 'finished')
    .order('scheduled_at', { ascending: false })
    .limit(5);

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
  const { data } = await supabase
    .from('matches')
    .select('winner_id')
    .eq('status', 'finished')
    .or(
      `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`
    )
    .limit(10);

  if (!data) return { h2hWinsA: 0, h2hTotal: 0 };
  return {
    h2hWinsA: data.filter((m) => m.winner_id === playerAId).length,
    h2hTotal: data.length
  };
}

async function syncUpcoming(tournamentSummaries) {
  let matchesProcessed = 0;
  let picksGenerated = 0;

  for (const t of tournamentSummaries) {
    if (isTournamentFinished(t)) continue;

    for (const side of t.sides) {
      if (side.player) await upsertPlayer(side.player, side.rating_before_tournament);
    }

    await supabase.from('tournaments').upsert({
      id: t.id,
      name: t.name_en,
      scheduled_at: t.start_at,
      status: 'scheduled'
    });

    let detail;
    try {
      detail = await fetchNuxtData(`/en/tournaments/${t.id}`);
    } catch (e) {
      console.error(`No se pudo leer el detalle del torneo ${t.id}: ${e.message}`);
      continue;
    }

    const widgets = detail['tournament-page']?.pageData?.widgets;
    if (!widgets) continue;

    const sidesById = new Map(widgets.sides.map((s) => [s.id, s]));
    const match = nextUnplayedMatch(widgets.matches);
    if (!match) continue;

    const sideA = sidesById.get(match.side_one_id);
    const sideB = sidesById.get(match.side_two_id);
    if (!sideA?.player || !sideB?.player) continue;

    const { data: matchRow } = await supabase
      .from('matches')
      .upsert(
        {
          tournament_id: t.id,
          player_a_id: sideA.player.id,
          player_b_id: sideB.player.id,
          scheduled_at: match.start_game,
          status: 'scheduled'
        },
        { onConflict: 'tournament_id' }
      )
      .select()
      .single();

    matchesProcessed++;
    if (!matchRow?.id) continue;

    const [streakA, streakB, h2h] = await Promise.all([
      getRecentStreak(sideA.player.id),
      getRecentStreak(sideB.player.id),
      getH2H(sideA.player.id, sideB.player.id)
    ]);

    const { confidence, factors } = computeConfidence({
      ratingDiff: (sideA.rating_before_tournament || 0) - (sideB.rating_before_tournament || 0),
      streakA,
      streakB,
      h2hWinsA: h2h.h2hWinsA,
      h2hTotal: h2h.h2hTotal
    });

    const favored = confidence >= 70 ? sideA.player : sideB.player;

    await supabase.from('picks').upsert(
      {
        match_id: matchRow.id,
        market: `${playerName(favored)} gana`,
        confidence,
        factors,
        result: 'pending'
      },
      { onConflict: 'match_id' }
    );
    picksGenerated++;
  }

  return { matchesProcessed, picksGenerated };
}

async function syncFinished(tournamentSummaries) {
  let tournamentsUpdated = 0;

  for (const t of tournamentSummaries) {
    if (!isTournamentFinished(t)) continue;

    // El torneo pudo terminar sin haber pasado nunca por syncUpcoming
    // (p. ej. ya estaba terminado la primera vez que lo vemos), así
    // que hay que asegurar que los jugadores existan antes del FK.
    for (const side of t.sides) {
      if (side.player) await upsertPlayer(side.player, side.rating_after_tournament);
    }

    const winnerSide = tournamentWinnerSide(t);
    await supabase.from('tournaments').upsert({
      id: t.id,
      name: t.name_en,
      scheduled_at: t.start_at,
      status: 'finished',
      winner_id: winnerSide?.player?.id || null
    });
    tournamentsUpdated++;
  }

  return { tournamentsUpdated };
}

async function run() {
  console.log('Leyendo tt.league-pro.com...');
  const home = await fetchNuxtData('/en');
  // Nota: esta lista trae los torneos más recientes/próximos (la
  // misma ventana que se ve en la portada). Si más adelante hace
  // falta cubrir todo el calendario, se puede paginar /en/tournaments.
  const tournaments = home['main-page-tournaments']?.items || [];
  console.log(`Torneos encontrados: ${tournaments.length}`);

  const upcoming = await syncUpcoming(tournaments);
  const finished = await syncFinished(tournaments);

  console.log('--- RESUMEN ---');
  console.log({ ...upcoming, ...finished });
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
