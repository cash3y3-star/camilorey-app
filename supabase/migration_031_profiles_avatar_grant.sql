-- Arreglo 2026-07-26: migration_030 (auditoría de seguridad) cerró el
-- GRANT de columnas de "profiles" a solo display_name/follows_tipster,
-- pero se le olvidó custom_avatar_url/avatar_emoji — que es justo lo
-- que usa handleAvatarFileChange (pages/index.js) al subir una foto de
-- perfil. Desde ese día, cualquier cuenta que intentara cambiar su
-- foto se quedaba pegada en "Error: permission denied for column
-- custom_avatar_url" (reportado por dos socios, pero afecta a todos).
grant update (custom_avatar_url, avatar_emoji) on profiles to authenticated;
grant insert (custom_avatar_url, avatar_emoji) on profiles to authenticated;
