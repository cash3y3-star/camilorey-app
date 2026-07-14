-- Analítica básica y propia (no Google Analytics, nada de terceros) —
-- solo cuenta QUÉ se usa en el sitio: qué vista se abre, qué acciones
-- clave se tocan. Sin IP, sin fingerprinting, sin cookies de
-- rastreo — si hay sesión se guarda el user_id (para poder cruzar
-- después con quién es quién), si no, queda anónimo.
create table if not exists analytics_events (
  id         bigint generated always as identity primary key,
  event_name text not null,
  view       text,
  user_id    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx on analytics_events (created_at desc);
create index if not exists analytics_events_event_name_idx on analytics_events (event_name);

alter table analytics_events enable row level security;

-- Cualquiera (con o sin sesión) puede INSERTAR su propio evento, pero
-- nadie puede LEER la tabla desde el navegador — el resumen para el
-- admin sale de /api/analytics-summary, con el mismo login
-- verificado en el servidor que ya usan /api/error-log y
-- /api/model-stats (no una política de SELECT abierta).
drop policy if exists "anyone can log an event" on analytics_events;
create policy "anyone can log an event" on analytics_events for insert with check (true);

-- Housekeeping opcional: si en algún momento la tabla crece mucho,
-- borrar eventos de hace más de ~90 días desde el SQL Editor:
--   delete from analytics_events where created_at < now() - interval '90 days';
