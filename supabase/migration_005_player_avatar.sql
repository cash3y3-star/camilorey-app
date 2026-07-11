-- Foto real del jugador (tt.league-pro.com ya la trae en su propio
-- JSON, ej. /media/players/83/1283.jpg).
alter table players add column if not exists avatar_url text;
