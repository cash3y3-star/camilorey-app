-- Modelo de ML (regresión logística, ver lib/ml-exclusive.js) que
-- decide qué picks entran a Exclusivo dentro de Picks VIP, reentrenado
-- solo en cada corrida de sync.js a partir de los picks ya resueltos.
--
-- ml_confidence: probabilidad (0-100) que calculó el modelo para este
-- pick en el momento en que se generó — se guarda aunque el pick no
-- haya calificado, para poder auditar cómo viene calibrando el modelo.
-- is_exclusive: true/false, decidido UNA VEZ al generar el pick (por
-- el modelo si ya hay suficiente muestra, si no por el criterio viejo
-- confidence>=85 + odds>=1.60) — reemplaza el cálculo repetido de
-- "confidence>=85 && odds>=1.60" que antes vivía duplicado en 5+
-- archivos del sitio.
alter table picks add column if not exists ml_confidence numeric;
alter table picks add column if not exists is_exclusive boolean not null default false;
