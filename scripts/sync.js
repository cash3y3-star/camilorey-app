// ============================================================
// CAMILOREY — sincronización real
// Corre en GitHub Actions cada 30 min. Abre tt.league-pro.com
// con un navegador real, lee:
//   1) Partidos programados/en vivo (para generar picks)
//   2) Torneos finalizados recientes (para historial/rachas)
// y guarda todo en Supabase.
// ============================================================

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { computeConfidence } = require('../lib/confidence');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractId(href, pattern) {
  const m = href && href.match(pattern);
  return m ? Number(m[1]) : null;
}

async function upsertPlayer(id, name, rating) {
  if (!id || !name) return;
  await supabase.from('players').upsert({ id, name, rating, updated_at: new Date() });
}

async function getRecentStreak(playerId) {
  const { data } = await supabase
    .from('tournaments')
    .select('winner_id, created_at')
    .not('winner_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!data) return 0;
  let streak = 0;
  for (const t of data) {
    const won = t.winner_id === playerId;
    if (!won) continue;
    streak++;
    if (streak >= 3) break;
  }
  return streak;
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Abriendo tt.league-pro.com...');
  await page.goto('https://tt.league-pro.com/en', { waitUntil: 'load', timeout: 30000 });

  try {
    const btn = page.getByText('Accept', { exact: false }).first();
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
  } catch (e) {}

  await page.waitForTimeout(3000);

  const liveMatches = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.c-live-matches-item'));
    return items.map((item) => {
      const href = item.tagName === 'A'
        ? item.getAttribute('href')
        : item.querySelector('a[href*="/tournaments/"]')?.getAttribute('href');
      const tournamentName = item.querySelector('.c-live-matches-item__tournament-name')?.innerText.trim();
      const playerRows = Array.from(item.querySelectorAll('.ui-player-row')).map((row) => {
        const href = row.getAttribute('href');
        const fullText = row.innerText.trim();
        const ratingMatch = fullText.match(/\((\d+)\)/);
        const name = fullText.replace(/\(\d+\)/, '').trim();
        return { href, name, rating: ratingMatch ? Number(ratingMatch[1]) : null };
      });
      return {
        href: link ? link.getAttribute('href') : null,
        tournamentName,
        players: playerRows,
        rawDateText: item.innerText.split('\n')[0],
      };
    });
  });

  console.log(`Partidos programados encontrados: ${liveMatches.length}`);

  let matchesProcessed = 0;
  let picksGenerated = 0;

  for (const m of liveMatches) {
    if (!m.href || m.players.length < 2) continue;

    const tournamentId = extractId(m.href, /tournaments\/(\d+)/);
    const [pA, pB] = m.players;

    const playerAId = extractId(pA.href, /players\/(\d+)/);
    const playerBId = extractId(pB.href, /players\/(\d+)/);
    if (!playerAId || !playerBId) continue;

    await upsertPlayer(playerAId, pA.name, pA.rating);
    await upsertPlayer(playerBId, pB.name, pB.rating);

    await supabase.from('tournaments').upsert({
      id: tournamentId,
      name: m.tournamentName,
      status: 'scheduled',
    });

    const { data: matchRow } = await supabase
      .from('matches')
      .upsert(
        {
          tournament_id: tournamentId,
          player_a_id: playerAId,
          player_b_id: playerBId,
          status: 'scheduled',
          raw_data: m,
        },
        { onConflict: 'tournament_id' }
      )
      .select()
      .single();

    matchesProcessed++;

    const streakA = await getRecentStreak(playerAId);
    const streakB = await getRecentStreak(playerBId);

    const { confidence, factors } = computeConfidence({
      ratingDiff: (pA.rating || 0) - (pB.rating || 0),
      streakA,
      streakB,
      h2hWinsA: 0,
      h2hTotal: 0,
    });

    if (matchRow?.id) {
      await supabase.from('picks').upsert(
        {
          match_id: matchRow.id,
          market: `${confidence >= 70 ? pA.name : pB.name} gana`,
          confidence,
          factors,
          result: 'pending',
        },
        { onConflict: 'match_id' }
      );
      picksGenerated++;
    }
  }

  const finishedTournaments = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.c-tournament-item'));
    return items.map((item) => {
      const link = item.querySelector('a[href*="/tournaments/"]') || item;
      const href = link.getAttribute ? link.getAttribute('href') : item.querySelector('a')?.getAttribute('href');
      const texts = Array.from(item.querySelectorAll('div'))
        .map((d) => d.innerText?.trim())
        .filter((t) => t && t.length > 0 && !t.includes('\n'));
      return { href, texts };
    });
  });

  console.log(`Torneos finalizados encontrados: ${finishedTournaments.length}`);

  let tournamentsUpdated = 0;

  for (const t of finishedTournaments) {
    if (!t.href) continue;
    const tournamentId = extractId(t.href, /tournaments\/(\d+)/);
    if (!tournamentId) continue;

    const winnerName = t.texts[t.texts.length - 1];
    if (!winnerName) continue;

    const { data: existingPlayer } = await supabase
      .from('players')
      .select('id')
      .eq('name', winnerName)
      .limit(1)
      .maybeSingle();

    await supabase.from('tournaments').upsert({
      id: tournamentId,
      status: 'finished',
      winner_id: existingPlayer?.id || null,
    });

    tournamentsUpdated++;
  }

  console.log('--- RESUMEN ---');
  console.log({ matchesProcessed, picksGenerated, tournamentsUpdated });

  await browser.close();
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
