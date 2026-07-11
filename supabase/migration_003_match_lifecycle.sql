-- El constraint anterior (unique por tournament_id) solo dejaba
-- guardar UN partido a la vez por torneo: cada vez que cambiaba el
-- "próximo partido sin jugar", se sobreescribía el row anterior y se
-- perdía la trazabilidad para poder resolver ese pick contra el
-- resultado real. Ahora cada partido real del sitio (su propio id)
-- tiene un row estable que persiste desde que se programa hasta que
-- se cierra con resultado.
alter table matches drop constraint if exists matches_tournament_unique;
alter table matches add column if not exists source_id bigint unique;
create index if not exists idx_matches_source on matches(source_id);

-- Para resolver hit/miss sin tener que parsear el texto de "market".
alter table picks add column if not exists predicted_winner_id bigint references players(id);
