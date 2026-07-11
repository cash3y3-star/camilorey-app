-- El rating que trae tt.league-pro.com viene con decimales (ej. 472.4,
-- 350.39) — la columna estaba como int y el insert fallaba en cada
-- corrida del sync ("invalid input syntax for type integer").

alter table players
  alter column rating type numeric using rating::numeric;
