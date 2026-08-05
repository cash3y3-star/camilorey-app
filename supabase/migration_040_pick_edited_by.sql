-- Pedido 2026-08-05: cuando un admin corrige a mano un pick (ver
-- pages/api/admin-edit-pick.js, migration_039), los DEMÁS admins tienen
-- que poder ver quién lo editó — antes no quedaba registro de eso.
-- edited_by_name queda desnormalizado (en vez de solo el uuid + un join)
-- porque el nombre que corresponde mostrar es exactamente el mismo
-- displayName que ya resuelve checkAdmin() (lib/adminAuth.js) al momento
-- de la edición — no hace falta reconstruirlo después con otra consulta.
alter table picks add column if not exists edited_by uuid references auth.users(id);
alter table picks add column if not exists edited_by_name text;
alter table picks add column if not exists edited_at timestamptz;
