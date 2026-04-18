# マルチエージェントシステム 設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [プロンプト設計](./prompt-design.md)
- [API設計](./api-design.md)
- [アプリ構成](./app-architecture.md)
- [セキュリティ設計](./security-design.md)

---

## 1. アーキテクチャ概観

**オーケストレーター型 3段階パイプライン**（要件 3.3）:

```
 ┌────────┐   ┌─────────────────┐   ┌────────────────┐
 │ Classi │──▶│  Specialists    │──▶│  Orchestrator  │
 │ fier   │   │  (並列 Promise  │   │  (ストリーミング)│
 │(Haiku) │   │   .all)         │   │   (Sonnet)     │
 └────────┘   └─────────────────┘   └────────────────┘
   5s        各8s (Promise.race)    残り時間
```

- **Classifier** (Haiku 4.5): 呼ぶべき専門家を選定
- **Specialists** (Haiku 4.5 × N): 並列実行、各8秒タイムアウト、graceful degradation
- **Orchestrator** (Sonnet 4.6): 結果を統合しストリーミング応答

マルチモデル戦略の意図（要件 9）:
- 専門家は軽量 Haiku で十分な品質 + 並列実行で速度維持
- 統合は複雑な推論が必要なため Sonnet

モデルは環境変数 `CLASSIFIER_MODEL` / `SPECIALIST_MODEL` / `ORCHESTRATOR_MODEL` で個別切替。

---

## 2. ディレクトリとコード分離

```
src/lib/agents/
├── types.ts           ← AgentDefinition, PipelineContext, SpecialistResult 型
├── loader.ts          ← prompts/agents/*.md ローダー (fs + mtime キャッシュ)
├── registry.ts        ← ロード結果を管理
├── classifier.ts      ← Classifier 実行
├── specialist.ts      ← 単一専門家実行 + タイムアウト
├── orchestrator.ts    ← Orchestrator 実行 + ストリーミング
├── pipeline.ts        ← 3段階オーケストレーション
└── prompt-builder.ts  ← system / messages / tools 組み立て

src/lib/tools/
├── index.ts           ← ツール定義レジストリ
├── schemas.ts         ← 各ツールの input_schema
├── query-ga.ts
├── query-gsc.ts
├── fetch-wp-posts.ts
└── fetch-webpage.ts
```

---

## 3. AgentDefinition 型

```ts
// src/lib/agents/types.ts
export type AgentRole = 'classifier' | 'orchestrator' | 'specialist';

export interface AgentDefinition {
  name: string;              // "seo-specialist"
  displayName: string;       // "SEO専門家"
  description: string;       // カード表示・trace用の説明
  role: AgentRole;
  model: string;             // "claude-haiku-4-5" 等（未指定時は role ごとの env で解決）
  systemPrompt: string;      // include 展開済みの本文
  tools: string[];           // ["query_search_console", "fetch_webpage"]
  temperature?: number;
  maxTokens?: number;
  include?: string[];        // 参考情報として保持（再ロード検知用）
  filePath: string;          // ロード元
  mtimeMs: number;           // ホットリロード検知
}
```

---

## 4. エージェント定義ローダー

### 4.1 要件の再確認（要件 3.3.3 / 3.3.4）
- Markdown + YAML フロントマター
- `prompts/agents/*.md` にドロップするだけで認識
- 起動時スキャン・ホットリロード対応

### 4.2 採用方式: **リクエストごとに mtime チェック**

Next.js スペシャリストの助言に従い、**起動時一括読み込みではなく、リクエストごとに読み込み + mtimeキャッシュ**を採用する。

理由:
- Vercel Serverless では cold start とファイルシステムの状態が一致しないケースがある
- 開発時のホットリロード相当（mtime 差分で再読込）
- キャッシュはプロセスローカル `Map<filePath, AgentDefinition>`

### 4.3 実装方針（擬似コード）

```ts
// src/lib/agents/loader.ts
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import matter from 'gray-matter';

const FRONTMATTER_SCHEMA = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string(),
  description: z.string(),
  role: z.enum(['classifier','orchestrator','specialist']).default('specialist'),
  model: z.string().optional(),
  tools: z.array(z.string()).default([]),
  include: z.array(z.string()).default([]),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
});

const cache = new Map<string, AgentDefinition>();

export function loadAgent(filePath: string): AgentDefinition {
  const stat = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  const fm = FRONTMATTER_SCHEMA.parse(data);

  // include 解決
  const expanded = expandIncludes(content, fm.include); // prompts/shared/* を textで取り込む
  const agent: AgentDefinition = {
    ...fm,
    role: fm.role,
    systemPrompt: expanded,
    filePath,
    mtimeMs: stat.mtimeMs,
  };
  cache.set(filePath, agent);
  return agent;
}

export function loadAllAgents(dir = 'prompts/agents'): AgentDefinition[] {
  const full = path.join(process.cwd(), dir);
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.md'))
    .map(f => loadAgent(path.join(full, f)));
}

export function findAgent(name: string): AgentDefinition | null {
  const all = loadAllAgents();
  return all.find(a => a.name === name) ?? null;
}
```

