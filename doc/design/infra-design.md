# インフラ・デプロイ設計書

## 関連ドキュメント

- [設計概要](./overview.md)
- [API設計](./api-design.md)
- [Supabase設計](./supabase-design.md)
- [セキュリティ設計](./security-design.md)
- [アプリ構成](./app-architecture.md)

---

## 1. デプロイ環境

| 項目         | 内容                                                          |
| ------------ | ------------------------------------------------------------- |
| ホスティング | **Vercel (Hobby プラン)**                                     |
| DB / Auth    | **Supabase (Free plan)**                                      |
| LLM          | **Anthropic Claude API**                                      |
| 外部API      | Google Analytics Data API, Search Console API, WordPress REST |
| CI           | **GitHub Actions**                                            |
| Keep-alive   | **GitHub Actions**（cron）                                    |

### 1.1 Vercel Hobby 制約の確認

| 項目                       | Hobby 制約                                      | 本プロジェクト                             |
| -------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Function Duration          | **60秒（デフォルト10秒、maxDurationで60まで）** | `/api/chat` に `maxDuration=60` 明記       |
| Serverless Function Memory | 1024MB                                          | 十分                                       |
| 商用利用                   | 原則不可（私用プロジェクト扱い）                | 運営内部ツールとして許容範囲（要件 4.5.2） |
| Fluid Compute（将来）      | Hobbyでも最大300秒可                            | 必要になった時点で有効化                   |

ストリーミングレスポンスは接続維持中にタイムアウトがリセットされないため `maxDuration=60` が上限。

---

## 2. ブランチ戦略とデプロイトリガー

CLAUDE.md の Git 戦略に準拠。

| ブランチ       | Vercel 環境       | 用途              |
| -------------- | ----------------- | ----------------- |
| `main`         | Production        | 正式版（公開URL） |
| `dev`          | Preview           | 開発統合用        |
| `feature/bd-*` | Preview（PRごと） | タスク単位の検証  |

Vercel 側で以下を設定:

- **Production Branch**: `main`
- `dev` を **Ignored Build Step 回避リスト**に含めて Preview Deploy 対象
- `feature/*` は自動 Preview、PR ごとに URL 発行

---

## 3. 環境変数

### 3.1 一覧

| 変数名                          | スコープ        | 例                                           | 備考                        |
| ------------------------------- | --------------- | -------------------------------------------- | --------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | client + server | `https://xxxx.supabase.co`                   | anon でも露出可             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | `ey...`                                      | anon key（RLS前提で公開可） |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only** | `ey...`                                      | 絶対にクライアント露出禁止  |
| `ANTHROPIC_API_KEY`             | **server only** | `sk-ant-...`                                 |                             |
| `CLASSIFIER_MODEL`              | server          | `claude-haiku-4-5`                           | 既定値あり                  |
| `SPECIALIST_MODEL`              | server          | `claude-haiku-4-5`                           |                             |
| `ORCHESTRATOR_MODEL`            | server          | `claude-sonnet-4-6`                          |                             |
| `CONTEXT_MESSAGE_LIMIT`         | server          | `20`                                         |                             |
| `SPECIALIST_TIMEOUT_MS`         | server          | `8000`                                       |                             |
| `LOCAL_CACHE_TTL_SECS`          | server          | `30`                                         |                             |
| `GOOGLE_SERVICE_ACCOUNT_JSON`   | **server only** | `{...}`                                      | GA/GSC 用。base64 でも可    |
| `GA_PROPERTY_ID`                | server          | `properties/123456789`                       |                             |
| `GSC_SITE_URL`                  | server          | `sc-domain:takatsu-connect.com`              |                             |
| `WORDPRESS_API_BASE`            | server          | `https://takatsu-connect.com/wp-json`        |                             |
| `NEXT_PUBLIC_SITE_URL`          | client + server | `https://takatsu-connect-advisor.vercel.app` | OAuth redirect 用           |

### 3.2 環境別設定

- `.env.example` をリポジトリに配置（値はダミー）
- `.env.local` は `.gitignore` で除外
- Vercel の Environment Variables は **Development / Preview / Production** の3環境分を登録

### 3.3 環境変数バリデーション（推奨）

`src/lib/env.ts` で zod を使って起動時検証:

```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  CLASSIFIER_MODEL: z.string().default("claude-haiku-4-5"),
  SPECIALIST_MODEL: z.string().default("claude-haiku-4-5"),
  ORCHESTRATOR_MODEL: z.string().default("claude-sonnet-4-6"),
  CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().positive().default(20),
  SPECIALIST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LOCAL_CACHE_TTL_SECS: z.coerce.number().int().nonnegative().default(30),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  GA_PROPERTY_ID: z.string().min(1),
  GSC_SITE_URL: z.string().min(1),
  WORDPRESS_API_BASE: z.string().url().default("https://takatsu-connect.com/wp-json"),
});

export const env = schema.parse(process.env);
```

- サーバー専用変数は `'server-only'` を import するファイルで読む
- クライアント側には `NEXT_PUBLIC_*` のみ届く

---

## 4. Next.js ビルド/ランタイム設定

