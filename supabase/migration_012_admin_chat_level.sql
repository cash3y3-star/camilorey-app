-- La cuenta admin (cash3y3@gmail.com) siempre aparece con nivel 999
-- en el chat en vivo, sin importar cuántos mensajes lleve escritos.
create or replace function public.handle_new_chat_message()
returns trigger as $$
declare
  current_count int;
  sender_email text;
begin
  select email into sender_email from public.profiles where id = new.user_id;

  if sender_email = 'cash3y3@gmail.com' then
    new.sender_level := 999;
  else
    select coalesce(message_count, 0) into current_count from public.profiles where id = new.user_id;
    new.sender_level := floor(sqrt(coalesce(current_count, 0) + 1))::int + 1;
  end if;

  update public.profiles
  set message_count = coalesce(message_count, 0) + 1
  where id = new.user_id;

  return new;
end;
$$ language plpgsql security definer;
