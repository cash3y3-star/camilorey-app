// ============================================================
// CAMILOREY — sincronización automática
// Este endpoint lo llama un Cron Job de Vercel cada X minutos.
// Lee tt.league-pro.com, guarda torneos/jugadores/resultados
// en Supabase y genera picks con la fórmula de confidence.js
//
// IMPORTANTE (léelo antes de asumir que ya "funciona"):
// Escribí este scraper con la estructura de la página que pude
// inspeccionar desde aquí, pero no tengo forma de probarlo en
// vivo contra el sitio real desde este entorno. Es muy probable
// que los selectores necesiten ajuste la primera vez que corra
// en producción. Eso lo afinamos juntos viendo los logs de Vercel.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { computeConfidence } from '../../../lib/confidence';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE = 'https://tt.league-pro.com/en';

// Traduce hora UTC del sitio a el bloque de "jornada" en hora Colombia
function jornadaFromDate(dateUTC) {
  const colombiaHour = new Date(dateUTC).getUTCHours() - 5 >= 0
    ? new Date(dateUTC).getUTCHours() - 5
    : new Date(dateUTC).getUTCHours() + 19;

  if (colombiaHour >= 1 && colombiaHour < 4) return 'Jornada 1';
  if (colombiaHour >= 4 && colombiaHour < 5) return 'Finales J1';
  if (colombiaHour >= 5 && colombiaHour < 8) return 'Jornada 2';
  if (colombiaHour >= 9 && colombiaHour < 12) return 'Jornada 3';
  if (colombiaHour >= 13 && colombiaHour < 16) return 'Jornada 4';
  if (colombiaHour >= 17 && colombiaHour < 22) return 'Jornada 5';
  return 'Fuera de jornada';
}

async function fetchHTML(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CAMILOREY sync bot)' }
  });
  if (!res.ok) throw new Error(`Fetch failed ${path}: ${res.status}`);
  return res.text();
}

async function upsertPlayer(id, name, rating) {
  await supabase.from('players').upsert({ id, name, rating, updated_at: new Date() });
}

async function getRecentStreak(playerId) {
  // Últimos resultados guardados en nuestra propia base (no del sitio)
  const { data } = await supabase
    .from('matches')
    .select('winner_id, player_a_id, player_b_id, status')
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
  const total = data.length;
  const winsA = data.filter((m) => m.winner_id === playerAId).length;
  return { h2hWinsA: winsA, h2hTotal: total };
}

export default async function handler(req, res) {
  // Protegemos el endpoint para que solo Vercel Cron (o tú) lo llame
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const html = await fetchHTML('/tournaments');
    const $ = cheerio.load(html);

    const results = [];

    // NOTA: estos selectores son un punto de partida — hay que
    // revisarlos contra el HTML real una vez desplegado.
    $('a[href*="/tournaments/"]').each((_, el) => {
      const href = $(el).attr('href');
      const idMatch = href.match(/tournaments\/(\d+)/);
      if (!idMatch) return;
      results.push({ id: Number(idMatch[1]), text: $(el).text().trim() });
    });

    let processed = 0;

    for (const t of results) {
      const detailHtml = await fetchHTML(`/tournaments/${t.id}`);
      const $$ = cheerio.load(detailHtml);

      // Extraer jugadores del torneo — ajustar selector real
      const players = [];
      $$('a[href*="/players/"]').each((_, el) => {
        const href = $$(el).attr('href');
        const idMatch = href.match(/players\/(\d+)/);
        if (!idMatch) return;
        const name = $$(el).text().replace(/\(\d+\)/, '').trim();
        const ratingMatch = $$(el).text().match(/\((\d+)\)/);
        players.push({
          id: Number(idMatch[1]),
          name,
          rating: ratingMatch ? Number(ratingMatch[1]) : null
        });
      });

      for (const p of players) {
        await upsertPlayer(p.id, p.name, p.rating);
      }

      // Con 2 jugadores identificados armamos el match + pick
      if (players.length >= 2) {
        const [a, b] = players;

        const scheduledAt = new Date(); // TODO: parsear fecha real del detalle
        const jornada = jornadaFromDate(scheduledAt);

        const { data: matchRow } = await supabase
          .from('matches')
          .upsert(
            {
              tournament_id: t.id,
              player_a_id: a.id,
              player_b_id: b.id,
              scheduled_at: scheduledAt,
              status: 'scheduled'
            },
            { onConflict: 'tournament_id' }
          )
          .select()
          .single();

        const streakA = await getRecentStreak(a.id);
        const streakB = await getRecentStreak(b.id);
        const { h2hWinsA, h2hTotal } = await getH2H(a.id, b.id);

        const { confidence, factors } = computeConfidence({
          ratingDiff: (a.rating || 0) - (b.rating || 0),
          streakA,
          streakB,
          h2hWinsA,
          h2hTotal
        });

        await supabase.from('picks').upsert({
          match_id: matchRow?.id,
          market: 'Ganador del partido',
          confidence,
          factors,
          result: 'pending'
        });

        processed++;
      }
    }

    return res.status(200).json({ ok: true, processed });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
