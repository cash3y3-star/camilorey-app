-- CAMILOREY — "el pick de CAMILOREY" (el tipster del sitio, marcado a
-- mano por el admin sobre un pick puntual). Solo uno activo a la vez
-- (lo maneja pages/api/admin-tipster-pick.js) — dispara push a
-- Exclusivo/Premium y aparece destacado en Inicio.

alter table picks add column if not exists tipster_pick boolean not null default false;
alter table picks add column if not exists tipster_pick_at timestamptz;
