-- Amplía picks.prediction_source (migration_038_prediction_source.sql) para
-- aceptar 'manual' — pages/api/admin-edit-pick.js lo usa cuando un admin
-- corrige a mano el favorito/confianza de un pick pendiente. Se guarda
-- aparte de 'ml'/'formula' a propósito: la pestaña Modelo compara acierto
-- real de ML vs fórmula (pages/api/model-stats.js:bySource), y mezclar ahí
-- correcciones manuales del admin ensuciaría esa comparación.
alter table picks drop constraint if exists picks_prediction_source_check;
alter table picks add constraint picks_prediction_source_check
  check (prediction_source in ('formula', 'ml', 'manual'));
