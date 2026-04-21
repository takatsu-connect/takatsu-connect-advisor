-- Migration: Triggers and helper functions

-- ---------------------------------------------------------------------------
-- touch_chat_session()
-- On new chat_messages insert, update the parent session's last_message_at
-- and increment message_count. Runs as SECURITY DEFINER to bypass RLS on
-- public.chat_sessions (user already owns the row, verified by chat_messages
-- RLS INSERT policy).
-- ---------------------------------------------------------------------------
create or replace function public.touch_chat_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
     set last_message_at = new.created_at,
         message_count = message_count + 1
   where id = new.session_id;
  return new;
end;
$$;

create trigger trg_touch_chat_session
  after insert on public.chat_messages
  for each row execute function public.touch_chat_session();

-- DOWN (manual rollback):
-- drop trigger if exists trg_touch_chat_session on public.chat_messages;
-- drop function if exists public.touch_chat_session();
