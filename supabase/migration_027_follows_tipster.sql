-- CAMILOREY — seguir/dejar de seguir al tipster (CAMILOREY) desde su
-- tarjeta de perfil en Inicio. Sin default a propósito: NULL significa
-- "nunca lo tocó a mano", y en ese caso el front decide solo según el
-- plan (Exclusivo/Premium/admin arrancan siguiendo, gratis no) — ver
-- pages/index.js. Una vez que alguien lo toca a mano, esa elección
-- manda siempre, sin importar si después cambia de plan.

alter table profiles add column if not exists follows_tipster boolean;
