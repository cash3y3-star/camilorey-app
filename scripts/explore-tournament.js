// ============================================================
// CAMILOREY — reconocimiento del detalle de un torneo
// Miramos la página /en/tournaments/{id} para entender:
// - Cómo se ve el historial partido por partido de cada jugador
// - Si hay tabla de posiciones / fase (grupo, semifinal, final)
// - Si se puede saber si un jugador ya quedó eliminado
// ============================================================

const { chromium } = require('playwright');

const TOURNAMENT_ID = process.env.TOURNAMENT_ID || '35094';

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const url = `https://tt.league-pro.com/en/tournaments/${TOURNAMENT_ID}`;
  console.log('Abriendo', url);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });

  try {
    const btn = page.getByText('Accept', { exact: false }).first();
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
  } catch (e) {}

  await page.waitForTimeout(4000);

  console.log('--- TEXTO VISIBLE COMPLETO ---');
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log(bodyText.slice(0, 4000));

  console.log('--- LINKS A JUGADORES en esta página ---');
  const playerLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/players/"]')).map((a) => a.getAttribute('href'))
  );
  console.log(JSON.stringify([...new Set(playerLinks)], null, 2));

  console.log('--- HTML del body (primeros 4000 caracteres) ---');
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log(html.slice(0, 4000));

  await page.screenshot({ path: 'tournament-detail.png', fullPage: true });

  await browser.close();
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
