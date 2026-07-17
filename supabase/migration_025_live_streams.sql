-- Transmisiones en vivo de YouTube, una por "mesa" (torneo) — el
-- código (A12, A14, A16...) es el que ya aparece como prefijo en el
-- nombre real del torneo (ej. "A17. League 700-800"), así que basta
-- con guardar código -> id de video de YouTube para poder mostrar el
-- embed correcto en cualquier partido de ese torneo.
--
-- Los streams cambian de video CADA DÍA (no son canales 24/7 fijos),
-- así que esto es una tabla chica que el admin actualiza a mano desde
-- el panel — no algo que se sincronice solo.
create table if not exists live_streams (
  tournament_code text primary key,
  youtube_video_id text not null,
  updated_at timestamptz not null default now()
);

alter table live_streams enable row level security;

-- Lectura pública (cualquiera con o sin sesión ve las transmisiones)
-- — la escritura NO tiene política de cliente a propósito: solo pasa
-- por /api/admin-live-streams.js con la service_role, verificando
-- que quien pide el cambio sea el admin (mismo patrón que
-- send-promo.js).
drop policy if exists "anyone can read live streams" on live_streams;
create policy "anyone can read live streams" on live_streams for select using (true);

-- Datos de hoy (2026-07-17), como referencia inicial — el admin los
-- va a ir reemplazando por los del día siguiente desde el panel.
insert into live_streams (tournament_code, youtube_video_id) values
  ('A12', 'nHts1Ri9uxM'),
  ('A14', 'udzYiWVRhjE'),
  ('A16', 'rRxh8MEBXis'),
  ('A17', 's760qtekk54'),
  ('A18', 'FD1r8nyBBEY')
on conflict (tournament_code) do update set youtube_video_id = excluded.youtube_video_id, updated_at = now();
