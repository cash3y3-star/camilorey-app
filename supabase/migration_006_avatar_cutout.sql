-- Versión de la foto del jugador con el fondo quitado (procesada
-- localmente con @imgly/background-removal-node, sin API externa),
-- guardada en Supabase Storage. Null hasta que se procese; se procesa
-- una sola vez por jugador, no en cada corrida del sync.
alter table players add column if not exists avatar_cutout_url text;