### 4.1 `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // SSE を扱うため、FetchCache の挙動を調整する必要があれば追加
  },
  // prompts/ 配下を Node.js ランタイムで fs から読むため、Vercel にファイルを含める
  outputFileTracingIncludes: {
    "app/api/chat/route": ["./prompts/**/*.md"],
  },
};
export default nextConfig;
```

`outputFileTracingIncludes` が特に重要：
Vercel は serverless 関数を作るときに必要なファイルだけをバンドルするため、`prompts/` のような **`src/` 外のファイルは明示的に含めないと本番で `ENOENT`** になる。

### 4.2 route.ts の必須記述

```ts
// app/api/chat/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
```

---

## 5. ローカル開発

### 5.1 必要ソフトウェア

- Node.js 20 LTS 以上
- pnpm
- Docker Desktop（Supabase CLI ローカル起動用、任意）

### 5.2 手順

```
pnpm install
cp .env.example .env.local  # 値を埋める
pnpm supabase start         # 任意: ローカルSupabase
pnpm dev                    # Next.js 起動
```

`pnpm validate-agents` でエージェント定義ファイルのバリデーションを行う（要件 3.3.4）。

---

## 6. CI/CD

### 6.1 GitHub Actions

#### `ci.yml`（PR・push 時）

```yaml
name: CI
on:
  push: { branches: [dev, main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:unit
      - run: pnpm validate-agents
  e2e:
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e
```

#### `supabase-keepalive.yml`（日次）

```yaml
name: Supabase Keep-alive
on:
  schedule:
    - cron: "17 3 * * *" # 毎日 03:17 UTC (JST 12:17)
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Insert into keepalive_log
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          curl -fsS -X POST "$SUPABASE_URL/rest/v1/keepalive_log" \
            -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
            -H "Content-Type: application/json" \
            -H "Prefer: return=minimal" \
            -d '{"source":"github-actions"}'
```

`secrets.SUPABASE_URL` と `secrets.SUPABASE_SERVICE_ROLE_KEY` を GitHub Actions の Secrets に登録する。

### 6.2 デプロイ

- Vercel の GitHub 連携で自動デプロイ
- Production: `main` ブランチへの push
- Preview: 他ブランチ / PR
- Vercel CLI からの手動デプロイはリリース時のみに限定

---

## 7. ロギング

### 7.1 方針

Phase 1 は最低限（要件 4.7）:

- `console.log` / `console.error` を基本とする（Vercel のログに出力される）
- エラーは `console.error` で構造化（`[context] message`, `{detail}` 形式）
- 重要なエラーは Supabase `error_log` テーブルに記録（Phase 2 検討、Phase 1 では未実装）

### 7.2 PII マスキング

- ユーザー入力（チャット本文）は **ログに出力しない**
- Claude API リクエスト/レスポンスも原則出力しない
- エラー時に最小限のメタ（session_id, length, latency）のみ残す

---

## 8. パフォーマンス計測

### 8.1 メトリクス

- 実運用での計測は Vercel Analytics（無料枠）を採用検討
- Phase 1 では主要タイミングを `console.time` で計測しログ化
  - 分類フェーズ、各専門家、統合フェーズ、全体

### 8.2 体感指標

- 最初のテキスト表示 ~1秒
- 統合完了 4〜7秒

計測結果が悪い場合の最適化:

1. `CONTEXT_MESSAGE_LIMIT` を 20→15 に短縮
2. `SPECIALIST_TIMEOUT_MS` を下げる（8s→6s）
3. Prompt Caching の `cache_control` 範囲を広げる

---

## 9. バックアップ・災害復旧

| 項目       | 方針                                                          |
| ---------- | ------------------------------------------------------------- |
| DB         | 手動 `pg_dump` 相当を月1回（Supabase の無料枠では自動BUなし） |
| `prompts/` | Git で管理されるため追加バックアップ不要                      |
| 環境変数   | Vercel UI + 1Password 等に控えを保管（オーナー管理）          |

---

## 10. 運用ランブック（抜粋）

### 10.1 デプロイ失敗時

1. Vercel Dashboard → Deployments でログ確認
2. ビルドエラーなら当該ブランチを修正
3. 環境変数未設定エラーは Vercel Settings で追加

### 10.2 /api/chat が常にタイムアウトする

1. Anthropic API Status を確認
2. Vercel の関数ログを見る
3. 直近のコミットの `prompts/` 変更がないか確認（不正フォーマット）
4. `validate-agents` をローカル実行して整合性確認

### 10.3 Supabase が遅い/使えない

1. Supabase Dashboard で Project Status を確認
2. keep-alive の最終実行時刻を確認（`keepalive_log` SELECT）
3. 停止しているなら Resume を実施、以降 cron 頻度を見直す

---

## 11. 未決定事項

- Vercel Analytics の導入可否（コスト・個人情報）
- Sentry 等エラーモニタリングの導入（Phase 2）
- 本番ドメイン（`advisor.takatsu-connect.com` 等のサブドメイン化）
- Fluid Compute の有効化タイミング（60秒で足りる限りは不要）
- GitHub Actions のタイムゾーン（現状UTC指定）
