-- Varios tipsters reales (pedido 2026-07-27): hasta ahora "el pick de
-- CAMILO REY" era una sola marca (picks.tipster_pick), sin dueño — con
-- más de un tipster eligiendo picks, hace falta saber CUÁL de ellos
-- marcó cada uno. tipster_pick sigue significando "hay alguna marca
-- acá" (compatibilidad con lo que ya lee ese campo); tipster_pick_by
-- dice de quién es.
alter table picks add column if not exists tipster_pick_by uuid references auth.users(id);

-- is_tipster (distinto de is_admin): quién tiene perfil público de
-- tipster en el sitio. Hoy coincide con quién es admin, pero son
-- conceptos separados a propósito — no todo admin tiene por qué ser
-- una cara pública, ni viceversa el día de mañana. Se otorga a mano
-- igual que is_admin, no hay auto-otorgamiento posible desde el
-- cliente (sin GRANT de columna para authenticated).
alter table profiles add column if not exists is_tipster boolean not null default false;

update profiles
set is_tipster = true
where email ilike 'cash3y3@gmail.com'
   or email ilike 'josuahola28@gmail.com'
   or email ilike 'cristianalbornoz413@gmail.com';
