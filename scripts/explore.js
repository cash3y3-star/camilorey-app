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
  await page.goto('https://tt.league-pro.com/en', { waitUntil: 'networkidle', timeout: 30000 });

  await page.waitForTimeout(2000);

  const rowCount = await page.locator('tr').count();
  console.log('Total de <tr> encontradas:', rowCount);

  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('tr')).slice(0, 8);
    return trs.map((tr) => ({
      html_class: tr.className,
      cells: Array.from(tr.querySelectorAll('td,th')).map((td) => ({
        text: td.innerText.trim(),
        class: td.className,
      })),
      links: Array.from(tr.querySelectorAll('a')).map((a) => a.getAttribute('href')),
    }));
  });

  console.log('--- PRIMERAS 8 FILAS (estructura real) ---');
  console.log(JSON.stringify(rows, null, 2));

  await browser.close();
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
