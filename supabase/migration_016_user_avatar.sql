-- Perfil editable: nombre propio, emoji o foto propia en vez de solo
-- lo que trae Google automáticamente al iniciar sesión.
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists avatar_emoji text;
alter table profiles add column if not exists custom_avatar_url text;

-- Mismo emoji también en el chat, para que se vea consistente ahí —
-- los mensajes VIEJOS quedan con la foto/inicial que tenían en ese
-- momento, no se reescribe historial.
alter table chat_messages add column if not exists user_avatar_emoji text;

-- Bucket público para fotos de perfil subidas por usuarios (aparte de
-- "avatars", que son los recortes de FOTOS DE JUGADORES, no de
-- personas usando el sitio).
insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do nothing;

-- Cada quien puede subir/actualizar/borrar SOLO dentro de su propia
-- carpeta (user-avatars/{su-uid}/...) — storage.foldername(name)
-- devuelve la ruta partida en segmentos, el primero es la carpeta.
drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects
  for insert
  with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "update own avatar" on storage.objects;
create policy "update own avatar" on storage.objects
  for update
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own avatar" on storage.objects;
create policy "delete own avatar" on storage.objects
  for delete
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "public read user avatars" on storage.objects;
create policy "public read user avatars" on storage.objects
  for select
  using (bucket_id = 'user-avatars');
