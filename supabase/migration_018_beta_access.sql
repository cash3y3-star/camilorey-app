-- Prueba cerrada: por ahora el sitio completo queda detrás de un
-- login de Google + esta lista de invitados (ver BETA_GATE_END en
-- pages/index.js) — pasada la fecha límite, solo el admin entra,
-- sin importar quién siga en esta tabla.
create table if not exists beta_access (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table beta_access enable row level security;

-- Cada quien logueado puede consultar SOLO si SU PROPIO correo está
-- en la lista (no se puede leer la lista completa de invitados desde
-- el navegador) — auth.jwt()->>'email' es el correo real verificado
-- por Supabase Auth, no algo que el cliente pueda inventar.
drop policy if exists "check own beta access" on beta_access;
create policy "check own beta access" on beta_access
  for select
  using (auth.uid() is not null and email = (auth.jwt() ->> 'email'));

-- Para agregar o quitar invitados mientras dure la prueba (correlo en
-- el SQL Editor de Supabase):
--   insert into beta_access (email) values ('alguien@gmail.com') on conflict do nothing;
--   delete from beta_access where email = 'alguien@gmail.com';
