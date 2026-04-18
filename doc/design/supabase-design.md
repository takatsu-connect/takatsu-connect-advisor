# Supabase 設計書（Auth / RLS / クライアント）

## 関連ドキュメント

- [設計概要](./overview.md)
- [DB設計](./db-design.md)
- [セキュリティ設計](./security-design.md)
- [API設計](./api-design.md)
- [アプリ構成](./app-architecture.md)
- [インフラ設計](./infra-design.md)

---

## 1. Auth 設定

### 1.1 ログイン方式

| 方式             | 用途                                         |
| ---------------- | -------------------------------------------- |
| Email + Password | 運営メンバーの主たる認証方法                 |
| Google OAuth     | 利便性のため提供（招待済みアドレスのみ許可） |

### 1.2 招待制の運用方針

新規ユーザー登録は**Supabase Dashboard から管理者が手動招待**する運用とする（要件 3.1）。

- Supabase Auth 設定: **Sign ups を Disable** にする（サインアップ API 経由の登録を不可にする）
- 新規メンバー追加時: Dashboard → Authentication → Users → Invite user で招待メール送信
- Google OAuth: メールアドレスが `auth.users` に既存であれば連携（新規は拒否）
  - `before_user_created` Hook / Edge Function でホワイトリスト制御も可能だが、Phase 1 では Dashboard の Sign ups OFF で対応（招待されたアドレス = `auth.users` に既存 = OAuth 連携可能）

### 1.3 Supabase Dashboard 設定値

| 項目                            | 設定                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Site URL                        | `https://<vercel-domain>`                                                      |
| Additional Redirect URLs        | `https://<vercel-domain>/auth/callback`, `http://localhost:3000/auth/callback` |
| Enable Email Provider           | ✅                                                                             |
| Confirm Email                   | ✅（招待メールで verify）                                                      |
| Enable Google Provider          | ✅                                                                             |
| Google OAuth Client ID / Secret | Google Cloud Console で作成したもの                                            |
| Sign ups                        | **Disabled**                                                                   |
| Session timeout                 | デフォルト (1時間 access / 7日 refresh)                                        |
| JWT expiry                      | デフォルト (3600秒)                                                            |

---

## 2. Supabase クライアント構成

Next.js (App Router) で Supabase を使うには用途ごとに異なるクライアントを用意する。
`@supabase/ssr` を採用。

| クライアント              | 使用場所                         | キー                            | Cookie                                         |
| ------------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------- |
| Browser Client            | Client Component                 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `document.cookie`                              |
| Server Client (RSC/Route) | Server Component / Route Handler | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `next/headers` の cookies()                    |
| Middleware Client         | `middleware.ts`                  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NextRequest.cookies` / `NextResponse.cookies` |
| Admin Client              | サーバー限定（keep-alive 等）    | `SUPABASE_SERVICE_ROLE_KEY`     | なし                                           |

### 2.1 Browser Client（例）

```ts
// src/lib/db/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
export const supabaseBrowser = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
```

### 2.2 Server Client（RSC / Route Handler）

```ts
// src/lib/db/supabase-server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const supabaseServer = () => {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => cookieStore.set({ name, value, ...options }),
        remove: (name, options) => cookieStore.set({ name, value: "", ...options }),
      },
    },
  );
};
```

### 2.3 Middleware Client

```ts
// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => req.cookies.get(name)?.value,
          set: (name, value, options) => {
            res.cookies.set({ name, value, ...options });
          },
          remove: (name, options) => {
            res.cookies.set({ name, value: "", ...options });
          },
        },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return guard(req, res, user);
  } catch (err) {
    console.error("[middleware] supabase error", err);
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = {
  matcher: ["/chat/:path*", "/api/chat/:path*", "/api/sessions/:path*", "/login"],
};
```

**Edge Runtime 制約** (`.claude/rules/nextjs-edge-runtime.md`):

- `@supabase/ssr` は Web Crypto API ベースで Edge 互換
- `jsonwebtoken` / `bcrypt` を middleware で使わない
- catch節では必ず `console.error` を出す

### 2.4 Admin Client（server-only）

```ts
// src/lib/db/supabase-admin.ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
```

- **絶対にクライアントバンドルに混入させない**（`'server-only'` import 必須）
- keepalive スクリプトなど、RLS をバイパスしたい極小ケースで使用

---

## 3. RLS ポリシー

すべてのアプリテーブルで **`enable row level security`** を有効化する。
以下、テーブルごとのポリシー。

### 3.1 chat_sessions

```sql
alter table public.chat_sessions enable row level security;

-- SELECT: 自分のセッションのみ
create policy chat_sessions_select_own
  on public.chat_sessions for select
  using (auth.uid() = user_id);

-- INSERT: user_id が自分であること
create policy chat_sessions_insert_own
  on public.chat_sessions for insert
  with check (auth.uid() = user_id);

-- UPDATE: 自分のセッションのみ（タイトル変更等）
create policy chat_sessions_update_own
  on public.chat_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: 要件上、履歴削除不可 → ポリシー作成しない（= 拒否）
```

### 3.2 chat_messages

```sql
alter table public.chat_messages enable row level security;

-- SELECT: 自分のメッセージのみ（user_id 冗長で高速化）
create policy chat_messages_select_own
  on public.chat_messages for select
  using (auth.uid() = user_id);

-- INSERT: user_id が自分、かつ session が自分の所有
create policy chat_messages_insert_own
  on public.chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_sessions s
       where s.id = session_id and s.user_id = auth.uid()
    )
  );

