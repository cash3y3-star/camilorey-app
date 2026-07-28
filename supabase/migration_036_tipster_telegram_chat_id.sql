-- Distinto de telegram_url (el link de invitación que ve la gente para
-- UNIRSE al canal): esto es el chat_id numérico que el bot necesita
-- para PUBLICAR ahí cuando ese tipster destaca un pick (ver
-- lib/telegram.js y pages/api/admin-tipster-pick.js). Requiere que el
-- bot sea administrador de ese canal — el chat_id se consigue posteando
-- algo en el canal y mirando https://api.telegram.org/bot<TOKEN>/getUpdates.
alter table profiles add column if not exists telegram_chat_id text;
