// ============================================================
// CAMILOREY — análisis de acierto real vs lib/confidence.js
// Solo lee y reporta a consola, no escribe nada en la base de datos.
// Se corre manual desde GitHub Actions cuando quieras ver qué tan
// calibrado está el modelo con los picks que ya se resolvieron.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Intervalo de Wilson para el 95% de confianza de una proporción —
// más honesto que +/- normal cuando la muestra es chica.
function wilsonInterval(hits, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function run() {
  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, confidence, factors, predicted_winner_id, result, match_id')
    .in('result', ['hit', 'miss']);
  if (error) throw new Error(`select picks: ${error.message}`);

  if (!picks || picks.length === 0) {
    console.log('Todavía no hay picks resueltos.');
    return;
  }

  const matchIds = [...new Set(picks.map((p) => p.match_id))];
  const { data: matches, error: mErr } = await supabase.from('matches').select('id, player_a_id').in('id', matchIds);
  if (mErr) throw new Error(`select matches: ${mErr.message}`);
  const matchById = new Map((matches || []).map((m) => [m.id, m]));

  // factors.* está guardado relativo a "jugador A vs B", no a
  // "favorito vs no favorito" — hay que orientarlo según a quién
  // favoreció realmente el pick para que un promedio tenga sentido.
  const rows = picks
    .map((p) => {
      const match = matchById.get(p.match_id);
      if (!match || !p.factors) return null;
      const sign = p.predicted_winner_id === match.player_a_id ? 1 : -1;
      return {
        hit: p.result === 'hit',
        confidence: p.confidence,
        ratingScore: (p.factors.ratingScore ?? 0) * sign,
        streakScore: (p.factors.streakScore ?? 0) * sign,
        h2hScore: (p.factors.h2hScore ?? 0) * sign,
        altScore: (p.factors.altScore ?? 0) * sign
      };
    })
    .filter(Boolean);

  const n = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const [lo, hi] = wilsonInterval(hits, n);

  console.log('=== RESUMEN GENERAL ===');
  console.log(`Picks resueltos: ${n} (${hits} hit, ${n - hits} miss)`);
  console.log(`Acierto real: ${fmtPct(hits / n)}  (IC 95%: ${fmtPct(lo)} - ${fmtPct(hi)})`);
  if (n < 100) {
    console.log('AVISO: con menos de 100 casos el intervalo es ancho — no toques los pesos de confidence.js solo con esto.');
  }

  console.log('\n=== POR RANGO DE CONFIANZA ===');
  const buckets = [
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 92]
  ];
  for (const [lo_, hi_] of buckets) {
    const inBucket = rows.filter((r) => r.confidence >= lo_ && r.confidence <= hi_);
    if (inBucket.length === 0) continue;
    const bHits = inBucket.filter((r) => r.hit).length;
    console.log(`  ${lo_}-${hi_}%: ${inBucket.length} picks, ${fmtPct(bHits / inBucket.length)} de acierto real`);
  }

  console.log('\n=== POR FACTOR (orientado al favorito; positivo = a favor del pick) ===');
  for (const key of ['ratingScore', 'streakScore', 'h2hScore', 'altScore']) {
    const withHit = rows.filter((r) => r.hit).map((r) => r[key]);
    const withMiss = rows.filter((r) => !r.hit).map((r) => r[key]);
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    console.log(`  ${key}: promedio en hits = ${avg(withHit).toFixed(3)}, promedio en miss = ${avg(withMiss).toFixed(3)}`);
  }

  console.log(
    '\nSi el promedio en "hits" es consistentemente más alto que en "miss" para un factor, ese factor sí está aportando señal real. Si salen parecidos (o al revés), ese factor puede estar de más o con el peso equivocado — pero solo vale la pena actuar sobre esto con una muestra bastante más grande que la actual.'
  );
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