-- UPDATE / DELETE: 不可（履歴は不変）
```

### 3.3 specialist_traces

```sql
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
```

### 3.4 keepalive_log

```sql
alter table public.keepalive_log enable row level security;
-- ポリシーを作成しない → 一般ユーザーは完全に不可視
-- service_role はRLSをバイパスするため、GitHub Actions から INSERT 可能
```

---

## 4. サーバーサイドでの書き込み方針

API Route (`/api/chat` 等) から chat_messages / specialist_traces に書き込む際:

- **基本**: Server Client（anon key + ユーザーのCookie）を使う
  - RLS が適用され、`auth.uid()` が自動解決される
  - 不正アクセスはRLS層で遮断される多層防御

- **例外**: keepalive_log や将来の管理機能のみ Admin Client（service_role）を使う
  - `RLS をバイパスする強力な鍵` なのでサーバー内に閉じ込める

---

## 5. セッション更新のタイミング

### 5.1 Cookie 更新

`@supabase/ssr` は `getUser()` 呼び出し時に refresh token で自動更新し、新しい cookie を `set` してくれる。
middleware 内で `getUser()` を呼ぶことで、全リクエストで自動的に cookie が延長される。

### 5.2 長時間ストリーム中のトークン失効

- `/api/chat` のストリーム中にセッションが失効する可能性は低い（maxDuration=60秒）
- 冒頭で `getUser()` を呼び、以降はストリーム内で再検証しない
- Orchestrator 完了後の `insert` 時に失効していれば RLS で弾かれる（エッジケース）

---

## 6. Google OAuth フロー

```
1. /login → GoogleLoginButton クリック
2. supabaseBrowser().auth.signInWithOAuth({
     provider: 'google',
     options: { redirectTo: `${origin}/auth/callback?next=/chat` }
   })
3. Google 認証画面
4. /auth/callback?code=xxx に戻る
5. Route Handler で exchangeCodeForSession(code) 実行
6. セッション Cookie がセットされる
7. /chat にリダイレクト
```

`/auth/callback/route.ts` の例:

```ts
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/chat";
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", url));

  const supabase = supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchange failed", error);
    return NextResponse.redirect(new URL("/login?error=exchange_failed", url));
  }
  return NextResponse.redirect(new URL(next, url));
}
```

---

## 7. keep-alive 実装メモ

詳細は [infra-design.md](./infra-design.md) の CI/CD セクション参照。

GitHub Actions から:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/keepalive_log" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"source":"github-actions"}'
```

---

## 8. Supabase Local Development

開発時は Supabase CLI でローカル Supabase を起動する（推奨）。

```
pnpm supabase start      # docker compose でローカル PG + GoTrue 起動
pnpm supabase db reset   # migrations/ を全適用
```

- `.env.local` にローカル用の URL / anon key を設定
- Google OAuth はローカルでは動作しないため、メール+PW でテストする（テストユーザーは `supabase` CLI で作成）

---

## 9. 未決定事項

- `/auth/callback` で OAuth エラー時の表示（再ログイン誘導 vs. 管理者連絡）
- 招待メールのテンプレートカスタマイズ（Supabase のテンプレート編集）
- Google Workspace のドメイン制限（`hd` パラメータ）を OAuth に付けるか
- `last_sign_in_at` を用いた休眠ユーザー検出の要否
