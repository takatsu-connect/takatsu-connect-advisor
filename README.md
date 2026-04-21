# takatsu-connect-advisor

[高津コネクト](https://takatsu-connect.com/) 運営メンバー向けのアドバイザーチャット BOT。

SEO / マーケティング / コンテンツ戦略 / データ分析 などの専門家 AI エージェントに、運営課題を相談できる Web アプリ。

---

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) / TypeScript / Node.js 20+
- **パッケージマネージャ**: pnpm
- **DB / Auth**: Supabase
- **LLM**: Anthropic Claude API (`@anthropic-ai/sdk`) — Haiku 4.5 × Sonnet 4.6 のマルチモデル戦略
- **デプロイ**: Vercel (Hobby プラン想定)
- **テスト**: Jest + React Testing Library + Playwright
- **スタイリング**: CSS Modules (Tailwind 禁止)

詳細は `doc/requirements.md` / `doc/design/` を参照。

---

## 初回セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env.local
# .env.local を編集して各値を埋める
```

### 3. Supabase プロジェクトのセットアップ

以下の手順を Supabase Dashboard で実施する。

#### 3.1 プロジェクト作成

1. [Supabase](https://supabase.com/dashboard) で新規プロジェクトを作成
2. Region は `Northeast Asia (Tokyo)` を推奨
3. `Project URL` を `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` に設定
4. `anon public` キーを `NEXT_PUBLIC_SUPABASE_ANON_KEY` に設定
5. `service_role` キーを `SUPABASE_SERVICE_ROLE_KEY` に設定（サーバー専用、絶対にクライアントへ露出しないこと）

#### 3.2 マイグレーション適用

`supabase/migrations/` 配下の SQL を、Dashboard の SQL Editor から以下の順に実行する。

1. `20260501000000_init_schema.sql` — 4 テーブルとインデックス
2. `20260502000000_rls_policies.sql` — RLS ポリシー
3. `20260503000000_triggers.sql` — `touch_chat_session` トリガ

Supabase CLI を使う場合:

```bash
pnpm dlx supabase link --project-ref <your-project-ref>
pnpm dlx supabase db push
```

#### 3.3 Auth 設定

| 項目                     | 設定値                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| Site URL                 | `https://<vercel-domain>`                                                         |
| Additional Redirect URLs | `https://<vercel-domain>/auth/callback`, `http://localhost:3000/auth/callback`    |
| Sign ups                 | **Disabled**（招待制を徹底するため）                                              |
| Email Provider           | Enabled, Confirm Email ON                                                         |
| Google Provider          | Enabled（Google Cloud Console で OAuth クライアント作成、`client_id` / `secret`） |

#### 3.4 ユーザー招待（運営メンバー追加時）

Dashboard → Authentication → Users → **Invite user** → メールアドレスを入力して送信。

詳細は `doc/design/supabase-design.md` 参照。

### 4. keep-alive ワークフロー用 Secrets

GitHub リポジトリ → Settings → Secrets and variables → Actions に以下を登録:

- `SUPABASE_URL` — プロジェクト URL
- `SUPABASE_SERVICE_ROLE_KEY` — service_role キー

これにより `.github/workflows/supabase-keepalive.yml` が毎日 1 回、`keepalive_log` テーブルへ INSERT して Supabase 無料版のフリーズを防ぐ。

---

## 開発

```bash
pnpm dev           # 開発サーバー起動 (http://localhost:3000)
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm test          # Jest (単体・結合)
pnpm test:e2e      # Playwright (E2E)
pnpm build         # 本番ビルド
pnpm validate:setup  # プロジェクト設定の静的検証
pnpm format        # Prettier 整形
```

---

## ディレクトリ構成

```
src/
├── app/                 App Router (ルーティング / API Routes)
├── components/          React コンポーネント
├── hooks/               カスタムフック
├── lib/                 ビジネスロジック（agents, tools, claude, db）
├── styles/              CSS Modules 共通スタイル
└── types/               型定義

prompts/                 エージェント定義 (.md, 非エンジニアも編集可)
├── agents/              各専門家のシステムプロンプト
├── shared/              共通前提知識（include 機構で各エージェントに注入）
└── tools/               ツール呼び出しの補足説明

tests/                   Jest + Playwright
├── unit/
├── integration/
└── e2e/

supabase/migrations/     Supabase マイグレーション (SQL)
```

---

## デプロイ

Vercel に接続すると `dev` / `main` ブランチが自動デプロイされる。

Vercel の環境変数は `.env.example` を参照して Production / Preview それぞれに登録する。

---

## ライセンス

[LICENSE](./LICENSE) 参照。
