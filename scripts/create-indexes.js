// ============================================================
// CAMILOREY — corre los CREATE INDEX CONCURRENTLY de
// supabase/migration_028_matches_player_indexes.sql directo contra
// Postgres, sin pasar por el SQL Editor del panel de Supabase.
//
// Por qué esto y no el SQL Editor: la tabla matches está siendo
// escrita todo el tiempo (sync.js cada ~60s + el sitio bajo carga
// intentando las mismas consultas lentas que estos índices vienen a
// arreglar) — construir un índice ahí puede tardar bastante, y el
// panel del navegador tiene un timeout de conexión mucho más corto
// que una conexión de servidor normal. Acá no hay ese límite.
//
// CONCURRENTLY no puede correr dentro de una transacción — node-pg
// no envuelve queries sueltas en una automáticamente, así que cada
// CREATE INDEX se manda como su propia consulta, una por una.
// ============================================================

const { Client } = require('pg');

const STATEMENTS = [
  'create index concurrently if not exists idx_matches_player_a on matches(player_a_id)',
  'create index concurrently if not exists idx_matches_player_b on matches(player_b_id)',
  'create index concurrently if not exists idx_matches_tournament on matches(tournament_id)'
];

async function run() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log('Conectado a la base.');

  for (const sql of STATEMENTS) {
    console.log(`\nCorriendo: ${sql}`);
    const start = Date.now();
    await client.query(sql);
    console.log(`Listo en ${Math.round((Date.now() - start) / 1000)}s.`);
  }

  await client.end();
  console.log('\nTodos los índices están creados (o ya existían).');
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
