-- El vigilante de notificaciones también avisa cuando arranca el
-- partido (no solo cuando cierra un set o termina) — esta columna
-- evita mandar ese aviso más de una vez por partido.
alter table matches add column if not exists notified_started boolean not null default false;
