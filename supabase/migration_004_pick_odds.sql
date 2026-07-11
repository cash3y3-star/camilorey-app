-- Cuota real (de Rushbet, vía la API pública de Kambi) para el
-- jugador que el pick favorece. Puede quedar null si no encontramos
-- el partido correspondiente en el feed de Rushbet.
alter table picks add column if not exists odds numeric;
