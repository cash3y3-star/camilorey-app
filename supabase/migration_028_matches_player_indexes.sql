-- CAMILOREY — índices en matches.player_a_id / player_b_id
--
-- matches nunca tuvo índice en estas dos columnas (solo scheduled_at
-- y status) — así que TODA consulta que filtra por jugador (forma
-- reciente, H2H, tablas de grupo en vivo, todas ya optimizadas del
-- lado de la app para pedir menos y en menos viajes) igual tenía que
-- escanear la tabla ENTERA de partidos cada vez, porque Postgres no
-- tenía forma de ir directo. Con miles de partidos acumulados, esa
-- era la causa real de fondo del 504 GATEWAY_TIMEOUT en producción —
-- agrupar las consultas ayudó, pero cada consulta individual seguía
-- siendo lenta por el mismo motivo.

create index if not exists idx_matches_player_a on matches(player_a_id);
create index if not exists idx_matches_player_b on matches(player_b_id);
