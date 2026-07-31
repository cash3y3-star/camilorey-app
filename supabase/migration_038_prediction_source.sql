-- Marca, por cada pick, si favored/confidence salió del modelo de ML
-- (lib/ml-model.js, una vez que hay >= MIN_TRAINING_SAMPLES picks
-- resueltos) o de la fórmula fija (lib/confidence.js) — antes no había
-- forma de auditar cuál de los dos decidió un pick puntual, ni de
-- medir el acierto real de cada uno por separado en la pestaña Modelo
-- del admin (pages/api/model-stats.js). El trainingCount de cada
-- corrida no queda guardado en ningún lado y crece con cada picks
-- resuelto, así que no se puede reconstruir después cuál era la
-- fuente para un pick ya viejo — tiene que quedar dicho en el momento.
--
-- default 'formula' a propósito: es exactamente lo que fue CADA pick
-- generado antes de este cambio (el ML nunca decidió favorito/
-- confianza hasta ahora, solo filtraba Exclusivo) — no hace falta
-- backfill aparte, Postgres aplica el default también a las filas ya
-- existentes.
alter table picks add column if not exists prediction_source text not null default 'formula'
  check (prediction_source in ('formula', 'ml'));

create index if not exists idx_picks_prediction_source on picks(prediction_source);
