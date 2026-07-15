-- ============================================================
-- CAMILOREY — esquema de base de datos (Supabase / Postgres)
-- ============================================================

create table if not exists players (
  id           bigint primary key,          -- id del jugador en tt.league-pro.com
  name         text not null,
  rating       numeric,
  league_range text,                        -- ej. "800-900"
  updated_at   timestamptz default now()
);

create table if not exists tournaments (
  id           bigint primary key,          -- id del torneo en tt.league-pro.com
  name         text,
  league_range text,
  scheduled_at timestamptz,
  jornada      text,                        -- "J1","Finales J1","J2","J3","J4","J5"
  status       text default 'scheduled',    -- scheduled | live | finished
  winner_id    bigint references players(id),
  created_at   timestamptz default now()
);

create table if not exists matches (
  id            bigserial primary key,
  tournament_id bigint references tournaments(id),
  player_a_id   bigint references players(id),
  player_b_id   bigint references players(id),
  scheduled_at  timestamptz,
  status        text default 'scheduled',   -- scheduled | live | finished
  sets_a        int,
  sets_b        int,
  winner_id     bigint references players(id),
  raw_data      jsonb,                      -- respaldo del payload original
  created_at    timestamptz default now()
);

create table if not exists picks (
  id            bigserial primary key,
  match_id      bigint references matches(id),
  market        text,                       -- ej. "Más de 2.5 sets", "Ganador"
  direction     text,                       -- "mas" | "menos" | null
  line          numeric,
  confidence    numeric,                    -- 0-100
  factors       jsonb,                      -- desglose: h2h, racha, rating_diff...
  featured      boolean default false,
  published     boolean not null default true, -- false = confianza < piso (60), no se muestra en público, solo en "Descartados" del admin
  result        text,                       -- 'pending' | 'hit' | 'miss'
  created_at    timestamptz default now()
);

create table if not exists bankroll_log (
  id         bigserial primary key,
  pick_id    bigint references picks(id),
  units      numeric,
  balance    numeric,
  created_at timestamptz default now()
);

-- Índices útiles para las consultas del frontend
create index if not exists idx_matches_scheduled on matches(scheduled_at);
create index if not exists idx_picks_match on picks(match_id);
create index if not exists idx_tournaments_scheduled on tournaments(scheduled_at);
