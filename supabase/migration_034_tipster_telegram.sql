-- Link al canal de Telegram de CADA tipster (pedido 2026-07-27) — se
-- muestra en su perfil público para que la gente se una directo al
-- canal de ese tipster en particular, no uno solo compartido.
alter table profiles add column if not exists telegram_url text;

update profiles set telegram_url = 'https://t.me/+ks43cgR-6wljNmZh' where email ilike 'cash3y3@gmail.com';
update profiles set telegram_url = 'https://t.me/+KtePC9Bh3P8zY2Zh' where email ilike 'josuahola28@gmail.com';
update profiles set telegram_url = 'https://t.me/+Qg8V8VAkWs0yM2Ix' where email ilike 'cristianalbornoz413@gmail.com';
