# 設計概要

高津コネクト運営アドバイザー（takatsu-connect-advisor）の設計ドキュメント集のエントリポイント。
要件の全体像と各設計ドキュメントへの導線を提供する。

---

## 1. プロジェクト要約

- **目的**: 高津コネクト（川崎市高津区の地域メディア）運営メンバー向けの **マルチエージェント専門家チャットBOT**
- **利用者**: 運営メンバー数名（招待制）、AIリテラシー高め
- **アーキテクチャ**: Next.js (App Router) + Supabase + Anthropic Claude API
- **核となる仕組み**: 3段階パイプライン（分類 → 並列専門家 → 統合）をSSEでストリーミング応答
- **デプロイ**: Vercel Hobby + Supabase Free、GitHub Actions で keep-alive

詳細は `doc/requirements.md` を参照。

---

## 2. 設計ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [overview.md](./overview.md) | 本書（全体像 + 各ドキュメントへのリンク） |
| [app-architecture.md](./app-architecture.md) | アプリ構成、ページ構成、状態管理、ディレクトリ構造、ランタイム戦略 |
| [api-design.md](./api-design.md) | API Routes 設計、`/api/chat` の SSE ストリーミング詳細 |
| [db-design.md](./db-design.md) | スキーマ定義、ER 図、インデックス戦略、トリガ |
| [supabase-design.md](./supabase-design.md) | RLS ポリシー、Auth 設定、Supabase クライアント構成 |
| [frontend-design.md](./frontend-design.md) | コンポーネント設計、ページ遷移、レスポンシブ方針、SSE受信フック |
| [styling-design.md](./styling-design.md) | デザイントークン、カラー、タイポ、ブレークポイント、CSS Modules 規約 |
| [infra-design.md](./infra-design.md) | Vercel 設定、環境変数、CI/CD、Supabase keep-alive |
| [security-design.md](./security-design.md) | 認証・認可、APIキー管理、脆弱性対策 |
| [agent-system-design.md](./agent-system-design.md) | マルチエージェントの実装設計、ローダー、tool_use、タイムアウト戦略 |
| [prompt-design.md](./prompt-design.md) | プロンプト構成、include 機構、Prompt Caching 戦略、コンテキスト管理 |

---

## 3. 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                           │
│  Next.js Client Components (React)                                │
│   - ChatWindow / MessageList / MessageInput                       │
│   - ContextProgressBar / SpecialistTrace                          │
│   - useChatStream (fetch + ReadableStream で SSE 受信)              │
└─────────────────────┬─────────────────────────────────────────────┘
                      │ POST /api/chat (SSE)
                      │ GET /api/sessions, /api/sessions/:id/messages
                      ▼
┌──────────────────────────────────────────────────────────────────┐
│ Next.js App Router (Vercel)                                       │
│  ┌────────────────────┐                                           │
│  │ middleware.ts (Edge)│ @supabase/ssr でセッション検証            │
│  └────────────────────┘                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ app/api/chat/route.ts  (Node.js, maxDuration=60)             │  │
│  │  1. 認証確認 → セッション確定 → user message INSERT           │  │
│  │  2. 直近20件取得                                              │  │
│  │  3. ReadableStream で SSE                                    │  │
│  │     ├─ Classifier (Haiku) → specialists を選定                │  │
│  │     ├─ Specialists (Haiku × N 並列, Promise.race 8s)         │  │
│  │     │   - tool_use: GA / GSC / WP / fetch_webpage           │  │
│  │     └─ Orchestrator (Sonnet, stream:true)                    │  │
│  │  4. assistant message INSERT + specialist_traces INSERT      │  │
│  │  5. ローカルキャッシュ set (30s TTL)                           │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ lib/agents, lib/tools, lib/claude, lib/db                   │  │
│  │ prompts/ (Markdown + YAML、fs で mtime キャッシュ読込)        │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────┬───────────────────┬──────────────────┬────────────┘
                │                   │                  │
                ▼                   ▼                  ▼
         ┌──────────────┐   ┌─────────────┐   ┌──────────────────┐
         │ Supabase     │   │ Anthropic   │   │ 外部 API          │
         │  - Auth      │   │  Claude API │   │  - GA Data API   │
         │  - chat_*    │   │  (Haiku +   │   │  - Search Console│
         │  - RLS       │   │   Sonnet)   │   │  - WordPress REST│
         └──────────────┘   └─────────────┘   │  - fetch webpage │
                                              └──────────────────┘
         ┌──────────────────────────────────────────────────────┐
         │ GitHub Actions: daily keepalive_log insert (cron)    │
         └──────────────────────────────────────────────────────┘
