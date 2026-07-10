// ============================================================
// CAMILOREY — script de reconocimiento (paso 1)
// Este script NO guarda nada en la base de datos todavía.
// Solo abre la página real con un navegador (para que el
// JavaScript cargue los datos) e imprime en pantalla cómo está
// estructurada la tabla de torneos. Con ese resultado real,
// ajustamos el scraper definitivo sin adivinar.
// ============================================================

const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Abriendo tt.league-pro.com...');
  await page.goto('https://tt.league-pro.com/en', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('URL final:', page.url());
  console.log('Título:', await page.title());

  const cookieTexts = ['Accept', 'Aceptar', 'I agree', 'Agree', 'OK', 'Got it'];
  for (const t of cookieTexts) {
    try {
      const btn = page.getByText(t, { exact: false }).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 1000 });
        console.log('Click en botón de cookies:', t);
        break;
      }
    } catch (e) {
      // no existe ese botón, seguimos probando
    }
  }

  await page.waitForTimeout(3000);

  const htmlLength = (await page.content()).length;
  console.log('Largo total del HTML renderizado:', htmlLength);

  const links = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a'));
    return as
      .map((a) => a.getAttribute('href'))
      .filter((href) => href && (href.includes('/tournaments/') || href.includes('/players/')));
  });
  console.log('--- LINKS de torneos/jugadores encontrados:', links.length, '---');
  console.log(JSON.stringify(links.slice(0, 20), null, 2));

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- TEXTO VISIBLE (primeros 2500 caracteres) ---');
  console.log(bodyText.slice(0, 2500));

  if (links.length > 0) {
    const firstTournamentHref = links.find((l) => l.includes('/tournaments/'));
    if (firstTournamentHref) {
      const containerHTML = await page.evaluate((href) => {
        const a = document.querySelector(`a[href="${href}"]`);
        if (!a) return 'NO ENCONTRADO';
        let el = a;
        for (let i = 0; i < 3 && el.parentElement; i++) el = el.parentElement;
        return el.outerHTML;
      }, firstTournamentHref);
      console.log('--- HTML COMPLETO del primer item de partido ---');
      console.log(containerHTML);
    }
  }

  await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });

  await browser.close();
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
