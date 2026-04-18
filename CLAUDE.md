# プロジェクト開発ワークフロー（ベース定義）

このファイルはPM（プロジェクトマネージャー）としてメイン会話で動作するためのベース定義です。
PMはサブエージェントを逐次呼び出し、ワークフローを制御します。

**注意: このファイルは直接編集しないでください。`scripts/setup.sh` により `CLAUDE.project.md` と結合されて `CLAUDE.md` が生成されます。**

## Bashコマンド実行ルール（厳守）

**これはすべてのエージェントに適用される絶対ルールである。詳細は `rules/bash-single-line.md` を参照。**

1. **コマンドチェイン禁止** — `&&`, `;`, `|` でのチェインは禁止。1つずつ個別に実行
2. **単一行実行** — ヒアドキュメント、バッククォート内改行は禁止
3. **複数行引数は外部ファイル経由** — `tmp/` に一時ファイルを書き出して参照
   - `git commit -F tmp/commit-msg.txt`
   - `bd create --body-file tmp/bd-body.md`
   - `bd update {id} --body-file tmp/bd-body.md`

## エージェント呼び出しルール

- PMはメイン会話として動作し、サブエージェントを逐次呼び出す
- サブエージェントは他のサブエージェントを呼び出せない（Claude Codeの制約）
- 各サブエージェントはgit操作を行わない（Git管理者のみが行う）
- 各サブエージェントはBeads操作を行わない（Beads管理者のみが行う）
- 依存関係のないタスクは、同一メッセージ内で複数のAgent呼び出しにより並列実行する

## バグ報告・改善要望のトリアージ（PM必須手順）

ユーザーから複数のバグや改善要望を受け取った場合、**beads-managerに渡す前にPM自身が分解判断を行う**こと。beads-managerはCLI操作の専門家であり、分解の判断はPMの責務である。

### 手順

1. **調査**: 報告された各項目について、関連コードをRead/Grepで確認する
2. **判断**: 以下の基準で分離・統合・依存関係を決定する
3. **指示**: 判断結果に基づき、beads-managerに個別のタスク作成を指示する

### 分解の判断基準

| 状況                                | 判断                       | 例                                               |
| ----------------------------------- | -------------------------- | ------------------------------------------------ |
| 修正箇所が異なるファイル/モジュール | **分離**                   | API側のバグとCSS崩れ                             |
| 同一関数・同一原因の可能性が高い    | **統合**                   | 同じバリデーション処理に起因する2つの症状        |
| 一方を直さないと他方が確認できない  | **依存関係を設定して分離** | DB修正が先、API修正が後                          |
| 判断がつかない                      | **分離を優先**             | 後から統合するより、分離しておく方がリスクが低い |

### 注意事項

- ユーザーの報告が「1つの問題」に見えても、修正箇所が複数モジュールにまたがる場合は分離する
- ユーザーの報告が「複数の問題」に見えても、根本原因が同一と判断できれば統合してよい
- 迷った場合は分離を選ぶ（1タスク=1エージェントが1セッションで完了できる粒度）

## ワークフロー

各フェーズの詳細手順はコマンドとして定義されている。PMはコマンドを実行してワークフローを進める。

### フェーズ1: 設計 → `/design`

要件定義→スペシャリスト相談→設計ドキュメント作成→タスク分解

### フェーズ2: 開発開始 → `/dev-start`

`bd ready`で実行可能タスクを取得し、並列実行可能なものはworktreeで並列処理

### タスク開発パイプライン → `/dev-task <id>`

準備→実装→コードレビュー→テスト実装→テストレビュー→テスト実行→テスト結果判定→完了

- コードレビューNG: 2回まで再実装、3回目以降はロールバック
- テスト結果NG: 同上

### ロールバック → `/dev-rollback <id>`

旧タスククローズ→新タスク作成→依存関係付け替え→ブランチ破棄（3回まで、4回目は停止）

### 並列実行ルール

- `bd ready` で依存なしタスクを取得し、worktreeで並列実行
- 同じファイルを編集する可能性がある場合は順次実行に切り替え

## エージェント一覧

### オーケストレーション層

| エージェント     | ファイル              | 役割                                         |
| ---------------- | --------------------- | -------------------------------------------- |
| 設計エージェント | `design-architect.md` | 要件→設計ドキュメント作成                    |
| Beads管理者      | `beads-manager.md`    | タスク作成・更新・依存関係・ロールバック管理 |
| Git管理者        | `git-manager.md`      | ブランチ・コミット・マージ・Worktree管理     |

### フレームワークスペシャリスト層

| エージェント             | ファイル                   | 役割                                          |
| ------------------------ | -------------------------- | --------------------------------------------- |
| Next.jsスペシャリスト    | `nextjs-specialist.md`     | Next.js固有の設計・実装アドバイザー           |
| React+Viteスペシャリスト | `react-vite-specialist.md` | React+Vite (SPA) 固有の設計・実装アドバイザー |

### 実装層

| エージェント               | ファイル                 | 役割                                         |
| -------------------------- | ------------------------ | -------------------------------------------- |
| フロントエンドエンジニア   | `frontend-engineer.md`   | Reactコンポーネント、ページ実装              |
| バックエンドエンジニア     | `backend-engineer.md`    | API/データアクセス層、サーバーサイドロジック |
| DB設計エンジニア           | `db-designer.md`         | 汎用スキーマ設計、マイグレーション戦略       |
| Supabaseスペシャリスト     | `supabase-specialist.md` | DB実装+Auth+RLS、Supabase MCP操作            |
| WEBデザイナー              | `web-designer.md`        | CSS Modules、レスポンシブ、ビジュアル        |
| インフラエンジニア         | `infra-engineer.md`      | デプロイ設定、CI/CD、環境変数                |
| セキュリティスペシャリスト | `security-specialist.md` | 脆弱性監査、認証/認可レビュー                |

### レビュー層

| エージェント       | ファイル                    | 役割                                   |
| ------------------ | --------------------------- | -------------------------------------- |
| FEコードレビュアー | `frontend-code-reviewer.md` | フロントエンドコード品質・設計レビュー |
| BEコードレビュアー | `backend-code-reviewer.md`  | バックエンドコード品質・設計レビュー   |

### テスト層

| エージェント       | ファイル                    | 役割                                 |
| ------------------ | --------------------------- | ------------------------------------ |
| FEテストエンジニア | `frontend-test-engineer.md` | フロントエンドテスト設計・実装・実行 |
| BEテストエンジニア | `backend-test-engineer.md`  | バックエンドテスト設計・実装・実行   |

### テスト検証層

| エージェント       | ファイル                    | 役割                                     |
| ------------------ | --------------------------- | ---------------------------------------- |
| FEテストレビュアー | `frontend-test-reviewer.md` | フロントエンドテスト設計の十分性チェック |
| BEテストレビュアー | `backend-test-reviewer.md`  | バックエンドテスト設計の十分性チェック   |
| FEテストジャッジ   | `frontend-test-judge.md`    | フロントエンドテスト結果の判定・失敗分析 |
| BEテストジャッジ   | `backend-test-judge.md`     | バックエンドテスト結果の判定・失敗分析   |

---

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

- `release`: 正式版ブランチ（エージェント操作禁止）
- `preview`: プレビュー版ブランチ（エージェント操作禁止）
- `dev`: 開発ブランチ（featureブランチのマージ先）
- `feature/bd-{beads-id}`: タスクごとのブランチ

### ルール

- Git Worktreeを使い、並行で進められるタスクは並行で進める
- featureブランチはBeadsのIDを使って命名する
- release, previewブランチはエージェントが操作しない

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
