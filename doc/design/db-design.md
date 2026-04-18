# DB 設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [Supabase設計](./supabase-design.md)
- [API設計](./api-design.md)
- [セキュリティ設計](./security-design.md)

---

## 1. 前提・方針

- Supabase PostgreSQL（無料版）を採用
- 認証ユーザーは `auth.users`（Supabase 管理、カスタム不可）
- アプリケーション固有テーブルは `public` スキーマに作成
- UUID 主キー（`uuid_generate_v4()` または `gen_random_uuid()`）
- RLS は全テーブルで有効化（RLS ポリシーは [supabase-design.md](./supabase-design.md) 参照）
- マイグレーションは Supabase Migrations (`supabase/migrations/*.sql`) で管理

---

## 2. ER 図

```
┌──────────────────────┐
│  auth.users          │  (Supabase管理)
│  - id (uuid, PK)     │
│  - email             │
│  ...                 │
└──────┬───────────────┘
       │ 1
       │
       │ N
┌──────▼───────────────────┐
│  public.chat_sessions    │
│  - id (uuid, PK)         │
│  - user_id (uuid, FK→auth.users.id)
│  - title (text)          │
│  - created_at            │
│  - last_message_at       │
│  - message_count (int)   │
└──────┬───────────────────┘
       │ 1
       │
       │ N
┌──────▼─────────────────────────┐
│  public.chat_messages          │
│  - id (uuid, PK)               │
│  - session_id (uuid, FK→chat_sessions)
│  - user_id (uuid, FK→auth.users) ← 冗長保持（RLS高速化）
│  - role (text: user/assistant) │
│  - content (text)              │
│  - created_at                  │
└──────┬─────────────────────────┘
       │ 1
       │ 0..1（assistantメッセージのみ）
       │
┌──────▼─────────────────────────┐
│  public.specialist_traces      │
│  - id (uuid, PK)               │
│  - message_id (uuid, FK→chat_messages)
│  - session_id (uuid, FK→chat_sessions) ← 冗長（RLS高速化）
│  - user_id (uuid, FK→auth.users)       ← 冗長（RLS高速化）
│  - agent_name (text)           │
│  - status (text)               │
│  - summary (text)              │
│  - tool_calls (jsonb)          │
│  - latency_ms (int)            │
│  - created_at                  │
└────────────────────────────────┘

┌────────────────────────────────┐
│  public.keepalive_log          │ (RLSは service_role 以外全拒否)
│  - id (bigserial, PK)          │
│  - pinged_at (timestamptz)     │
└────────────────────────────────┘
```

---

## 3. テーブル定義

### 3.1 chat_sessions

ユーザーごとのチャットセッション（会話スレッド）。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | セッションID |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | 所有ユーザー |
| `title` | `text` | NOT NULL, default `'新しい会話'` | 表示用タイトル |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | 作成日時 |
| `last_message_at` | `timestamptz` | NOT NULL, default `now()` | 最終メッセージ日時（一覧ソート用） |
| `message_count` | `int` | NOT NULL, default `0` | メッセージ件数（トリガで更新） |

```sql
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新しい会話',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0
);
```

**インデックス**:
```sql
create index idx_chat_sessions_user_last on public.chat_sessions (user_id, last_message_at desc);
```

---

### 3.2 chat_messages

ユーザーとアシスタントのメッセージ。削除不可（要件 3.2）。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | メッセージID |
| `session_id` | `uuid` | NOT NULL, FK → `chat_sessions(id)` ON DELETE CASCADE | 所属セッション |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | 所有ユーザー（冗長） |
| `role` | `text` | NOT NULL, CHECK (`role in ('user','assistant','system')`) | 役割 |
| `content` | `text` | NOT NULL | 本文 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | 作成日時 |
| `client_nonce` | `text` | NULL | リクエスト冪等キー（ユーザー送信分のみ） |

```sql
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now(),
  client_nonce text
);
```

**インデックス**:
```sql
-- セッション内の時系列取得（最頻出クエリ）
create index idx_chat_messages_session_created
  on public.chat_messages (session_id, created_at);

-- 直近 N 件取得の降順クエリ用（同じインデックスが使える）
-- （PostgreSQL はインデックスを逆順に走査できる）

-- 冪等性チェック用の部分ユニーク
create unique index uq_chat_messages_user_nonce
  on public.chat_messages (user_id, client_nonce)
  where client_nonce is not null;
```

**クエリパターン**:
```sql
-- 直近 N 件取得（送信時）
select id, role, content, created_at
from public.chat_messages
where session_id = $1
order by created_at desc
limit 20;
-- → クライアント側で reverse

-- 全件取得（初期表示時、上限200）
select id, role, content, created_at
from public.chat_messages
where session_id = $1
order by created_at asc
limit 200;
```

---

### 3.3 specialist_traces

