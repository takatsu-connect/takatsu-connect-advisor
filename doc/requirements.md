# 高津コネクト運営アドバイザー 要件定義書

## 1. プロジェクト概要

### 1.1 目的
[高津コネクト](https://takatsu-connect.com/)（川崎市高津区の地域情報サイト）を運営するメンバーが、サイト運営に関するアドバイスを受けるための専門家チャットBOT。

### 1.2 背景
- 高津コネクトは運営母体「まちの企画室」が運営する地域メディア
- 運営メンバーは数名、全員AIリテラシーが一般より高い
- 運営にあたり、SEO・マーケティング・コンテンツ戦略・データ分析など複数の専門知識が必要
- 各分野の専門家に相談するのと同等の助言を、Webチャット上で受けられる仕組みを構築する

### 1.3 システム名
takatsu-connect-advisor

---

## 2. 利用者

### 2.1 ユーザー
- 高津コネクトの運営メンバー（数名程度）
- 招待制アクセス
- 全員AIリテラシーは高め（「AIは過去を忘れる」等の前提は理解済み）

### 2.2 権限モデル
- 認証済みユーザーのみが利用可能
- 全ユーザー同権限（管理者区分なし）
- チャット履歴は個人別に分離

---

## 3. 機能要件

### 3.1 認証機能
- **方式**: Supabase Auth
- **招待制**: 管理者がSupabase上でユーザーを手動招待
- **ログイン手段**:
  - メールアドレス + パスワード
  - Google OAuth
- **未ログイン時**: ログイン画面へリダイレクト

### 3.2 チャット機能
- Webブラウザ上のチャットUI
- ユーザーのメッセージ送信
- AI（複数エージェント）の応答表示
- チャット履歴の表示（スクロール可能）
- チャット履歴は個人別にSupabaseに保存
- チャット履歴は削除不可（保持）

### 3.3 マルチエージェントシステム（オーケストレーター型）

#### 3.3.1 動作概要（3段階パイプライン）
```
ユーザー質問
   ↓
[分類ステップ] Haiku 4.5 が質問を解析、呼ぶべき専門家を選定   (0.5-1秒)
   ↓ ストリーミングで「◯◯専門家に相談中...」を即時表示
   ↓
[並列専門家呼び出し] 必要な専門家のみ並列実行 (Haiku 4.5 + tool_use)   (1.5-2.5秒)
   ├─ SEO専門家  （必要時のみ）
   ├─ データ分析家（必要時のみ）
   └─ 他専門家   （必要時のみ）
   ↓ ストリーミング継続 → 専門家の中間所感を逐次送信
   ↓
[統合レスポンス] Sonnet 4.6 がストリーミングで統合回答を生成   (2-4秒)
   ↓ ストリーミング完了
合計: 4-7秒（最初のテキスト表示は約1秒後）
```

**設計原則**:
- **全専門家を毎回呼ばない**: 分類ステップで必要な専門家のみ起動（コスト・速度最適化）
- **マルチモデル戦略**: 専門家は軽量モデル（Haiku）、統合は中量モデル（Sonnet）
- **ストリーミング必須**: ユーザー体感速度の最大化、タイムアウト耐性
- **Graceful degradation**: 一部専門家がタイムアウトしても部分結果で応答

#### 3.3.2 エージェント一覧（初期）

| エージェント | モデル | 役割 | 主に使うツール |
|---|---|---|---|
| `classifier` | Haiku 4.5 | 質問分類・専門家選定 | なし |
| `orchestrator` | Sonnet 4.6 | 専門家の回答を統合してユーザーに返す | 専門家呼び出し結果 |
| `seo-specialist` | Haiku 4.5 | SEO専門家。検索流入・キーワード分析 | GSC、fetch_webpage、WP API |
| `marketing-specialist` | Haiku 4.5 | マーケティング専門家。集客・ブランディング | GA、GSC |
| `data-analyst` | Haiku 4.5 | データアナリスト。GA/GSC数値解釈 | GA、GSC |
| `content-strategist` | Haiku 4.5 | コンテンツ戦略家。記事企画・改善 | WP API、GA |
| `local-expert` | Haiku 4.5 | 地域情報専門家。高津区の文脈理解 | WP API |

**モデル選択の根拠**:
- Haiku 4.5: 1-2秒で応答、安価、専門家の単発推論には十分な品質
- Sonnet 4.6: 2-3秒で応答、複数専門家の見解を統合する推論品質が必要
- 環境変数（`CLASSIFIER_MODEL`, `SPECIALIST_MODEL`, `ORCHESTRATOR_MODEL`）で各役割のモデルを個別に切替可能

#### 3.3.3 エージェント定義形式
Claude Codeの `.claude/agents/*.md` と同形式のMarkdownファイル（YAMLフロントマター + 本文）で定義する。

例: `prompts/agents/seo-specialist.md`
```markdown
---
name: seo-specialist
displayName: SEO専門家
description: 検索流入・キーワード分析・SEO施策を担当。
model: claude-sonnet-4-6
tools:
  - query_gsc
  - fetch_webpage
  - fetch_wp_posts
include:
  - shared/takatsu-connect.md
  - shared/style-guide.md
temperature: 0.7
maxTokens: 2048
---

あなたは地域メディアのSEO専門家です。
...（システムプロンプト本文）
```

#### 3.3.4 エージェント定義の追加・編集
- `prompts/agents/` に新しい `.md` を置くだけでエージェント追加可能（コード変更不要）
- 既存エージェントの調整はファイル編集のみ
- 起動時に自動スキャン・登録される
- 開発時はホットリロード対応
- バリデーションスクリプト（`pnpm validate-agents`）で定義ファイルの整合性をチェック

#### 3.3.5 共通前提知識
`prompts/shared/` 以下に共通知識を格納し、各エージェントが `include` で参照可能。
- `shared/takatsu-connect.md`: 高津コネクトの背景・目的
- `shared/machino-kikakushitsu.md`: まちの企画室について
- `shared/style-guide.md`: 回答トーン・敬語レベル

### 3.4 外部データ連携（tool_use）

LLMが質問内容に応じて以下のツールを動的に呼び出す。

| ツール名 | 内容 | 認証 |
|---|---|---|
| `query_google_analytics` | GAからアクセスデータ取得（地域・デバイス・流入元別等） | サービスアカウント |
| `query_search_console` | GSCから検索クエリ・流入データ取得 | サービスアカウント |
| `fetch_wp_posts` | WordPress REST API (`/wp-json/wp/v2/posts`) から記事取得 | 不要（公開API） |
| `fetch_webpage` | 任意URLのHTML取得（meta情報・構造化データ等のSEO視点確認用） | 不要 |
| `consult_specialist` | 他の専門家エージェントへ相談（オーケストレーター専用） | 内部ツール |

### 3.5 コンテキスト管理

#### 3.5.1 履歴送信方式
- チャット履歴はSupabaseに全件保存する
- 次回API呼び出し時、**直近N件のみ**をClaude APIの `messages` に含める
- デフォルト N = 20
- Nは環境変数で変更可能
- N件を超えた過去メッセージは送信しない（LLMは忘れる）

#### 3.5.2 要約機能
- Phase 1（MVP）では実装しない
- 必要性が確認されたらPhase 2で検討

#### 3.5.3 コンテキストプログレスバー
- チャット画面上に、現在のコンテキスト使用状況を示す **ごく簡単な** プログレスバーを表示
- 細長い棒が上限（N）に近づいていくことがわかるだけでよい
- 数値・ラベル・説明は表示しない
- 画面の邪魔にならない配置（入力欄の上端 または 画面端の細いライン）
- 目的: 「そろそろ過去を忘れるタイミング」をユーザーに認識させる

### 3.6 プロンプトキャッシュ・結果キャッシュ

#### 3.6.1 Anthropic API Prompt Caching（2層）
- システムプロンプト（エージェント定義 + 共通知識）にcache_control を設定
- ツール定義にもcache_controlを設定
- 過去メッセージの先頭部分もキャッシュ対象
- 結果: 同じエージェントで連続質問した際に `cache_read_input_tokens` でコスト大幅削減

#### 3.6.2 ローカル完全一致キャッシュ（30秒TTL）
- リクエスト全体（model + system + tools + messages）のハッシュをキーにレスポンスをキャッシュ
- TTL: 30秒
- 同一リクエストはAPI呼び出しをスキップ（0秒で返却）
- ユーザーがリロード/再送信した場合の無駄なAPI消費を削減
- Phase 1から実装

### 3.7 ストリーミングレスポンス（SSE）
- サーバー → クライアントへSSE（Server-Sent Events）で段階的送信
- 送信するイベント種別:
  - `status`: 「◯◯専門家に相談中...」等のステータス表示
  - `specialist_result`: 各専門家の中間回答（折りたたみ表示用）
  - `content`: 統合レスポンスのテキストチャンク
  - `done`: 完了通知
  - `error`: エラー発生
- クライアント側は `EventSource` または `fetch` + `ReadableStream` で受信

### 3.8 タイムアウト戦略
- 各専門家呼び出し: 最大8秒でタイムアウト（`Promise.race`）
- タイムアウト時はその専門家を除外して統合フェーズへ進む
- 統合フェーズ自体は最大 `maxDuration - 経過時間 - バッファ` でタイムアウト
- 部分結果がある場合は必ずユーザーに返す（全失敗時のみエラー応答）

---

## 4. 非機能要件

### 4.1 技術スタック

| 分類 | 技術 |
|---|---|
| フロントエンド | Next.js（App Router） |
| バックエンド | Next.js API Routes / Server Actions |
| DB | Supabase（無料版） |
| 認証 | Supabase Auth |
| LLM | Anthropic Claude API（`claude-sonnet-4-6` デフォルト） |
| SDK | `@anthropic-ai/sdk` |
| スタイリング | CSS Modules + CSS Custom Properties（Tailwind禁止） |

### 4.2 環境変数（コントロール可能な設定）

| 変数名 | 用途 | デフォルト |
|---|---|---|
| `CLASSIFIER_MODEL` | 分類ステップのモデル | `claude-haiku-4-5` |
| `SPECIALIST_MODEL` | 専門家エージェントのモデル | `claude-haiku-4-5` |
| `ORCHESTRATOR_MODEL` | 統合レスポンスのモデル | `claude-sonnet-4-6` |
| `CONTEXT_MESSAGE_LIMIT` | コンテキスト履歴件数 | `20` |
| `SPECIALIST_TIMEOUT_MS` | 各専門家のタイムアウト | `8000` |
| `LOCAL_CACHE_TTL_SECS` | ローカル完全一致キャッシュのTTL | `30` |
| `ANTHROPIC_API_KEY` | Anthropic APIキー | （必須） |
| `SUPABASE_URL` | Supabase URL | （必須） |
| `SUPABASE_ANON_KEY` | Supabase anon key | （必須） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseサービスロール | （必須） |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GA/GSC用サービスアカウント認証情報 | （必須） |
| `GA_PROPERTY_ID` | Google Analytics プロパティID | （必須） |
| `GSC_SITE_URL` | Search Console サイトURL | （必須） |
| `WORDPRESS_API_BASE` | WordPress REST API ベースURL | `https://takatsu-connect.com/wp-json` |

### 4.3 Supabaseフリーズ対策
- Supabase無料版は一定期間アクセスがないとフリーズする
- 対策として **GitHub Actions** で1日1回、日時をinsertするだけの処理を実行
- 専用テーブル（例: `keepalive_log`）にinsertする（削除不要、システム本体としては不使用）

### 4.4 セキュリティ
- すべてのAPIエンドポイントはSupabase Authで認証必須
- Row Level Security (RLS) でユーザーごとのチャット履歴分離
- サービスアカウント認証情報はサーバー側のみで保持（クライアントに露出させない）
- Anthropic APIキーはサーバー側のみで使用

### 4.5 パフォーマンス

#### 4.5.1 目標レスポンス時間
- 最初のテキスト表示: ~1秒（ストリーミング開始）
- 統合回答完了まで: 4〜7秒

#### 4.5.2 Vercelプラン・タイムアウト設計
- **Vercel Hobby（無料プラン）で運用可能**
- `/api/chat` ルートに `maxDuration = 60` を設定（Hobbyで最大60秒まで利用可能）
- 必要に応じて Fluid Compute を有効化（Hobbyでも最大300秒まで拡張可能）
- 通常動作は10秒以内に収まる前提、タイムアウト60秒は保険

#### 4.5.3 最適化手段
- マルチモデル戦略（専門家はHaiku、統合はSonnet）
- 専門家の並列呼び出し（`Promise.all`）
- ストリーミングで体感速度を向上
- ローカル完全一致キャッシュ + Anthropic Prompt Caching

### 4.6 レスポンシブ対応
- PC・タブレット・スマートフォンすべてで快適に利用できること
- 想定ブレークポイント（目安）:
  - モバイル: `~ 640px`
  - タブレット: `641px ~ 1024px`
  - デスクトップ: `1025px ~`
- 画面要素の振る舞い:
  - チャット入力欄はモバイルでも使いやすい十分なタップ領域を確保
  - メッセージ一覧はビューポート高さに追随してスクロール
  - コンテキストプログレスバーは全デバイスで視認可能な位置に配置
  - 専門家呼び出しトレース（折りたたみ表示）はモバイルでも崩れないこと
- タッチ操作に配慮したUIサイズ（最小44x44px目安）
- CSS Modules + メディアクエリ（CSS Custom Propertiesと組み合わせ）で実装

### 4.7 運用
- デプロイ先は未定（Vercelを想定）
- エラーログはコンソール出力 + Supabaseに記録（Phase 1 は最低限）

---

## 5. フォルダ構成

```
takatsu-connect-advisor/
├── prompts/                           ← エージェント定義（非エンジニアでも触れる）
│   ├── agents/
│   │   ├── orchestrator.md
│   │   ├── seo-specialist.md
│   │   ├── marketing-specialist.md
│   │   ├── data-analyst.md
│   │   ├── content-strategist.md
│   │   └── local-expert.md
│   ├── shared/                        ← エージェント共通の前提知識
│   │   ├── takatsu-connect.md
│   │   ├── machino-kikakushitsu.md
│   │   └── style-guide.md
│   └── tools/                         ← tool_use説明テンプレ（任意）
│
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── chat/route.ts          # チャットAPI本体
│   │   ├── (auth)/                    # 認証関連
│   │   └── (main)/
│   │       └── chat/page.tsx          # チャット画面
│   │
│   ├── lib/
│   │   ├── agents/
│   │   │   ├── loader.ts              # prompts/agents/*.md を読み込む
│   │   │   ├── registry.ts            # エージェント一覧の管理
│   │   │   ├── orchestrator.ts        # オーケストレーター実行
│   │   │   ├── specialist.ts          # 専門家実行
│   │   │   └── types.ts               # 型定義
│   │   ├── tools/
│   │   │   ├── index.ts
│   │   │   ├── consult-specialist.ts
│   │   │   ├── query-ga.ts
│   │   │   ├── query-gsc.ts
│   │   │   ├── fetch-wp-posts.ts
│   │   │   └── fetch-webpage.ts
│   │   ├── claude/
│   │   │   └── client.ts              # Anthropic SDK ラッパー（prompt cache対応）
│   │   └── db/
│   │       ├── chat.ts
│   │       └── supabase.ts
│   │
│   └── components/
│       └── chat/
│           ├── ChatWindow.tsx
│           ├── MessageList.tsx
│           ├── ContextProgressBar.tsx
│           └── SpecialistTrace.tsx
│
├── scripts/
│   └── validate-agents.ts             # エージェント定義の構文チェック
│
├── .github/
│   └── workflows/
│       └── supabase-keepalive.yml     # 1日1回のkeep-alive
│
├── tests/
│
└── doc/
    ├── requirements.md                # 本ドキュメント
    └── design/                        # 設計ドキュメント（設計フェーズで作成）
```

---

## 6. DB設計概要（詳細は設計フェーズ）

### 6.1 主要テーブル（想定）

| テーブル | 用途 |
|---|---|
| `auth.users` | Supabase Auth管理（標準） |
| `chat_sessions` | チャットセッション（ユーザー単位） |
| `chat_messages` | メッセージ（role=user/assistant、内容、タイムスタンプ） |
| `specialist_traces` | 専門家呼び出しのトレース（任意、デバッグ用） |
| `keepalive_log` | Supabaseフリーズ対策用（日時をinsertするだけ） |

RLSで `auth.uid()` ベースの個人別アクセス制御を行う。

---

## 7. 開発フェーズ

### Phase 1（MVP）
- Supabase Auth による招待制ログイン
- チャットUI（基本、レスポンシブ）
- 3段階パイプライン（分類 → 並列専門家 → 統合）
- 初期エージェント: classifier + orchestrator + 5専門家
- マルチモデル戦略（Haiku 4.5 × Sonnet 4.6）
- tool_use による GA / GSC / WP / fetch_webpage
- SSE ストリーミングレスポンス
- 直近20件固定のコンテキスト送信
- Anthropic Prompt Caching
- ローカル完全一致キャッシュ（30秒TTL）
- コンテキストプログレスバー
- Supabase keep-alive (GitHub Actions)
- タイムアウト戦略 + Graceful degradation

### Phase 2（必要に応じて）
- チャット履歴の要約機能
- エージェント間の直接対話
- ユーザーが専門家を直接指名できるモード
- 専門家呼び出しトレースの可視化強化

---

## 8. 要件外（やらないこと）

- 高津コネクト一般ユーザー向けの機能（運営専用）
- 管理者UI（ユーザー管理はSupabase Studioから手動）
- モバイルアプリ化
- 外部サービスへの通知連携（Slack等）
- MCPサーバーの構築（tool_useで代替）

---

## 9. 主要な設計判断の根拠

| 判断 | 根拠 |
|---|---|
| MCP不採用 | Webチャット経由のみの利用で、MCPの「Claudeクライアント間共有」の恩恵がない。tool_useで同等の機能を実現できる |
| オーケストレーター型マルチエージェント（3段階） | `ultraworkers/claw-code` 参考。分類→並列専門家→統合の3段階で、品質と速度を両立 |
| マルチモデル戦略（Haiku＋Sonnet） | 専門家は軽量モデル（Haiku 4.5）で並列実行、統合のみ中量モデル（Sonnet 4.6）。合計応答時間を大幅短縮 |
| 分類ステップで必要な専門家のみ呼び出し | 毎回全員呼ぶとコストと遅延が増加。分類で絞ることで平均2-3名の並列呼び出しに収まる |
| ストリーミング（SSE）前提 | Vercelの関数タイムアウトはストリーミング開始後は接続維持される。体感速度とタイムアウト耐性を両立 |
| Vercel Hobby（無料）採用 | `maxDuration=60`設定でHobbyでも60秒まで使用可能。Fluid Computeで300秒まで拡張可能。運営数名の規模には十分 |
| ローカル完全一致キャッシュ（30秒） | `claw-code`参考。同一リクエストのAPI呼び出しを0秒化。リロード連打等の無駄を削減 |
| エージェント定義をMarkdownファイルに外出し | 非エンジニアの微調整・追加が容易。Git差分でプロンプトエンジニアリングの履歴管理が可能 |
| 要約機能は Phase 2 送り | YAGNI。運営メンバー数名の利用規模では直近20件＋プロンプトキャッシュで十分 |
| Tailwind禁止 / CSS Modules採用 | プロジェクト方針（`.claude/rules/no-tailwind.md`）に準拠 |
| Graceful degradation方針 | 一部専門家がタイムアウトしても、得られた部分結果で統合回答を返す。可用性優先 |
