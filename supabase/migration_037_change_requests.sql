-- Buzón de "Solicitudes de cambios" (pedido 2026-07-28): los socios
-- admin dejan pedidos de mejoras acá en vez de mandarlos por chat, y
-- cada solicitud arma su propio prompt técnico listo para pegar en
-- Claude Code — la ejecución de los cambios sigue siendo manual/por
-- terminal, esto solo organiza el pedido y ahorra la redacción.
create table if not exists change_requests (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null,
  priority text not null default 'media' check (priority in ('baja', 'media', 'alta')),
  status text not null default 'pendiente' check (status in ('pendiente', 'en_progreso', 'hecha', 'descartada')),
  created_by uuid not null references auth.users(id),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists change_requests_created_at_idx on change_requests (created_at desc);

alter table change_requests enable row level security;

-- Sin políticas de cliente a propósito (mismo patrón que
-- live_streams/tipster_pick): la tabla queda cerrada a cualquiera con
-- la clave anon, y TODO el acceso pasa por
-- /api/admin-change-requests.js con service_role, que verifica server-
-- side que quien pide/crea/edita sea admin (checkAdmin, lib/adminAuth.js)
-- — el mismo mecanismo ya soporta varias cuentas admin, no solo el
-- superAdmin, así que cualquier socio con acceso al panel ya puede
-- usar este buzón sin tocar nada más.
