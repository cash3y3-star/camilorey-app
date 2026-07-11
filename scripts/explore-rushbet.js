// ============================================================
// CAMILOREY — reconocimiento de Rushbet (paso 1)
// No guarda nada en la base de datos. Abre rushbet.co con un
// navegador real, intenta llegar a la sección de tenis de mesa, y
// registra:
//   - Toda respuesta de red que parezca JSON (para ver si hay una
//     API como la que encontramos en tt.league-pro.com)
//   - El texto visible de la página
//   - Un screenshot
// Con eso decidimos si se puede scrapear por API o hay que leer el DOM.
//
// OJO: Rushbet es un sitio para el mercado colombiano. Si GitHub
// Actions corre desde una IP fuera de Colombia, es posible que el
// sitio redirija o bloquee el acceso — eso también lo vamos a ver
// en este log.
// ============================================================

const { chromium } = require('playwright');

const CANDIDATE_PATHS = [
  '/apuestas-deportivas/tenis-de-mesa',
  '/es/sports/table-tennis',
  '/sports/table-tennis',
  '/cms/tenis-de-mesa'
];

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-CO' });

  const jsonResponses = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.text();
      jsonResponses.push({
        url: res.url(),
        status: res.status(),
        size: body.length,
        preview: body.slice(0, 500)
      });
    } catch (e) {
      // respuesta ya cerrada u otra cosa rara, la ignoramos
    }
  });

  console.log('Abriendo rushbet.co...');
  await page.goto('https://www.rushbet.co', { waitUntil: 'load', timeout: 30000 }).catch((e) => {
    console.log('Error abriendo homepage:', e.message);
  });
  console.log('URL final tras cargar homepage:', page.url());
  console.log('Título:', await page.title().catch(() => '(sin título)'));

  await page.waitForTimeout(3000);

  // Intentar cerrar cualquier popup de cookies / edad / bienvenida
  const dismissTexts = ['Aceptar', 'Acepto', 'Entendido', 'Continuar', 'Cerrar', 'OK', 'Accept'];
  for (const t of dismissTexts) {
    try {
      const btn = page.getByText(t, { exact: false }).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 1000 });
        console.log('Click en botón:', t);
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // no existe ese botón, seguimos probando
    }
  }

  // Intentar encontrar un link de "Tenis de mesa" en la navegación
  let clicked = false;
  const linkTexts = ['Tenis de mesa', 'Table Tennis', 'Ping Pong'];
  for (const t of linkTexts) {
    try {
      const link = page.getByText(t, { exact: false }).first();
      if (await link.isVisible({ timeout: 1500 })) {
        await link.click({ timeout: 2000 });
        console.log('Click en link de navegación:', t);
        clicked = true;
        break;
      }
    } catch (e) {
      // no está visible, seguimos
    }
  }

  if (!clicked) {
    console.log('No encontré un link directo de tenis de mesa, probando URLs candidatas...');
    for (const path of CANDIDATE_PATHS) {
      try {
        await page.goto(`https://www.rushbet.co${path}`, { waitUntil: 'load', timeout: 20000 });
        console.log(`Probé ${path} -> URL final: ${page.url()}`);
        if (!page.url().includes('get-started') && !page.url().endsWith('rushbet.co/')) {
          clicked = true;
          break;
        }
      } catch (e) {
        console.log(`Error con ${path}:`, e.message);
      }
    }
  }

  await page.waitForTimeout(4000);

  console.log('--- URL final ---');
  console.log(page.url());

  console.log('--- TEXTO VISIBLE (primeros 3000 caracteres) ---');
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '(no se pudo leer)');
  console.log(bodyText.slice(0, 3000));

  console.log(`--- RESPUESTAS JSON CAPTURADAS: ${jsonResponses.length} ---`);
  // Las más relevantes probablemente tengan "sport", "odds", "event",
  // "match", "table-tennis" en la URL — las mostramos primero.
  const keywords = ['sport', 'odds', 'event', 'match', 'table', 'tenis', 'ping-pong', 'liga'];
  const scored = jsonResponses
    .map((r) => ({ ...r, score: keywords.filter((k) => r.url.toLowerCase().includes(k)).length }))
    .sort((a, b) => b.score - a.score);

  for (const r of scored.slice(0, 25)) {
    console.log(`[score ${r.score}] ${r.status} ${r.url} (${r.size} bytes)`);
    console.log('  preview:', r.preview.replace(/\n/g, ' '));
  }

  await page.screenshot({ path: 'rushbet-debug.png', fullPage: true }).catch(() => {});

  await browser.close();
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
