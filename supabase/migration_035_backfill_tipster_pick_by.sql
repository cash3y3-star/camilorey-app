-- Arreglo 2026-07-27: migration_033 agregó picks.tipster_pick_by, pero
-- los picks que YA estaban destacados (tipster_pick=true) de ANTES de
-- que existiera esa columna quedaron con tipster_pick_by=NULL — y
-- "Picks recientes de X" ahora filtra por ese dato exacto, así que
-- todo ese historial viejo (siempre fue de CAMILO REY, el único
-- tipster que existía hasta ahora) dejó de aparecer en su perfil.
-- Esto se los reasigna a él.
update picks
set tipster_pick_by = (select id from auth.users where email ilike 'cash3y3@gmail.com')
where tipster_pick = true and tipster_pick_by is null;
