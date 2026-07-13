-- "Mi Bankroll": simulador personal para cualquier usuario (no solo
-- admin). No es una nueva bitácora de apuestas — el resultado
-- (acierto/fallo, cuota) ya vive en followed_picks + picks, así que
-- el balance/evolución se recalcula en el cliente cada vez a partir
-- de eso con la misma fórmula de Kelly que ya usa el Bankroll del
-- admin. Esta tabla solo guarda las DOS cosas que sí son elección
-- personal: cuánto banco arrancar y qué tan agresivo apostar.
create table if not exists user_bankroll_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  starting_bank numeric not null default 2000000,
  risk_level    text not null default 'equilibrado',
  updated_at    timestamptz not null default now()
);

alter table user_bankroll_settings enable row level security;

drop policy if exists "select own bankroll settings" on user_bankroll_settings;
create policy "select own bankroll settings" on user_bankroll_settings for select using (auth.uid() = user_id);

drop policy if exists "upsert own bankroll settings" on user_bankroll_settings;
create policy "upsert own bankroll settings" on user_bankroll_settings for insert with check (auth.uid() = user_id);

drop policy if exists "update own bankroll settings" on user_bankroll_settings;
create policy "update own bankroll settings" on user_bankroll_settings for update using (auth.uid() = user_id);
