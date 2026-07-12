-- Chat en vivo por partido. match_source_id usa el id real del sitio
-- (matches.source_id), no nuestro id interno, porque es lo que ya
-- tiene disponible el frontend sin consultas extra.
create table if not exists chat_messages (
  id              bigserial primary key,
  match_source_id bigint not null,
  user_id         uuid references auth.users(id) on delete set null,
  user_name       text,
  user_avatar     text,
  message         text not null constraint message_length check (char_length(message) <= 300),
  created_at      timestamptz default now()
);

create index if not exists idx_chat_messages_match on chat_messages(match_source_id, created_at);

alter table chat_messages enable row level security;

-- Cualquiera puede leer el chat (no hace falta estar logueado para
-- verlo, solo para escribir).
drop policy if exists "select chat" on chat_messages;
create policy "select chat" on chat_messages for select using (true);

-- Solo se puede insertar un mensaje a nombre de uno mismo, y hay que
-- estar autenticado.
drop policy if exists "insert own chat" on chat_messages;
create policy "insert own chat" on chat_messages
  for insert
  with check (auth.uid() = user_id);

-- Necesario para que Supabase Realtime mande los mensajes nuevos por
-- websocket sin que el navegador tenga que estar refrescando.
alter publication supabase_realtime add table chat_messages;
