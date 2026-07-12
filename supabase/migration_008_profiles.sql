-- Perfil público espejo de auth.users, para poder contar/consultar
-- usuarios registrados desde el resto de la app (auth.users no es
-- consultable directo vía la API normal).
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- Cada quien puede ver y actualizar solo su propio perfil. El conteo
-- total de usuarios lo hacemos desde el servidor con la service_role
-- key, que igual pasa por encima de RLS.
drop policy if exists "select own profile" on profiles;
create policy "select own profile" on profiles for select using (auth.uid() = id);

drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- Crea el perfil automáticamente cuando alguien se registra (Google,
-- o cualquier otro proveedor que se agregue después).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
