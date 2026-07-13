-- Registro de errores de la app (no de los cronjobs — esos ya se
-- notifican solos por cron-job.org/GitHub Actions). Sin RLS de
-- lectura para nadie más que el service_role: solo se lee desde
-- /api/error-log.js, que verifica que quien pregunta sea el admin.
create table if not exists error_log (
  id         bigserial primary key,
  source     text not null,
  message    text not null,
  stack      text,
  context    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_error_log_created on error_log(created_at desc);

alter table error_log enable row level security;
-- Ninguna política = nadie con anon/authenticated puede leer ni
-- escribir directo; solo el service_role (que ignora RLS) desde
-- nuestros propios endpoints.
