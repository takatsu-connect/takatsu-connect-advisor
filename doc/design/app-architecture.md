# アプリ構成 設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [API設計](./api-design.md)
- [フロントエンド設計](./frontend-design.md)
- [エージェントシステム設計](./agent-system-design.md)
- [セキュリティ設計](./security-design.md)
- [インフラ設計](./infra-design.md)

---

## 1. 全体像

Next.js (App Router) による SSR + CSR 混在の SPA 風チャット UI。
Supabase Auth（招待制） による認証を前提に、認証済みユーザーのみがマルチエージェントチャットを利用できる。

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (Client Components)                                       │
│  - ChatWindow, MessageList, Input, ContextProgressBar             │
│  - fetch() でSSEストリーム受信                                      │
└──────────────────────────────────────────────────────────────────┘
                │              ▲
                │ POST /api/chat (SSE)
                ▼              │
┌──────────────────────────────────────────────────────────────────┐
│ Next.js App Router (Vercel, Node.js Runtime)                      │
│  - middleware.ts (Edge)  : 認証チェック＋リダイレクト                 │
│  - (main)/layout.tsx     : サーバー側セッション確認                  │
│  - app/api/chat/route.ts : SSEストリーミング + 3段階パイプライン      │
│  - lib/agents/*          : Classifier / Specialist / Orchestrator │
│  - lib/claude/client.ts  : Anthropic SDK ラッパー (prompt cache)  │
└──────────────────────────────────────────────────────────────────┘
         │                │                       │
         ▼                ▼                       ▼
┌──────────────┐   ┌──────────────┐   ┌────────────────────────────┐
│ Supabase     │   │ Anthropic    │   │ 外部 API                    │
│ - Auth       │   │ Claude API   │   │ - GA Data API              │
│ - chat_*     │   │ (Haiku +     │   │ - Search Console API       │
│ - RLS        │   │  Sonnet)     │   │ - WordPress REST           │
└──────────────┘   └──────────────┘   │ - fetch_webpage (任意URL)   │
                                      └────────────────────────────┘
```

---

## 2. ディレクトリ構造

要件定義書「5. フォルダ構成」および Next.js スペシャリストの助言に基づく。

```
takatsu-connect-advisor/
├── prompts/                         ← src/ の外（非エンジニアが触る領域）
│   ├── agents/                      ← エージェント定義 Markdown
│   │   ├── classifier.md
│   │   ├── orchestrator.md
│   │   ├── seo-specialist.md
│   │   ├── marketing-specialist.md
│   │   ├── data-analyst.md
│   │   ├── content-strategist.md
│   │   └── local-expert.md
│   ├── shared/                      ← include 対象の共通知識
│   │   ├── takatsu-connect.md
│   │   ├── machino-kikakushitsu.md
│   │   └── style-guide.md
│   └── tools/                       ← tool_use 説明テンプレ（任意）
│
├── src/
│   ├── middleware.ts                ← Edge Runtime（@supabase/ssr）
│   │
│   ├── app/
│   │   ├── layout.tsx               ← ルートレイアウト（html/body）
│   │   ├── page.tsx                 ← / → /chat へリダイレクト
│   │   ├── globals.css              ← CSS 変数・リセット
│   │   │
│   │   ├── (auth)/                  ← 未ログイン向けルートグループ
│   │   │   ├── layout.tsx           ← 認証画面用レイアウト
│   │   │   ├── login/
│   │   │   │   └── page.tsx         ← メール+PW / Google OAuth
│   │   │   └── auth/
│   │   │       └── callback/
│   │   │           └── route.ts     ← OAuth コールバック処理
│   │   │
│   │   ├── (main)/                  ← 認証済み向けルートグループ
│   │   │   ├── layout.tsx           ← サーバー側でセッション検証
│   │   │   └── chat/
│   │   │       └── page.tsx         ← チャット画面（Server Component）
│   │   │
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts         ← POST: SSE ストリーミング
│   │       ├── sessions/
│   │       │   └── route.ts         ← セッション一覧（GET）/ 作成（POST）
│   │       └── auth/
│   │           └── signout/
│   │               └── route.ts     ← ログアウト
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx       ← "use client" ルート
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── MessageInput.tsx
│   │   │   ├── ContextProgressBar.tsx
│   │   │   ├── SpecialistTrace.tsx  ← 折りたたみトレース
│   │   │   └── StatusIndicator.tsx  ← 「◯◯専門家に相談中...」
│   │   └── auth/
│   │       ├── LoginForm.tsx
│   │       └── GoogleLoginButton.tsx
│   │
│   ├── hooks/
│   │   ├── useChatStream.ts         ← SSE 受信フック
│   │   └── useContextUsage.ts       ← コンテキスト件数カウンタ
│   │
│   ├── lib/
│   │   ├── agents/
│   │   │   ├── loader.ts            ← prompts/agents/*.md を読み込む
│   │   │   ├── registry.ts          ← エージェント一覧管理（mtimeキャッシュ）
│   │   │   ├── classifier.ts        ← 分類ステップ実行
│   │   │   ├── specialist.ts        ← 単一専門家実行（Promise.race）
│   │   │   ├── orchestrator.ts      ← 統合ステップ実行
│   │   │   ├── pipeline.ts          ← 3段階パイプライン制御
│   │   │   └── types.ts
│   │   ├── tools/
│   │   │   ├── index.ts             ← ツール定義レジストリ
│   │   │   ├── query-ga.ts
│   │   │   ├── query-gsc.ts
│   │   │   ├── fetch-wp-posts.ts
│   │   │   ├── fetch-webpage.ts
│   │   │   └── schemas.ts           ← JSON Schema (input_schema)
│   │   ├── claude/
│   │   │   ├── client.ts            ← Anthropic SDK ラッパー
│   │   │   ├── cache.ts             ← ローカル完全一致キャッシュ
│   │   │   └── stream-sse.ts        ← SSE 変換ヘルパ
│   │   ├── db/
│   │   │   ├── supabase-server.ts   ← サーバー用（cookies）
│   │   │   ├── supabase-browser.ts  ← クライアント用
│   │   │   ├── supabase-admin.ts    ← service_role 用
│   │   │   ├── chat-sessions.ts     ← セッション CRUD
│   │   │   └── chat-messages.ts     ← メッセージ CRUD
│   │   ├── env.ts                   ← 環境変数バリデーション（zod）
│   │   └── logger.ts
│   │
│   ├── styles/
│   │   ├── tokens.css               ← CSS Custom Properties
│   │   └── breakpoints.css          ← メディアクエリ定義
│   │
│   └── types/
│       ├── chat.ts                  ← Message / Session / Trace 型
│       └── agent.ts                 ← AgentDefinition 型
│
├── scripts/
│   └── validate-agents.ts           ← エージェント定義バリデータ
│
├── .github/workflows/
│   ├── ci.yml                       ← lint + typecheck + test
│   └── supabase-keepalive.yml       ← 日次 keep-alive
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── doc/
    ├── requirements.md
    └── design/*.md
```

### 2.1 prompts/ を src/ の外に置く理由
- Next.js スペシャリスト推奨: 非エンジニアでも触れる領域として分離
- `src/` は TypeScript トランスパイル対象で、Markdownを含めたくない
- エージェント定義変更はホットリロード（mtime 差分）で反映させるため、ビルドに組み込まない

---

## 3. ルーティング設計

### 3.1 Phase 1 の URL マップ

| パス | ルートグループ | コンポーネント種別 | 内容 |
|---|---|---|---|
| `/` | - | Server | `/chat` へ redirect |
| `/login` | `(auth)` | Client Form内包 | ログイン画面 |
| `/auth/callback` | `(auth)` | Route Handler | Google OAuth コールバック |
| `/chat` | `(main)` | Server + Client | チャット画面（Phase 1 は単一URL） |
| `/api/chat` | - | Route Handler (POST, SSE) | 3段階パイプライン本体 |
| `/api/sessions` | - | Route Handler | セッション一覧 / 作成 |
| `/api/auth/signout` | - | Route Handler | ログアウト |

### 3.2 Phase 2 での拡張予定
- `/chat/[sessionId]` によるセッション別 URL
- `/chat` ルートで過去セッション一覧をサイドバー表示

### 3.3 ルートグループ分割方針
`(auth)` と `(main)` でレイアウトとガード処理を分離する。
- `(auth)/layout.tsx`: 非ログインユーザー向けの簡潔なレイアウト。ログイン済みなら `/chat` へリダイレクト
- `(main)/layout.tsx`: サーバー側で Supabase セッションを取得し、未ログインなら `/login` へリダイレクト（middleware の二段階ガード）

---

## 4. 認証ガードの二段階構成

Next.js スペシャリストの助言に従い、middleware と layout の二段階でガードする。

### 4.1 middleware.ts (Edge Runtime)
- 全リクエストで実行される第一段階チェック
- `@supabase/ssr` の `createServerClient` でセッションを検証
- 未ログインかつ保護ルート (`/chat/*`, `/api/chat`) の場合 `/login` へリダイレクト
- ログイン済みで `/login` に来たら `/chat` へリダイレクト

**制約事項**（`.claude/rules/nextjs-edge-runtime.md`）:
- `jsonwebtoken` / `bcrypt` / `bcryptjs` 使用禁止（Node.js 依存）
- JWT 検証が必要な場面では `jose` を使う（本プロジェクトは `@supabase/ssr` がセッション検証を行うため直接 jose を使う場面は少ない）
- catch 節では必ず `console.error` を出す（サイレント失敗防止）

### 4.2 (main)/layout.tsx (Node.js Runtime / Server Component)
- 第二段階チェック（middleware で漏れた場合の保険）
- `createServerClient` + cookies で `supabase.auth.getUser()` を呼び、無効なら `redirect('/login')`
- 取得した user 情報を Server Component の props として子に渡す

---

## 5. チャット送信フロー

### 5.1 チャット送信は API Route + SSE で実装する（Server Actions は不使用）

Next.js スペシャリストの助言に従う判断根拠:
- Server Actions はストリーミング応答に向かない（レスポンスは完了まで待つ）
- SSE は `fetch` + `ReadableStream` でパース可能
- `/api/chat/route.ts` に `export const maxDuration = 60` を書ける

### 5.2 送受信の流れ

```
[Client: ChatWindow]
   │ ユーザー入力 → fetch('/api/chat', { method: 'POST', body: ... })
   ▼
[Server: app/api/chat/route.ts]  (maxDuration=60, runtime='nodejs')
   │ 1. 認証確認（Supabase Auth）
   │ 2. セッション取得 or 作成
   │ 3. user message を chat_messages に保存
   │ 4. 直近20件を chat_messages から取得
   │ 5. ReadableStream を返却
   │     ├─ event: status          → "分類中..."
   │     ├─ Classifier (Haiku 4.5) → 呼ぶべき専門家を決定
   │     ├─ event: status          → "SEO専門家、データ分析家に相談中..."
   │     ├─ Specialists (並列)     → Promise.race で 8秒タイムアウト
   │     ├─ event: specialist_result (各専門家完了時)
   │     ├─ event: status          → "統合中..."
   │     ├─ Orchestrator (Sonnet)  → ストリーミングで content イベント配信
   │     ├─ event: content         → 統合回答のチャンク
   │     ├─ DB に assistant message を保存
   │     └─ event: done
   ▼
[Client: useChatStream]
   TextDecoder で parse → UIに反映
```

---

## 6. Server Components / Client Components の境界

### 6.1 Server Components（デフォルト）
- `app/(main)/chat/page.tsx`: 初期ロード時のセッション情報取得＋初期メッセージ取得
- `app/(main)/layout.tsx`: Supabase セッション検証・ユーザー情報取得
- `app/(auth)/layout.tsx`: ログイン済みチェック

### 6.2 Client Components (`"use client"`)
- `ChatWindow.tsx`: チャット全体の state 管理（SSE 受信）
- `MessageList.tsx`: 自動スクロール、メッセージの動的追加
- `MessageInput.tsx`: input 制御、IME対応
- `ContextProgressBar.tsx`: 現在メッセージ数をプロパティから描画
- `SpecialistTrace.tsx`: 折りたたみ開閉状態

### 6.3 データ受け渡し方針
- **Client 側から Supabase を直接 subscribe しない**（Phase 1 では realtime 機能を使わない）
- 初期データは Server Component で取得し props として渡す
- 以降の更新は `/api/chat` のレスポンスと `/api/sessions` のポーリングのみ

---

## 7. 状態管理

### 7.1 方針
**Phase 1 では外部ライブラリ（Zustand / Redux）を使わず React 標準の useState / useReducer + Context のみで実装する。**

理由:
- 運営メンバー数名の小規模アプリ
- 状態は基本的にチャット画面の中で完結
- YAGNI の原則

### 7.2 状態の区分

| 種類 | 管理方法 | 例 |
|---|---|---|
| サーバー永続 | Supabase | chat_sessions, chat_messages |
| SSR 初期値 | Server Component → props | 初期メッセージリスト、ユーザー情報 |
| クライアントローカル | useState / useReducer | 送信中フラグ、入力テキスト、トレース展開状態 |
| セッション内 | React Context | currentSessionId, user情報 |
| ブラウザ永続 | localStorage（任意） | 最後のセッションID |

### 7.3 useChatStream フックの責務
```ts
type ChatStreamState = {
  messages: Message[];              // 現在表示中のメッセージ列
  isStreaming: boolean;             // SSE 受信中か
  currentStatus: string | null;     // "SEO専門家に相談中..."
  specialistTraces: SpecialistTrace[];
  error: Error | null;
};

function useChatStream(sessionId: string): {
  state: ChatStreamState;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
};
```

---

## 8. ランタイム戦略

| ファイル | Runtime | 理由 |
|---|---|---|
| `src/middleware.ts` | Edge | Next.js の制約、軽量チェックのみ |
| `app/api/chat/route.ts` | Node.js | `fs`（prompt 読み込み）、Anthropic SDK、`maxDuration=60` |
| `app/api/sessions/route.ts` | Node.js | 一貫性のためすべての API Route を Node.js で統一 |
| `app/api/auth/*/route.ts` | Node.js | 同上 |
| Server Components | Node.js | デフォルト |

**prompts/ の読み込みは Node.js Runtime 限定**：`fs.readFileSync` / `fs.statSync` が必要なため、middleware から呼べない。

---

## 9. エラーハンドリングの方針

| 発生箇所 | 挙動 |
|---|---|
| middleware の Supabase セッション取得失敗 | `console.error` 後、`/login` にリダイレクト |
| /api/chat 内の認証失敗 | 401 JSON を返す（ストリームは開始しない） |
| /api/chat 内の Classifier 失敗 | 500 を返す、または「相談者選定に失敗」メッセージで orchestrator にフォールバック |
| Specialist タイムアウト | 該当専門家のみスキップ、部分結果で続行（Graceful degradation） |
| Orchestrator 途中切断 | 既受信分をDBに保存、`event: error` を発出 |
| Unauthorized 404（DB RLS） | 1回リトライ後、ユーザーに「アクセス権がありません」を表示 |

詳細は [api-design.md](./api-design.md)、[agent-system-design.md](./agent-system-design.md) 参照。

---

## 10. 未決定事項

- Phase 1 で単一 URL (`/chat`) としたが、過去セッション一覧 UI をどこに出すか（サイドバー vs. 別ページ）
- 画面リロード時、直前の進行中ストリームを復元する必要はあるか（現状は不要と仮定）
- `/api/chat` をログアウト時に `AbortController` で中断する仕様にすべきか
