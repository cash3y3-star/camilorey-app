// ============================================================
// CAMILOREY — conversión única de bankroll_log a pesos colombianos
// Corre UNA VEZ (manual, vía GitHub Actions) para recalcular todo el
// historial ya resuelto con la nueva escala de apuesta en pesos
// (lib/staking.js, $100.000-$250.000 según confianza) en vez de las
// unidades abstractas viejas (0.5u-2u), arrancando el banco en
// $2.000.000. Después de esto, scripts/sync.js sigue solo, ya que
// lib/staking.js ya está en pesos y bankroll_log.balance queda en el
// valor correcto para que la siguiente apuesta continúe desde ahí.
//
// El signo de "units" (positivo=acierto, negativo=fallo) es lo único
// que se toma del row viejo — el monto se recalcula desde cero con la
// confianza y cuota real del pick, en el orden cronológico original.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { computeStake } = require('../lib/staking');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const STARTING_BANK = 2000000;

async function run() {
  const { data: rows, error } = await supabase
    .from('bankroll_log')
    .select('id, pick_id, units, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`select bankroll_log: ${error.message}`);

  if (!rows || rows.length === 0) {
    console.log('No hay bankroll_log que convertir.');
    return;
  }

  const pickIds = [...new Set(rows.map((r) => r.pick_id).filter(Boolean))];
  const { data: picks, error: pErr } = await supabase.from('picks').select('id, confidence, odds').in('id', pickIds);
  if (pErr) throw new Error(`select picks: ${pErr.message}`);
  const picksById = new Map((picks || []).map((p) => [p.id, p]));

  let balance = STARTING_BANK;
  let converted = 0;
  let skipped = 0;

  for (const row of rows) {
    const pick = picksById.get(row.pick_id);
    if (!pick) {
      console.log(`  fila ${row.id}: sin pick asociado (pick_id=${row.pick_id}), se deja igual`);
      skipped++;
      continue;
    }

    const hit = Number(row.units) > 0;
    const stake = computeStake(pick.confidence);
    const units = hit ? (pick.odds ? Math.round(stake * (pick.odds - 1)) : stake) : -stake;
    balance += units;

    const { error: upErr } = await supabase.from('bankroll_log').update({ units, balance }).eq('id', row.id);
    if (upErr) throw new Error(`update bankroll_log(${row.id}): ${upErr.message}`);
    converted++;
  }

  console.log('--- RESUMEN ---');
  console.log({ filas: rows.length, convertidas: converted, saltadas: skipped, bancoInicial: STARTING_BANK, bancoFinal: balance });
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
