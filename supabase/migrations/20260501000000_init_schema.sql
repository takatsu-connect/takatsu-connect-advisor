-- Migration: Initial schema for takatsu-connect-advisor
-- Creates: chat_sessions, chat_messages, specialist_traces, keepalive_log

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新しい会話',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0
);

create index idx_chat_sessions_user_last
  on public.chat_sessions (user_id, last_message_at desc);

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now(),
  client_nonce text
);

-- Session-scoped time-ordered queries (main access pattern)
create index idx_chat_messages_session_created
  on public.chat_messages (session_id, created_at);

-- Idempotency check for client-submitted messages
create unique index uq_chat_messages_user_nonce
  on public.chat_messages (user_id, client_nonce)
  where client_nonce is not null;

-- ---------------------------------------------------------------------------
-- specialist_traces
-- ---------------------------------------------------------------------------
create table public.specialist_traces (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_name text not null,
  status text not null check (status in ('ok', 'timeout', 'error', 'skipped')),
  summary text,
  tool_calls jsonb not null default '[]'::jsonb,
  latency_ms int,
  usage jsonb,
  created_at timestamptz not null default now()
);

create index idx_specialist_traces_message
  on public.specialist_traces (message_id);

create index idx_specialist_traces_user_created
  on public.specialist_traces (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- keepalive_log
-- ---------------------------------------------------------------------------
create table public.keepalive_log (
  id bigserial primary key,
  pinged_at timestamptz not null default now(),
  source text not null default 'github-actions'
);

-- DOWN (manual rollback):
-- drop table if exists public.keepalive_log;
-- drop table if exists public.specialist_traces;
-- drop table if exists public.chat_messages;
-- drop table if exists public.chat_sessions;