### 4.4 include の展開

`expandIncludes(content, include)` は:
1. 前処理として `include` 配列の各パス（`shared/takatsu-connect.md` 等）を `prompts/` ルート基準で読み込む
2. 読み込んだテキストを **本文の先頭に prepend** する（または `<!--[[include:xxx]]-->` マーカー置換）
3. さらに本文中の `{{include:shared/xxx.md}}` という軽量マーカーもサポート（任意）

詳細は [prompt-design.md #3 include機構](./prompt-design.md#3-include-機構) を参照。

### 4.5 モデル解決ロジック

```ts
function resolveModel(agent: AgentDefinition): string {
  if (agent.model) return agent.model;
  switch (agent.role) {
    case 'classifier':   return env.CLASSIFIER_MODEL;
    case 'orchestrator': return env.ORCHESTRATOR_MODEL;
    case 'specialist':
    default:             return env.SPECIALIST_MODEL;
  }
}
```

### 4.6 バリデーションスクリプト

`scripts/validate-agents.ts`:
- すべての `prompts/agents/*.md` をロードし、スキーマ検証
- `include` パスの実在チェック
- `tools` が `src/lib/tools` に登録済みかチェック
- `role === 'classifier'` は1件のみであること
- `role === 'orchestrator'` は1件のみであること
- エラーがあれば exit 1

`package.json` の scripts に `"validate-agents": "tsx scripts/validate-agents.ts"` として登録し、CI で実行する。

---

## 5. ツール定義

### 5.1 一覧（要件 3.4）

| ツール名 | 入力 | 出力 | タイムアウト |
|---|---|---|---|
| `query_google_analytics` | `{dateRange, dimensions[], metrics[], filters?}` | GAレポートJSON | 5s |
| `query_search_console` | `{startDate, endDate, dimensions[], rowLimit?}` | GSCレポートJSON | 5s |
| `fetch_wp_posts` | `{search?, slug?, perPage, page, orderby?}` | 投稿配列 | 5s |
| `fetch_webpage` | `{url}` | `{status, title, description, h1[], textSnippet}` | 5s |

`consult_specialist` は **採用しない**（要件 9「オーケストレーターが直接統合」のシンプル優先方針）。

### 5.2 input_schema（Claude tool_use 形式）

```ts
// src/lib/tools/schemas.ts
export const toolSchemas = {
  query_search_console: {
    name: 'query_search_console',
    description: 'Google Search Consoleから検索クエリ・流入データを取得する。',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'YYYY-MM-DD' },
        dimensions: {
          type: 'array',
          items: { enum: ['query','page','country','device','date'] },
          description: '集計次元',
        },
        rowLimit: { type: 'integer', minimum: 1, maximum: 500, default: 25 },
      },
      required: ['startDate','endDate','dimensions'],
    },
  },
  // ... 他ツール
} as const;
```

### 5.3 実行アダプタ

```ts
// src/lib/tools/index.ts
export type ToolExecutor = (input: unknown, ctx: ToolContext) => Promise<unknown>;

export const toolExecutors: Record<string, ToolExecutor> = {
  query_google_analytics: queryGA,
  query_search_console:   queryGSC,
  fetch_wp_posts:         fetchWpPosts,
  fetch_webpage:          fetchWebpage,
};

export async function runTool(name: string, input: unknown, ctx: ToolContext) {
  const exec = toolExecutors[name];
  if (!exec) throw new Error(`unknown tool: ${name}`);
  const started = Date.now();
  try {
    const result = await withTimeout(exec(input, ctx), TOOL_TIMEOUT_MS);
    return { ok: true, result, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: String(err), latencyMs: Date.now() - started };
  }
}
```

### 5.4 セキュリティ（fetch_webpage）

詳細は [security-design.md #7 外部API](./security-design.md#7-外部-api-呼び出しのリスク) を参照。
- スキーマ `http/https` のみ
- プライベートIP 拒否
- 3MB 上限
- タイムアウト 5秒
- User-Agent: `takatsu-connect-advisor/1.0`

---

## 6. Classifier 実行

### 6.1 責務
ユーザー最新質問 + 直近履歴を読み、**呼ぶべき専門家の名前配列**を返す。

### 6.2 入出力
- 入力: 直近メッセージ配列（N=20件上限）
- 出力: `{ specialists: string[], reasoning: string }`

### 6.3 実装方針
- Claude API で **tool_use ではなく JSON 構造化応答** で返させる（tool_useより軽量・速い）
- プロンプトで出力スキーマを明示:
  ```
  回答は次のJSONのみで返すこと:
  { "specialists": ["agent-name", ...], "reasoning": "短い理由" }
  ```
- 専門家名は `prompts/agents/*.md` の `name` と一致するもののみ許可
- 許可リストに存在しない名前は捨てる
- 空配列の場合は `orchestrator` のみで回答する（専門家なし）

### 6.4 パラメータ
- `model`: `env.CLASSIFIER_MODEL`（Haiku 4.5）
- `max_tokens`: 256
- `temperature`: 0.2（分類は決定論寄り）
- タイムアウト: 5秒

### 6.5 失敗時フォールバック
- タイムアウト or パース失敗 → `{ specialists: [], reasoning: 'classifier失敗のため統合のみで応答' }`

---

## 7. Specialist 実行

### 7.1 責務
担当領域の知見 + tool_use を駆使して、要点（中間回答）を返す。

### 7.2 入出力
- 入力: 直近履歴 + Classifier の reasoning（任意コンテキスト）
- 出力: `SpecialistResult`
  ```ts
  type SpecialistResult = {
    agent: string;
    displayName: string;
    status: 'ok' | 'timeout' | 'error' | 'skipped';
    summary: string;               // LLMの最終テキスト
    toolCalls: ToolCallLog[];      // 呼び出されたツールの記録
    latencyMs: number;
    usage?: ClaudeUsage;
  };
  ```

### 7.3 tool_use ループ

```ts
async function runSpecialist(agent: AgentDefinition, history: Message[]): Promise<SpecialistResult> {
  const messages = toClaudeMessages(history);
  const tools = agent.tools.map(t => toolSchemas[t]);
  const started = Date.now();
  const calls: ToolCallLog[] = [];

  let currentMessages = messages;
  const MAX_ITERATIONS = 3; // 無限ループ対策
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await claude.messages.create({
      model: resolveModel(agent),
      system: buildSystem(agent),
      tools,
      messages: currentMessages,
      max_tokens: agent.maxTokens ?? 1024,
      temperature: agent.temperature ?? 0.7,
    });

    if (res.stop_reason === 'end_turn') {
      return { agent: agent.name, displayName: agent.displayName, status: 'ok',
               summary: extractText(res), toolCalls: calls, latencyMs: Date.now()-started, usage: res.usage };
    }
    if (res.stop_reason === 'tool_use') {
      const toolUses = res.content.filter(c => c.type === 'tool_use');
      // 並列でツール実行
      const results = await Promise.all(toolUses.map(tu => runTool(tu.name, tu.input, ctx)));
      for (const [tu, r] of zip(toolUses, results)) calls.push({tool: tu.name, input: tu.input, ok: r.ok, ms: r.latencyMs});
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: res.content },
        { role: 'user', content: toolUses.map((tu,j) => ({
            type: 'tool_result', tool_use_id: tu.id,
            content: JSON.stringify(results[j].ok ? results[j].result : { error: results[j].error }),
          }))},
      ];
      continue;
    }
    // 想定外のstop_reason
    return { agent: agent.name, displayName: agent.displayName, status: 'error',
             summary: 'stop_reason: '+res.stop_reason, toolCalls: calls, latencyMs: Date.now()-started };
  }
  return { agent: agent.name, displayName: agent.displayName, status: 'error',
           summary: 'tool_use ループが上限に達しました', toolCalls: calls, latencyMs: Date.now()-started };
}
```

### 7.4 ツール並列化
- 1回の応答で複数の `tool_use` が返った場合、**`Promise.all` で並列実行**
- claw-code の学びを反映

### 7.5 タイムアウト（Promise.race）
```ts
async function runSpecialistWithTimeout(agent: AgentDefinition, history: Message[]) {
  return Promise.race([
    runSpecialist(agent, history),
    new Promise<SpecialistResult>(resolve =>
      setTimeout(() => resolve({
        agent: agent.name, displayName: agent.displayName, status: 'timeout',
        summary: 'タイムアウトしました', toolCalls: [], latencyMs: SPECIALIST_TIMEOUT_MS,
      }), env.SPECIALIST_TIMEOUT_MS),
    ),
  ]);
}
```

### 7.6 Graceful degradation
- タイムアウト / エラー になった専門家は `status` 付きで結果に含める
- Orchestrator には `status: 'ok'` のもののみ入力する（ノイズを排除）
- すべて失敗しても Orchestrator は呼ぶ（知識ベースのみで回答）

---

## 8. Orchestrator 実行

### 8.1 責務
Specialist の結果配列 + 履歴を受け、ユーザーへの**統合応答**を**ストリーミング**で生成。

### 8.2 入力構成

system プロンプトに Specialists の結果を **整形テキスト**として差し込む:
```
<specialist_results>
<result agent="seo-specialist" status="ok">
  直近28日のオーガニッククリックは...
</result>
<result agent="data-analyst" status="ok">
  GAのセッション推移は...
</result>
</specialist_results>
```

ユーザー履歴（`CONTEXT_MESSAGE_LIMIT=20`）は `messages` に渡す。

### 8.3 パラメータ
- `model`: `env.ORCHESTRATOR_MODEL`（Sonnet 4.6）
- `max_tokens`: 2048
- `temperature`: 0.7
- ストリーミング有効（`stream: true`）
- タイムアウト: `maxDuration(60) - 経過時間 - 2秒バッファ`

### 8.4 ストリーミングの変換
Anthropic SSE → プロジェクト独自 SSE に変換（詳細は [api-design.md](./api-design.md#3-post-apichat) の `content` イベント）。

```ts
for await (const event of claude.messages.stream({...})) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield { delta: event.delta.text };
  }
}
```

---

## 9. パイプライン制御

### 9.1 エントリポイント

```ts
// src/lib/agents/pipeline.ts
export async function* runChatPipeline(input: {
  history: Message[];
  user: { id: string };
  emit: (event: string, data: any) => void;
}) {
  const { history, emit } = input;

  // 1. Classifier
  emit('status', { phase: 'classify', text: '質問を分析中...' });
  const classifier = findAgent('classifier');
  const cls = await runClassifier(classifier, history);
  emit('classification', cls);

  // 2. Specialists（並列）
  const agents = cls.specialists.map(findAgent).filter(Boolean);
  if (agents.length > 0) {
    emit('status', { phase: 'specialist', text: buildStatusText(agents) });
    agents.forEach(a => emit('specialist_start', { agent: a.name, displayName: a.displayName }));
    const results = await Promise.all(agents.map(a => runSpecialistWithTimeout(a, history)));
    for (const r of results) emit('specialist_result', r);
    var okResults = results.filter(r => r.status === 'ok');
  } else {
    var okResults = [];
  }

  // 3. Orchestrator (ストリーミング)
  emit('status', { phase: 'orchestrate', text: '統合中...' });
  const orch = findAgent('orchestrator');
  let fullText = '';
  for await (const chunk of streamOrchestrator(orch, history, okResults)) {
    fullText += chunk.delta;
    emit('content', chunk);
  }
  return { text: fullText, specialistResults: okResults, classification: cls };
}
```

### 9.2 Prompt Caching 有効化

`claude.messages.create` の `system` と `tools` 配列の末尾に `cache_control: { type: 'ephemeral' }` を指定する。

詳細は [prompt-design.md #5 Prompt Caching](./prompt-design.md#5-prompt-caching-戦略) 参照。

### 9.3 ローカル完全一致キャッシュ

`/api/chat` 呼び出しの冒頭でキャッシュキーを計算:
```ts
const key = sha256(JSON.stringify({
  model: env.ORCHESTRATOR_MODEL,
  system: <最終system文字列>,
  tools: <ツール定義配列>,
  messages: history,
}));
const cached = localCache.get(key);
```

- キャッシュヒット時は擬似ストリームを再生（`content` イベントを小分けで送る）
- Miss 時は通常実行、完了後に `set(key, payload, LOCAL_CACHE_TTL_SECS)`

実装: `src/lib/claude/cache.ts`

```ts
class LocalCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  get(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { this.store.delete(key); return null; }
    return e.value;
  }
  set(key: string, value: T, ttlSecs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSecs * 1000 });
  }
}
export const localCache = new LocalCache<CachedChatResult>();
```

**注意**: Vercel の Serverless は複数インスタンスに分散するためキャッシュは必ずしも共有されない。効果は同一インスタンスへのリロード連打に限定されるが、それで十分な効果が得られる（要件 9）。

---

## 10. エージェント追加フロー

非エンジニアが新しい専門家を追加する手順:
1. `prompts/agents/new-specialist.md` を作成（既存のフロントマター雛形をコピー）
2. `description`, `displayName`, `systemPrompt` を書く
3. 必要なら `tools`, `include` を追記
4. `pnpm validate-agents` で検証
5. コミット & デプロイ（`prompts/` はコード変更なしで反映）
6. Classifier プロンプトの選択肢リストを更新（詳細は [prompt-design.md](./prompt-design.md)）

---

## 11. 未決定事項

- `MAX_ITERATIONS` の値（初期は 3、不足なら 5 に拡張）
- 専門家が他の専門家を呼べる `consult_specialist` を Phase 2 で入れるか
- Classifier で「回答に必要な情報がない」と判断した時のフォールバック（検索系ツールを強制呼び出しする等）
- Streaming 切断時の orchestrator 途中結果の保存精度
- Vercel の複数インスタンスでキャッシュ共有が必要になった場合の Vercel KV / Upstash Redis 検討
