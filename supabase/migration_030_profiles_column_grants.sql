-- Arreglo 2026-07-23 (auditoría de seguridad, hallazgo crítico):
-- "update own profile" / "insert own profile" (migration_008 /
-- migration_017) solo restringen CUÁL fila se puede tocar
-- (auth.uid() = id) — nunca QUÉ COLUMNAS. profiles.premium_until
-- (migration_020) decide quién es Premium, y por default de Supabase
-- el rol "authenticated" tiene privilegio de UPDATE sobre toda la
-- tabla — así que CUALQUIER cuenta logueada podía auto-otorgarse
-- Premium gratis, sin pasar por el admin ni pagar, con una sola
-- llamada desde la consola del navegador:
--   supabaseClient.from('profiles').update({ premium_until: '2099-01-01' }).eq('id', suPropioId)
-- Esa llamada pasa la política RLS sin problema, porque la política
-- nunca miró QUÉ se estaba cambiando, solo DE QUIÉN era la fila.
--
-- El código real del cliente (pages/index.js) solo necesita poder
-- tocar display_name y follows_tipster — todo lo demás (premium_until,
-- email, avatar_url, full_name...) tiene que quedar fuera de su
-- alcance sin importar lo que diga RLS. Column-level GRANT es la
-- única forma de cerrar esto de verdad (RLS es por fila, no por
-- columna). Esto no afecta a las rutas admin (admin-activate-premium.js
-- y demás) — esas usan la service_role key, que no pasa por estos
-- grants.
revoke update on profiles from authenticated;
grant update (display_name, follows_tipster) on profiles to authenticated;

revoke insert on profiles from authenticated;
grant insert (id, display_name, follows_tipster) on profiles to authenticated;
