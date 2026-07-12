// ============================================================
// CAMILOREY — backfill acotado y observable para UN jugador, corre en
// Vercel (no en GitHub Actions) para poder ver el resultado exacto de
// cada llamada en vez de depender de logs de Actions inaccesibles.
// Camina el historial paginado de tt.league-pro.com hasta juntar
// `target` partidos terminados para ese jugador (o agotar `maxPages`),
// completando torneos/partidos que nos falten. NO genera picks nuevos
// ni toca bankroll_log. Se borra después de usarlo.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { fetchNuxtData } from '../../../lib/tt';
import { ensureAvatarCutout } from '../../../lib/avatarCutout';

const MEDIA_BASE = 'https://api.league-pro.com';

function playerName(p) {
  return p.short_name_en || `${p.first_name_en} ${p.surname_en}`.trim();
}

function isTournamentFinished(t) {
  const realSides = t.sides.filter((s) => !s.is_tba);
  return realSides.length > 0 && realSides.every((s) => s.place != null);
}

function tournamentWinnerSide(t) {
  return t.sides.find((s) => s.place === 1) || null;
}

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const playerId = Number(req.query.playerId);
  if (!playerId) return res.status(400).json({ error: 'falta playerId' });
  const target = Number(req.query.target || 10);
  const maxPages = Number(req.query.maxPages || 10);
  const startPage = Number(req.query.startPage || 1);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

  async function finishedCountFor(id) {
    const { count } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player_a_id.eq.${id},player_b_id.eq.${id}`)
      .eq('status', 'finished');
    return count || 0;
  }

  const { data: existingTournaments, error: etErr } = await supabase.from('tournaments').select('id');
  if (etErr) return res.status(500).json({ error: etErr.message });
  const known = new Set((existingTournaments || []).map((t) => t.id));

  const log = [];
  let tournamentsAdded = 0;
  let matchesAdded = 0;
  let page = startPage;
  let current = await finishedCountFor(playerId);
  const startCount = current;
  let lastPageWalked = startPage - 1;
  let reachedEnd = false;

  try {
    while (page < startPage + maxPages && current < target) {
      const detail = await fetchNuxtData(`/en/players/${playerId}?page=${page}`);
      const widget = detail['player-previous-tournaments'];
      const items = widget?.items || [];
      lastPageWalked = page;
      if (items.length === 0) {
        log.push({ page, note: 'sin items, se detiene' });
        reachedEnd = true;
        break;
      }

      for (const item of items) {
        if (known.has(item.id)) continue;
        try {
          const tDetail = await fetchNuxtData(`/en/tournaments/${item.id}`);
          const pageData = tDetail['tournament-page']?.pageData;
          if (!pageData) {
            log.push({ tournamentId: item.id, skipped: 'sin pageData' });
            continue;
          }
          const t = {
            id: pageData.tournament.id,
            name_en: pageData.tournament.name_en,
            start_at: pageData.tournament.start_date,
            sides: pageData.widgets.sides
          };
          if (!isTournamentFinished(t)) {
            log.push({ tournamentId: item.id, skipped: 'no terminado todavía' });
            continue;
          }
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
          if (tErr) {
            log.push({ tournamentId: item.id, error: tErr.message });
            continue;
          }
          tournamentsAdded++;
          known.add(t.id);

          const added = await upsertFinishedMatches(t, pageData.widgets);
          matchesAdded += added;
          log.push({ tournamentId: item.id, name: t.name_en, matchesAdded: added });
        } catch (e) {
          log.push({ tournamentId: item.id, error: e.message });
        }
      }

      current = await finishedCountFor(playerId);

      const { total_items, limit, offset } = widget.pagination || {};
      if (offset == null || offset + limit >= total_items) {
        reachedEnd = true;
        break;
      }
      page++;
    }
  } catch (e) {
    return res.status(200).json({
      playerId,
      startCount,
      endCount: current,
      tournamentsAdded,
      matchesAdded,
      lastPageWalked,
      reachedEnd,
      fatalError: e.message,
      log
    });
  }

  return res.status(200).json({
    playerId,
    startCount,
    endCount: current,
    tournamentsAdded,
    matchesAdded,
    lastPageWalked,
    reachedEnd,
    log
  });
}
