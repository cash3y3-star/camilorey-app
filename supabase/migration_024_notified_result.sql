-- El aviso de "partido terminado" a veces se manda antes de que
-- sync.js resuelva el pick (hit/miss) — dos procesos independientes
-- con su propio horario. notified_result separa "ya avisamos que
-- terminó" (notified_finished) de "ya avisamos si acertó o no", para
-- que check-follows.js pueda mandar un aviso de seguimiento en cuanto
-- el resultado esté listo, sin depender de que coincida justo en el
-- mismo momento en que detecta el fin del partido.
alter table matches add column if not exists notified_result boolean not null default false;
