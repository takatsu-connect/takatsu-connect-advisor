# プロジェクト固有設定

## プロジェクト概要

高津コネクト運営アドバイザーチャットBOT。運営メンバー数名が、SEO・マーケティング・コンテンツ戦略・データ分析などの専門家AIにチャット形式で相談できるWebアプリ。

- 利用者: 高津コネクト運営メンバー（招待制・数名）
- 方式: マルチエージェント（オーケストレーター型）
- LLM: Anthropic Claude API（tool_use ＋ prompt caching）
- 詳細は `doc/requirements.md` を参照

## 技術スタック

### フレームワーク・デプロイ

- フレームワーク: Next.js (App Router)
- Node.js: 20.x LTS 以上
- パッケージマネージャ: pnpm
- デプロイ: Vercel

### データ・認証

- DB: Supabase
- Auth: Supabase Auth（招待制、Email/PW + Google OAuth）

### LLM / 外部連携

- LLM: Anthropic Claude API（SDK: `@anthropic-ai/sdk`）
  - デフォルトモデル: `claude-sonnet-4-6`（環境変数 `CLAUDE_MODEL` で切替可能）
  - Prompt caching 有効
  - tool_use によるツール呼び出し
- Google Analytics / Google Search Console（サービスアカウント認証）
- WordPress REST API（公開）
- Webページ取得（任意URL）

### 開発・品質

- タスク管理: Beads
- テスト:
  - 単体・結合: Jest + React Testing Library
  - E2E: Playwright
- スタイリング: CSS Modules + CSS Custom Properties（Tailwind CSS は禁止）

## Git戦略

### ブランチ構成

- `main`: 正式版ブランチ（エージェント操作禁止）
- `dev`: 開発ブランチ（featureブランチのマージ先）
- `feature/bd-{beads-id}`: タスクごとのブランチ

### ルール

- Git Worktreeを使い、並行で進められるタスクは並行で進める
- featureブランチはBeadsのIDを使って命名する
- mainブランチはエージェントが操作しない

## 要件定義ドキュメント

- 配置先: `doc/requirements.md`

## 設計ドキュメント構成

設計エージェント(`design-architect`)が作成する設計ドキュメントの一覧。

- `doc/design/overview.md`: 設計概要（各ドキュメントへのリンク集）
- `doc/design/app-architecture.md`: アプリ構成、ページ構成、状態管理
- `doc/design/api-design.md`: API Routes / Server Actions 設計
- `doc/design/db-design.md`: スキーマ設計、ER図、インデックス戦略
- `doc/design/supabase-design.md`: RLSポリシー、Auth設定、Supabase固有設計
- `doc/design/frontend-design.md`: コンポーネント設計、ページ遷移、レスポンシブ方針
- `doc/design/styling-design.md`: デザインシステム、カラー、タイポグラフィ、ブレークポイント
- `doc/design/infra-design.md`: デプロイ設定（Vercel）、環境変数、CI/CD（GitHub Actions）、Supabase keep-alive
- `doc/design/security-design.md`: 認証フロー、RLS、APIキー管理、脆弱性対策方針
- `doc/design/agent-system-design.md`: マルチエージェントアーキテクチャ（オーケストレーター型）、エージェント定義ローダー、tool_use設計
- `doc/design/prompt-design.md`: プロンプト構成（`prompts/` 配下）、共通知識のinclude機構、prompt caching戦略、コンテキスト管理（直近N件方式）

## プロジェクト固有ルール

- Tailwind CSS の使用は禁止（`.claude/rules/no-tailwind.md` 参照）
- Bashコマンドは1つずつ個別に実行（`.claude/rules/bash-single-line.md` 参照）
- テストなしのタスク完了は認めない（`.claude/rules/mandatory-testing.md` 参照）
- middleware.ts と Edge Runtime の制約に注意（`.claude/rules/nextjs-edge-runtime.md` 参照）
- エージェント定義ファイル（`prompts/agents/*.md`）の変更はコミット必須。プロンプト変更履歴をGitで追跡する
- Anthropic APIキー、Googleサービスアカウント認証情報、Supabaseサービスロールキーはクライアントに露出させないこと
