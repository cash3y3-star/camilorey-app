-- Suscripción premium manual: el pago pasa por fuera del sitio
-- (link de pago de TipsterPage) — cuando a alguien le llega la
-- confirmación de pago (por correo o Telegram), el admin activa
-- premium a mano desde el panel Admin, escribiendo el correo de esa
-- persona. premium_until es la fecha hasta la que vale — null o
-- vencida = plan gratuito.
alter table profiles add column if not exists premium_until timestamptz;
