-- migration_008 solo daba permiso de SELECT/UPDATE en "profiles" — el
-- trigger que crea la fila al registrarse corre con SECURITY DEFINER
-- (pasa por encima de RLS), así que nunca hizo falta INSERT desde el
-- cliente hasta ahora. El editor de perfil (nombre/emoji/foto) usa
-- upsert() para guardar, que SIEMPRE necesita permiso de insertar
-- aunque el resultado real termine siendo un update — sin esta
-- política, Postgres rechaza el upsert entero con "new row violates
-- row-level security policy" (el error que salió al probarlo).
drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles for insert with check (auth.uid() = id);
