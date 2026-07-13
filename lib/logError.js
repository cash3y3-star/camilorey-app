// ============================================================
// CAMILOREY — registro de errores de la app en Supabase
// Solo para fallas de la app (getServerSideProps, rutas API) — los
// cronjobs (sync/backfill/check-follows) ya se avisan solos por
// cron-job.org o el correo de fallos de GitHub Actions. Nunca debe
// tronar la petición que lo llama: si el propio log falla, se traga
// el error silenciosamente.
// ============================================================

async function logError(supabase, { source, message, stack, context }) {
  try {
    await supabase.from('error_log').insert({
      source,
      message: String(message || '').slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      context: context || null
    });
  } catch (e) {
    console.error('No se pudo registrar el error en error_log:', e.message);
  }
}

module.exports = { logError };
