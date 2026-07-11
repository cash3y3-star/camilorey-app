-- Marcador punto a punto de cada set (no solo cuántos sets ganó cada
-- quien). Se llena de forma oportunista: /api/live-match lo guarda
-- cada vez que alguien tiene ese partido abierto mientras está en
-- vivo — no hay forma de recuperarlo retroactivo para partidos que
-- ya terminaron sin que nadie los haya visto en vivo.
alter table matches add column if not exists set_scores jsonb;