```

---

## 4. 主要設計判断のサマリ

| 判断 | 採用理由 | 参照 |
|---|---|---|
| App Router + Route Handlers | ストリーミング応答を細かく制御、`maxDuration=60` を route.ts 単位で設定 | [app-architecture.md](./app-architecture.md) |
| Server Actions 不採用 | ストリーミング応答に適さない | [api-design.md](./api-design.md#9-server-actions-を使わない理由) |
| middleware + `(main)/layout.tsx` の二段ガード | middleware の Edge 制約を踏まえた多層防御 | [app-architecture.md](./app-architecture.md#4-認証ガードの二段階構成) |
| `@supabase/ssr` の採用 | Edge / Node 両対応、`jsonwebtoken` 不要 | [supabase-design.md](./supabase-design.md#2-supabase-クライアント構成) |
| `prompts/` を src/ 外に配置 | 非エンジニアが触れる領域、ビルド非対象 | [prompt-design.md](./prompt-design.md#2-ディレクトリ構造) |
| エージェント定義のmtimeキャッシュ読込 | 起動時一括ではなくリクエスト毎に差分再読込、ホットリロード相当 | [agent-system-design.md](./agent-system-design.md#4-エージェント定義ローダー) |
| マルチモデル戦略（Haiku × Sonnet） | 専門家は軽量＋並列で速度、統合のみ高性能モデル | [agent-system-design.md](./agent-system-design.md#1-アーキテクチャ概観) |
| tool_use で並列ツール実行 | 1応答に複数 tool_use がある時 Promise.all で並列、claw-code の学び | [agent-system-design.md](./agent-system-design.md#74-ツール並列化) |
| Prompt Caching 2層 (Anthropic + local) | API料金削減 + リロード連打の無駄削減 | [prompt-design.md](./prompt-design.md#5-prompt-caching-戦略) |
| 直近20件の固定コンテキスト | 要約は Phase 2、シンプル優先 | [prompt-design.md](./prompt-design.md#6-コンテキスト管理直近-n-件方式) |
| 各専門家 8秒タイムアウト + Graceful degradation | 可用性優先、部分結果で応答 | [agent-system-design.md](./agent-system-design.md#75-タイムアウトpromise-race) |
| CSS Modules 採用（Tailwind禁止） | プロジェクトルール `.claude/rules/no-tailwind.md` | [styling-design.md](./styling-design.md) |
| RLS + user_id 冗長保持 | 多層防御、JOIN なしで RLS 高速化 | [db-design.md](./db-design.md#3-テーブル定義) |
| Vercel Hobby + maxDuration=60 | 規模的に十分、60秒で通常動作 | [infra-design.md](./infra-design.md#11-vercel-hobby-制約の確認) |

---

## 5. プロジェクトルール（必ず参照）

`.claude/rules/` 配下に置かれた以下のルールは、実装時に必ず守ること。

| ルール | 内容 |
|---|---|
| `no-tailwind.md` | Tailwind CSS 全面禁止。CSS Modules を使用 |
| `bash-single-line.md` | Bash コマンドは1行ずつ。`&&` / `;` / `\|` チェイン禁止 |
| `nextjs-edge-runtime.md` | middleware.ts で `jsonwebtoken` / `bcrypt` 禁止。`jose` または `@supabase/ssr` を使用 |
| `mandatory-testing.md` | テストなしのタスク完了不可 |

---

## 6. 実装の優先順位

Phase 1（MVP）の実装順の推奨:

1. **インフラ下地**
   - 環境変数定義、zod バリデータ、Supabase プロジェクト作成
   - Migration で全テーブル + RLS 投入
   - Vercel プロジェクト作成、環境変数登録
2. **認証基盤**
   - middleware.ts、`(auth)` / `(main)` layout、Supabase クライアント
   - Login ページ（Email+PW, Google OAuth）
3. **エージェント基盤**
   - `prompts/agents/*.md` と `shared/*.md` の初期セット
   - loader.ts / registry.ts、validate-agents スクリプト
   - Claude クライアントラッパ、ローカルキャッシュ
4. **ツール実装**
   - query_search_console、query_google_analytics
   - fetch_wp_posts、fetch_webpage（SSRF対策含む）
5. **パイプライン**
   - Classifier / Specialist（tool_use ループ）/ Orchestrator
   - pipeline.ts の並列実行とタイムアウト
6. **API Route**
   - `/api/chat` の SSE ストリーム
   - セッション・メッセージの DB 書き込み
7. **フロントエンド**
   - ChatWindow / MessageList / MessageInput / SpecialistTrace
   - useChatStream
   - ContextProgressBar
8. **仕上げ**
   - E2E（Playwright）: ログイン経由 → チャット送信 → SSE 受信
   - GitHub Actions: ci.yml + supabase-keepalive.yml
   - セキュリティヘッダー、エラーハンドリング

---

## 7. 各ドキュメントで列挙されている「未決定事項」

設計時点で判断を保留した事項は、各ドキュメントの末尾「未決定事項」を参照。
実装着手時にPM・関係者で個別に判断し、必要であれば本書を更新する。

- [app-architecture.md #10](./app-architecture.md#10-未決定事項)
- [api-design.md #10](./api-design.md#10-未決定事項)
- [db-design.md #9](./db-design.md#9-未決定事項)
- [supabase-design.md #9](./supabase-design.md#9-未決定事項)
- [frontend-design.md #10](./frontend-design.md#10-未決定事項)
- [styling-design.md #11](./styling-design.md#11-未決定事項)
- [infra-design.md #11](./infra-design.md#11-未決定事項)
- [security-design.md #13](./security-design.md#13-未決定事項)
- [agent-system-design.md #11](./agent-system-design.md#11-未決定事項)
- [prompt-design.md #10](./prompt-design.md#10-未決定事項)
