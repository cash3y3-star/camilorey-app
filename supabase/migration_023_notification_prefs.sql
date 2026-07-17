-- Preferencias granulares de notificaciones + analítica, una fila por
-- usuario. Antes solo existía el permiso del navegador (Notification
-- API) como "todo o nada" — esto agrega categorías que el propio
-- usuario prende/apaga, sin tocar el permiso del navegador en sí
-- (ese sigue siendo el interruptor maestro real: si el navegador
-- niega el permiso, ninguna categoría manda nada).
create table if not exists notification_prefs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  push_enabled      boolean not null default true,
  new_picks         boolean not null default true,
  high_confidence   boolean not null default true,
  pick_results      boolean not null default true,
  streak_alerts     boolean not null default true,
  promotions        boolean not null default true,
  analytics_shared  boolean not null default true,
  updated_at        timestamptz not null default now()
);

alter table notification_prefs enable row level security;

drop policy if exists "select own prefs" on notification_prefs;
create policy "select own prefs" on notification_prefs for select using (auth.uid() = user_id);

drop policy if exists "insert own prefs" on notification_prefs;
create policy "insert own prefs" on notification_prefs for insert with check (auth.uid() = user_id);

drop policy if exists "update own prefs" on notification_prefs;
create policy "update own prefs" on notification_prefs for update using (auth.uid() = user_id);

-- El vigilante de rachas (check-follows.js) necesita recordar hasta
-- qué largo de racha ya avisó por usuario, para no repetir el mismo
-- aviso de "llevas 3 seguidos" cada vez que corre el cron.
create table if not exists notified_streaks (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  last_length  int not null default 0,
  updated_at   timestamptz not null default now()
);

alter table notified_streaks enable row level security;
-- Sin políticas de select/insert/update para el cliente: esta tabla
-- solo la toca el cron con service_role, igual que push_subscriptions
-- la toca push-subscribe.js con service_role.
