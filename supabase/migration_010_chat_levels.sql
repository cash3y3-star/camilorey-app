-- Sistema de nivel por actividad en el chat (estilo AiScore): cada
-- mensaje suma al contador de la persona, y el nivel sale de ese
-- contador con una curva de raíz cuadrada (cada nivel siguiente pide
-- más mensajes que el anterior, no es lineal).
alter table profiles add column if not exists message_count int not null default 0;
alter table chat_messages add column if not exists sender_level int;

-- Se calcula el nivel ANTES de sumar el mensaje actual (o sea, con
-- cuántos mensajes tenía la persona antes de este), y de una vez
-- suma el contador en profiles. Todo en un solo trigger para que no
-- haya carrera entre leer y escribir el contador.
create or replace function public.handle_new_chat_message()
returns trigger as $$
declare
  current_count int;
begin
  select coalesce(message_count, 0) into current_count from public.profiles where id = new.user_id;
  new.sender_level := floor(sqrt(coalesce(current_count, 0) + 1))::int + 1;

  update public.profiles
  set message_count = coalesce(message_count, 0) + 1
  where id = new.user_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_chat_message_insert on chat_messages;
create trigger on_chat_message_insert
  before insert on chat_messages
  for each row execute procedure public.handle_new_chat_message();
