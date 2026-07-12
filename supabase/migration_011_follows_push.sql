-- "Seguir este pick" + notificaciones push del navegador.
--
-- followed_picks: qué picks sigue cada usuario (para la pestaña
-- Favoritos). Se referencia tanto el pick como el match porque el
-- vigilante de notificaciones necesita el match para leer el
-- marcador en vivo, y la UI necesita el pick para mostrar la tarjeta.
create table if not exists followed_picks (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  pick_id     bigint not null references picks(id) on delete cascade,
  match_id    bigint not null references matches(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (user_id, pick_id)
);

alter table followed_picks enable row level security;

drop policy if exists "select own follows" on followed_picks;
create policy "select own follows" on followed_picks for select using (auth.uid() = user_id);

drop policy if exists "insert own follows" on followed_picks;
create policy "insert own follows" on followed_picks for insert with check (auth.uid() = user_id);

drop policy if exists "delete own follows" on followed_picks;
create policy "delete own follows" on followed_picks for delete using (auth.uid() = user_id);

-- push_subscriptions: la suscripción de Web Push que da el navegador
-- (endpoint + llaves de cifrado). endpoint es único porque cada
-- dispositivo/navegador genera el suyo; si el mismo usuario se
-- vuelve a suscribir desde el mismo navegador, se actualiza en vez
-- de duplicar (upsert por endpoint desde el cliente).
create table if not exists push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "select own subs" on push_subscriptions;
create policy "select own subs" on push_subscriptions for select using (auth.uid() = user_id);

drop policy if exists "insert own subs" on push_subscriptions;
create policy "insert own subs" on push_subscriptions for insert with check (auth.uid() = user_id);

drop policy if exists "update own subs" on push_subscriptions;
create policy "update own subs" on push_subscriptions for update using (auth.uid() = user_id);

drop policy if exists "delete own subs" on push_subscriptions;
create policy "delete own subs" on push_subscriptions for delete using (auth.uid() = user_id);

-- El vigilante de notificaciones (cron aparte, corre cada 30-60s)
-- necesita recordar hasta qué set ya avisó y si ya avisó que el
-- partido terminó, para no mandar la misma notificación varias veces.
alter table matches add column if not exists notified_sets_count int not null default 0;
alter table matches add column if not exists notified_finished boolean not null default false;
