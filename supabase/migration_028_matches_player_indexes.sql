-- CAMILOREY — índices en matches.player_a_id / player_b_id / tournament_id
--
-- matches nunca tuvo índice en estas columnas (solo scheduled_at y
-- status) — así que TODA consulta que filtra por jugador o por torneo
-- (forma reciente, H2H, tablas de grupo en vivo, todas ya optimizadas
-- del lado de la app para pedir menos y en menos viajes) igual tenía
-- que escanear la tabla ENTERA de partidos cada vez, porque Postgres
-- no tenía forma de ir directo. Con miles de partidos acumulados, esa
-- era la causa real de fondo del 504 GATEWAY_TIMEOUT en producción —
-- agrupar las consultas ayudó, pero cada consulta individual seguía
-- siendo lenta por el mismo motivo.
--
-- CONCURRENTLY (no un CREATE INDEX normal): la tabla sigue siendo
-- escrita todo el tiempo (sync.js cada ~60s + el sitio bajo carga
-- intentando las mismas consultas lentas) — un CREATE INDEX normal
-- toma un lock exclusivo y se queda esperando turno, por eso el SQL
-- Editor tiraba "Connection terminated due to connection timeout".
-- CONCURRENTLY no bloquea lecturas/escrituras mientras construye.
--
-- OJO al correrlo: CONCURRENTLY no puede ir dentro de una transacción
-- — correr estas 3 líneas UNA POR UNA (seleccionar solo esa línea y
-- ejecutar), no las tres juntas de una.

create index concurrently if not exists idx_matches_player_a on matches(player_a_id);

create index concurrently if not exists idx_matches_player_b on matches(player_b_id);

create index concurrently if not exists idx_matches_tournament on matches(tournament_id);
