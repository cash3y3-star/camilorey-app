// ============================================================
// CAMILOREY — backfill de historial reciente de jugadores
// Corre cada 30 min (.github/workflows/backfill-history.yml), además
// de poder dispararse a mano.
//
// scripts/sync.js solo descubre torneos en una ventana de unas
// horas alrededor de "ahora" — nunca vuelve atrás a completar el
// historial viejo de un jugador. Por eso "Estadísticas"/H2H pueden
// aparecer vacíos para un jugador o un cruce que en la realidad sí
// tiene historial, solo que nosotros nunca lo vimos.
//
// tt.league-pro.com expone en /en/players/{id} un historial
// paginado de los torneos de un jugador (?page=N, 8 por página, del
// más reciente al más viejo). Este script recorre esa lista para
// cada jugador con un pick pendiente, detecta los torneos que nos
// faltan, y completa jugadores/torneos/partidos terminados desde
// /en/tournaments/{id} (mismo parser que sync.js). NO genera picks
// nuevos ni toca bankroll_log — esto es solo historia para mostrar,
// no apuestas.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { fetchNuxtData } = require('../lib/tt');
const { ensureAvatarCutout } = require('../lib/avatarCutout');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

function isTournamentFinished(tournament) {
  const realSides = tournament.sides.filter((s) => !s.is_tba);
  return realSides.length > 0 && realSides.every((s) => s.place != null);
}

function tournamentWinnerSide(tournament) {
  return tournament.sides.find((s) => s.place === 1) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Solo guarda partidos ya terminados (status 3) — un torneo que
// aparece en el historial de carrera de un jugador no debería traer
// partidos futuros, pero por si acaso no queremos generarles picks.
async function upsertFinishedMatches(t, widgets) {
  const sidesById = new Map(widgets.sides.map((s) => [s.id, s]));
  let count = 0;

  for (const match of widgets.matches || []) {
    if (match.side_one_id === match.side_two_id) continue;
    if (match.status !== 3) continue;

    const sideA = sidesById.get(match.side_one_id);
    const sideB = sidesById.get(match.side_two_id);
    if (!sideA?.player || !sideB?.player) continue;

    const winnerId = match.results.score_one > match.results.score_two ? sideA.player.id : sideB.player.id;

    const { error } = await supabase.from('matches').upsert(
      {
        source_id: match.id,
        tournament_id: t.id,
        player_a_id: sideA.player.id,
        player_b_id: sideB.player.id,
        scheduled_at: match.start_game,
        status: 'finished',
        sets_a: match.results.score_one,
        sets_b: match.results.score_two,
        winner_id: winnerId,
        raw_data: match
      },
      { onConflict: 'source_id' }
    );
    if (error) throw new Error(`upsert matches(source_id=${match.id}): ${error.message}`);
    count++;
  }
  return count;
}

// El historial de un jugador viene ordenado del torneo más reciente
// al más viejo — para una corrida INCREMENTAL (cada 30 min) no hace
// falta re-caminar la carrera completa cada vez (para alguien con
// 1000+ torneos eso son cientos de páginas por corrida, solo para
// confirmar que ya los tenemos todos). Con las primeras `maxPages`
// páginas (más recientes) alcanza de sobra para lo que se muestra
// (forma reciente = últimos 10, H2H = últimos 20) — el resto de la
// carrera ya quedó cubierto por corridas anteriores.
async function fetchRecentTournamentIdsForPlayer(playerId, maxPages = 6) {
  const ids = [];
  let page = 1;
  while (page <= maxPages) {
    const detail = await fetchNuxtData(`/en/players/${playerId}?page=${page}`);
    const widget = detail['player-previous-tournaments'];
    const items = widget?.items || [];
    if (items.length === 0) break;
    for (const item of items) ids.push(item.id);

    const { total_items, limit, offset } = widget.pagination || {};
    if (offset == null || offset + limit >= total_items) break;
    page++;
    await sleep(300);
  }
  return ids;
}

async function run() {
  const { data: pendingPicks, error: ppErr } = await supabase.from('picks').select('match_id').eq('result', 'pending');
  if (ppErr) throw new Error(`select picks: ${ppErr.message}`);
  const matchIds = [...new Set((pendingPicks || []).map((p) => p.match_id))];
  if (matchIds.length === 0) {
    console.log('No hay picks pendientes, nada que completar.');
    return;
  }

  const { data: matches, error: mErr } = await supabase.from('matches').select('player_a_id, player_b_id').in('id', matchIds);
  if (mErr) throw new Error(`select matches: ${mErr.message}`);
  const playerIds = [...new Set((matches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
  console.log(`Jugadores con picks pendientes: ${playerIds.length}`);

  const { data: existingTournaments, error: etErr } = await supabase.from('tournaments').select('id');
  if (etErr) throw new Error(`select tournaments: ${etErr.message}`);
  const knownTournamentIds = new Set((existingTournaments || []).map((t) => t.id));

  const tournamentIdsToFetch = new Set();
  for (const playerId of playerIds) {
    try {
      const ids = await fetchRecentTournamentIdsForPlayer(playerId);
      const newOnes = ids.filter((id) => !knownTournamentIds.has(id));
      for (const id of newOnes) tournamentIdsToFetch.add(id);
      console.log(`Jugador ${playerId}: ${ids.length} torneos recientes revisados, ${newOnes.length} nuevos para nosotros`);
    } catch (e) {
      console.error(`Error listando torneos del jugador ${playerId}: ${e.message}`);
    }
    await sleep(300);
  }

  console.log(`Torneos nuevos a completar: ${tournamentIdsToFetch.size}`);

  let tournamentsAdded = 0;
  let matchesAdded = 0;
  for (const id of tournamentIdsToFetch) {
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

      if (!isTournamentFinished(t)) continue;

      const winnerSide = tournamentWinnerSide(t);

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
        status: 'finished',
        winner_id: winnerSide?.player?.id || null
      });
      if (tErr) throw new Error(`upsert tournaments(${t.id}): ${tErr.message}`);
      tournamentsAdded++;

      matchesAdded += await upsertFinishedMatches(t, pageData.widgets);
    } catch (e) {
      console.error(`Error procesando torneo ${id}: ${e.message}`);
    }
    await sleep(300);
  }

  console.log('--- RESUMEN ---');
  console.log({ playersScanned: playerIds.length, tournamentsAdded, matchesAdded });
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
