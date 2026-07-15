-- Insignia de usuario premium/exclusivo en el chat en vivo. Igual que
-- sender_level, se calcula server-side en el mismo trigger de
-- inserción (no en el cliente) para que no se pueda falsificar desde
-- el navegador. El admin también la lleva, igual que ya pasa con el
-- nivel 999.
alter table chat_messages add column if not exists sender_is_premium boolean not null default false;

create or replace function public.handle_new_chat_message()
returns trigger as $$
declare
  current_count int;
  sender_email text;
  sender_premium_until timestamptz;
begin
  select email, message_count, premium_until
    into sender_email, current_count, sender_premium_until
    from public.profiles where id = new.user_id;

  if sender_email = 'cash3y3@gmail.com' then
    new.sender_level := 999;
  else
    new.sender_level := floor(sqrt(coalesce(current_count, 0) + 1))::int + 1;
  end if;

  new.sender_is_premium := sender_email = 'cash3y3@gmail.com'
    or (sender_premium_until is not null and sender_premium_until > now());

  update public.profiles
  set message_count = coalesce(message_count, 0) + 1
  where id = new.user_id;

  return new;
end;
$$ language plpgsql security definer;