assistant メッセージに紐づく専門家の実行トレース。デバッグ・監査・Phase 2 の可視化で使用。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | トレースID |
| `message_id` | `uuid` | NOT NULL, FK → `chat_messages(id)` ON DELETE CASCADE | 紐づく assistant メッセージ |
| `session_id` | `uuid` | NOT NULL, FK → `chat_sessions(id)` ON DELETE CASCADE | 冗長（RLS用） |
| `user_id` | `uuid` | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | 冗長（RLS用） |
| `agent_name` | `text` | NOT NULL | エージェント識別子 (`seo-specialist` 等) |
| `status` | `text` | NOT NULL, CHECK (`status in ('ok','timeout','error','skipped')`) | ステータス |
| `summary` | `text` | NULL | 専門家の中間回答要約 |
| `tool_calls` | `jsonb` | NOT NULL, default `'[]'::jsonb` | `[{tool, input, output, ms, ok}]` |
| `latency_ms` | `int` | NULL | 実行時間 |
| `usage` | `jsonb` | NULL | `{input_tokens, output_tokens, cache_read, cache_creation}` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | 作成日時 |

```sql
create table public.specialist_traces (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_name text not null,
  status text not null check (status in ('ok','timeout','error','skipped')),
  summary text,
  tool_calls jsonb not null default '[]'::jsonb,
  latency_ms int,
  usage jsonb,
  created_at timestamptz not null default now()
);

create index idx_specialist_traces_message on public.specialist_traces (message_id);
create index idx_specialist_traces_user_created on public.specialist_traces (user_id, created_at desc);
```

---

### 3.4 keepalive_log

Supabase 無料版フリーズ防止用（要件 4.3）。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| `id` | `bigserial` | PK | 自動連番 |
| `pinged_at` | `timestamptz` | NOT NULL, default `now()` | 実行日時 |
| `source` | `text` | NOT NULL, default `'github-actions'` | 実行元識別 |

```sql
create table public.keepalive_log (
  id bigserial primary key,
  pinged_at timestamptz not null default now(),
  source text not null default 'github-actions'
);
```

- RLS は有効化し、**一般ユーザーからは一切読み書き不可**とする
- GitHub Actions から `SUPABASE_SERVICE_ROLE_KEY` で直接 INSERT する
- 古いレコードは定期削除せず保持（サイズは微小）

詳細な keep-alive 戦略は [infra-design.md](./infra-design.md) 参照。

---

## 4. トリガ・関数

### 4.1 chat_sessions の last_message_at / message_count 更新

```sql
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
```

### 4.2 初回メッセージから自動タイトル生成（任意）

Phase 1 では Cloud 側では実装せず、サーバー側で `INSERT` 前にタイトル未設定なら先頭30文字を流用する運用に留める（シンプル優先）。

---

## 5. インデックス戦略

| テーブル | インデックス | 理由 | クエリ例 |
|---|---|---|---|
| `chat_sessions` | `(user_id, last_message_at desc)` | 自分のセッション一覧を最新順に表示 | `/api/sessions` |
| `chat_messages` | `(session_id, created_at)` | セッション内メッセージ取得（昇順・降順両用） | 全履歴取得・直近N件 |
| `chat_messages` | `(user_id, client_nonce) WHERE client_nonce IS NOT NULL` | 冪等チェック | 送信時の重複検出 |
| `specialist_traces` | `(message_id)` | 1メッセージのトレース取得 | assistant 表示時 |
| `specialist_traces` | `(user_id, created_at desc)` | 将来の個人別トレース一覧 | Phase 2 |

- 主キーには自動的に UNIQUE インデックスが付くので FK 単独のインデックスは基本不要
- ただし `chat_messages.session_id` 単独参照は複合インデックスでカバーされるため追加不要

---

## 6. データ量試算

| テーブル | 1日1ユーザーあたり | 6ユーザー × 1年 |
|---|---|---|
| `chat_sessions` | ~5行 | ~10,000行 |
| `chat_messages` | ~100行 | ~220,000行 |
| `specialist_traces` | ~200行 | ~440,000行 |
| `keepalive_log` | 1行 | 365行 |

Supabase 無料版 500MB DB 上限に対して、十分に余裕がある。

---

## 7. マイグレーション戦略

### 7.1 ファイル配置
```
supabase/
├── config.toml
└── migrations/
    ├── 20260501000000_init_schema.sql
    ├── 20260502000000_rls_policies.sql
    ├── 20260503000000_triggers.sql
    └── ...
```

### 7.2 命名規則
- タイムスタンプ `YYYYMMDDHHMMSS` + 内容の英小文字スネークケース
- 1マイグレーション = 1論理変更（複数テーブル追加は同ファイルで可）

### 7.3 適用
- 開発: `supabase db reset` / `supabase migration up`
- 本番: Supabase ダッシュボードから SQL 実行 or `supabase db push`
- CI/CD からの自動適用は Phase 1 では行わない（手動適用）

### 7.4 ロールバック
- マイグレーションファイル内に `-- DOWN` コメントを残し、必要に応じて逆SQLを実行
- Supabase はマイグレーションの自動ロールバックを提供しないため、バックアップからの復元を基本とする

---

## 8. バックアップ

- Supabase 無料版は自動バックアップなし
- Phase 1 では手動エクスポート（`pg_dump` 相当）を月1回運用者が実施
- データ消失リスクは運用者に事前通知（要件外の明示）

---

## 9. 未決定事項

- `specialist_traces` を assistant メッセージと同一トランザクションで書くか、後追いで書くか（レスポンス速度 vs. 一貫性のトレードオフ）
- `chat_sessions.title` の自動更新タイミング（初回 user メッセージ時 vs. 初回 assistant メッセージ時）
- 古いメッセージのアーカイブ方針（Phase 1 では不要、1年後に再検討）
- `client_nonce` の TTL（長期間のユニーク制約を残してもよいか、定期 GC の要否）
