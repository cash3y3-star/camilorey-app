-- Guarda para qué premium_until ya se avisó "te vence mañana", para
-- que check-follows.js (que corre cada 30-60s vía cron-job.org) no
-- repita el mismo aviso en cada corrida mientras la cuenta siga
-- dentro de la ventana de 1 día antes de vencer. Si la persona
-- renueva, premium_until cambia y el aviso vuelve a habilitarse solo
-- (la columna deja de coincidir con el nuevo valor).
alter table profiles add column if not exists premium_expiry_notified_for timestamptz;
