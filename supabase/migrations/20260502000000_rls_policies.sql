-- Migration: Row Level Security policies
-- Applies to all application tables. keepalive_log intentionally has no policy.

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
alter table public.chat_sessions enable row level security;

create policy chat_sessions_select_own
  on public.chat_sessions for select
  using (auth.uid() = user_id);

create policy chat_sessions_insert_own
  on public.chat_sessions for insert
  with check (auth.uid() = user_id);

create policy chat_sessions_update_own
  on public.chat_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Delete intentionally disallowed: history is immutable per requirement 3.2

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
alter table public.chat_messages enable row level security;

create policy chat_messages_select_own
  on public.chat_messages for select
  using (auth.uid() = user_id);

create policy chat_messages_insert_own
  on public.chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_sessions s
       where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- Update / Delete intentionally disallowed: messages are immutable

-- ---------------------------------------------------------------------------
-- specialist_traces
-- ---------------------------------------------------------------------------
alter table public.specialist_traces enable row level security;

create policy specialist_traces_select_own
  on public.specialist_traces for select
  using (auth.uid() = user_id);

create policy specialist_traces_insert_own
  on public.specialist_traces for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_messages m
       where m.id = message_id and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- keepalive_log
-- ---------------------------------------------------------------------------
alter table public.keepalive_log enable row level security;
-- No policies created: regular users cannot read/write.
-- service_role bypasses RLS, so GitHub Actions can INSERT via service role key.

-- DOWN (manual rollback):
-- drop policy if exists chat_sessions_select_own on public.chat_sessions;
-- drop policy if exists chat_sessions_insert_own on public.chat_sessions;
-- drop policy if exists chat_sessions_update_own on public.chat_sessions;
-- drop policy if exists chat_messages_select_own on public.chat_messages;
-- drop policy if exists chat_messages_insert_own on public.chat_messages;
-- drop policy if exists specialist_traces_select_own on public.specialist_traces;
-- drop policy if exists specialist_traces_insert_own on public.specialist_traces;
-- alter table public.chat_sessions disable row level security;
-- alter table public.chat_messages disable row level security;
-- alter table public.specialist_traces disable row level security;
-- alter table public.keepalive_log disable row level security;
