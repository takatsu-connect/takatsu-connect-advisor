# API 設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [アプリ構成](./app-architecture.md)
- [エージェントシステム設計](./agent-system-design.md)
- [プロンプト設計](./prompt-design.md)
- [DB設計](./db-design.md)
- [セキュリティ設計](./security-design.md)

---

## 1. エンドポイント一覧

すべて Next.js の Route Handlers (`route.ts`) で実装。Server Actions は使わない。

| メソッド | パス | 用途 | 認証 | ストリーミング |
|---|---|---|---|---|
| `POST` | `/api/chat` | チャット送信 + 3段階パイプライン | 必須 | **SSE** |
| `GET` | `/api/sessions` | セッション一覧 | 必須 | なし |
| `POST` | `/api/sessions` | セッション新規作成 | 必須 | なし |
| `GET` | `/api/sessions/:id/messages` | セッション内メッセージ取得 | 必須 | なし |
| `GET` | `/api/auth/callback` | OAuth コールバック | なし | なし |
| `POST` | `/api/auth/signout` | ログアウト | 必須 | なし |

すべて Node.js Runtime で動作（`export const runtime = 'nodejs'` を明記）。

---

## 2. 共通仕様

### 2.1 認証
- 全エンドポイント（`/api/auth/callback` 以外）は `@supabase/ssr` で Supabase セッションを取得し、無効なら `401` を返す
- 認証失敗時のレスポンス: `{ error: 'unauthorized' }` + 401

### 2.2 Content-Type
- 通常 API: `application/json`
- SSE: `text/event-stream`

### 2.3 CORS
- 同一オリジンのみ。CORS ヘッダは設定しない（Vercel の同一オリジン配信）

### 2.4 レート制限
- Phase 1 では実装しない（招待制・数名規模のため）
- 将来的に Vercel KV もしくは Supabase カウンタで実装する余地を残す

### 2.5 エラーレスポンス形式（ストリーム以外）
```json
{
  "error": "string",           // 短い識別子 (unauthorized / validation / internal 等)
  "message": "string",         // 人間向けメッセージ
  "details": { }               // 任意
}
```

### 2.6 リクエストバリデーション
- すべての POST リクエストは **zod** でスキーマ検証する
- 失敗時 `400 validation`

---

## 3. POST /api/chat（チャット送信・SSE）

### 3.1 概要
ユーザーのメッセージを受け取り、3段階パイプライン（分類 → 並列専門家 → 統合）の結果を SSE でストリーミングする。

### 3.2 ランタイム設定

```ts
// app/api/chat/route.ts
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
```

### 3.3 リクエスト

```http
POST /api/chat
Content-Type: application/json
Cookie: sb-access-token=...; sb-refresh-token=...

{
  "sessionId": "uuid | null",   // null なら新規セッション作成
  "message": "string",          // ユーザー入力
  "clientNonce": "string"       // 任意。リロード時の冪等性チェック用
}
```

zod スキーマ:
```ts
const ChatRequest = z.object({
  sessionId: z.string().uuid().nullable(),
  message: z.string().min(1).max(8000),
  clientNonce: z.string().max(64).optional(),
});
```

### 3.4 レスポンス（SSE）

`Content-Type: text/event-stream`
`Cache-Control: no-cache, no-transform`
`X-Accel-Buffering: no`

`event:` 行で種別、`data:` 行で JSON ペイロードを送る。

### 3.5 SSE イベント種別

| event | data スキーマ | 発生タイミング |
|---|---|---|
| `session` | `{ sessionId: string, messageId: string }` | セッション確定＋ユーザーメッセージ保存直後 |
| `status` | `{ phase: 'classify'\|'specialist'\|'orchestrate', text: string }` | 各フェーズ開始時 |
| `classification` | `{ specialists: string[], reasoning: string }` | 分類完了時 |
| `specialist_start` | `{ agent: string, displayName: string }` | 各専門家呼び出し開始時 |
| `specialist_result` | `{ agent: string, status: 'ok'\|'timeout'\|'error', summary: string, toolCalls: ToolCallLog[] }` | 各専門家完了時（並列） |
| `content` | `{ delta: string }` | Orchestrator のテキストチャンク |
| `usage` | `{ cacheReadTokens: number, cacheCreationTokens: number, inputTokens: number, outputTokens: number, contextCount: number }` | 統合完了直前 |
| `done` | `{ assistantMessageId: string }` | 完了通知 |
| `error` | `{ code: string, message: string, partial: boolean }` | エラー時 |

サンプルストリーム:
```
event: session
data: {"sessionId":"9f...","messageId":"a1..."}

event: status
data: {"phase":"classify","text":"質問を分析中..."}

event: classification
data: {"specialists":["seo-specialist","data-analyst"],"reasoning":"検索流入の数値確認"}

event: status
data: {"phase":"specialist","text":"SEO専門家、データ分析家に相談中..."}

event: specialist_start
data: {"agent":"seo-specialist","displayName":"SEO専門家"}

event: specialist_result
data: {"agent":"seo-specialist","status":"ok","summary":"直近28日のクリック数は...","toolCalls":[{"tool":"query_search_console","ms":742}]}

event: status
data: {"phase":"orchestrate","text":"統合中..."}

event: content
data: {"delta":"結論から言うと"}

event: content
data: {"delta":"、直近のオーガニック流入は"}

...

event: usage
data: {"cacheReadTokens":3200,"cacheCreationTokens":120,"inputTokens":450,"outputTokens":890,"contextCount":14}

event: done
data: {"assistantMessageId":"b7..."}
```

### 3.6 処理フロー（擬似コード）

```ts
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = ChatRequest.parse(await req.json());

  // 1. セッション確定
  const sessionId = body.sessionId ?? await createSession(supabase, user.id);

  // 2. ユーザーメッセージ保存
  const userMsg = await insertMessage(supabase, sessionId, 'user', body.message);

  // 3. 直近 N 件取得
  const history = await fetchRecentMessages(supabase, sessionId, CONTEXT_MESSAGE_LIMIT);

  // 4. ローカルキャッシュキー
  const cacheKey = hashRequest({ model, system, tools, messages: history });
  const cached = localCache.get(cacheKey);

  // 5. SSE ストリーム
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        send('session', { sessionId, messageId: userMsg.id });

        if (cached) {
          // キャッシュヒット時は最小イベントで再生
          await replayCached(cached, send);
          return;
        }

        // 分類フェーズ
        send('status', { phase: 'classify', text: '質問を分析中...' });
        const cls = await runClassifier(history);
        send('classification', cls);

        // 並列専門家フェーズ（Promise.race で 8秒タイムアウト）
        send('status', { phase: 'specialist', text: buildSpecialistStatus(cls.specialists) });
        const specialistResults = await Promise.all(
          cls.specialists.map(id =>
            runSpecialistWithTimeout(id, history, { onStart: () => send('specialist_start', ...) })
          )
        );
        for (const r of specialistResults) send('specialist_result', r);

        // 統合フェーズ（ストリーミング）
        send('status', { phase: 'orchestrate', text: '統合中...' });
        let assistantText = '';
        for await (const chunk of streamOrchestrator(history, specialistResults)) {
          assistantText += chunk.delta;
          send('content', chunk);
        }

        // DB に assistant 保存
        const assistantMsg = await insertMessage(supabase, sessionId, 'assistant', assistantText, {
          specialistTraces: specialistResults,
        });

        send('usage', collectUsageTokens());
        send('done', { assistantMessageId: assistantMsg.id });

        // ローカルキャッシュ更新
        localCache.set(cacheKey, { assistantText, specialistResults, cls }, LOCAL_CACHE_TTL_SECS);
      } catch (err) {
        console.error('[/api/chat] error', err);
        send('error', { code: 'internal', message: String(err), partial: false });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

### 3.7 タイムアウト戦略

| フェーズ | タイムアウト | 失敗時挙動 |
|---|---|---|
| Classifier | 5秒 | 既定の専門家セット（orchestrator のみ）で続行 |
| 各 Specialist | `SPECIALIST_TIMEOUT_MS`=8秒 (`Promise.race`) | その専門家を除外して統合へ |
| Orchestrator | 残り時間 - 2秒バッファ | 既受信分を保存し `error` イベント |
| 全体 | `maxDuration=60秒` | Vercel 側で強制終了（クライアントは切断検知） |

### 3.8 ローカル完全一致キャッシュ

- キー: `sha256(JSON.stringify({ model, system, tools, messages, classifierInput }))`
- 値: `{ classification, specialistResults, orchestratorText, createdAt }`
- TTL: `LOCAL_CACHE_TTL_SECS`（デフォルト30秒）
- 実装: `Map` + TTL（プロセス内のみ。Vercel では同一インスタンスでのみ有効）
- 同一リクエストはAPIコールせず擬似ストリームで即座に返却

### 3.9 クライアント側の受信（参考）

```ts
const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, message }) });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const events = parseSseEvents(buf); // "event: X\ndata: Y\n\n" をsplit
  for (const ev of events) handleEvent(ev);
  buf = events.tail;
}
```

詳細は [frontend-design.md](./frontend-design.md) 参照。

---

## 4. GET /api/sessions

### 4.1 リクエスト
```http
GET /api/sessions?limit=30&cursor=<ISO8601>
```

### 4.2 レスポンス
```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "string",
      "lastMessageAt": "2026-04-18T10:00:00Z",
      "messageCount": 14
    }
  ],
  "nextCursor": "2026-04-15T00:00:00Z | null"
}
```

### 4.3 挙動
- 自ユーザー分のみ（RLS 任せ + `eq('user_id', user.id)` ダブルチェック）
- `ORDER BY last_message_at DESC`

---

## 5. POST /api/sessions

### 5.1 リクエスト
```json
{
  "title": "string | null"   // null の場合は初回メッセージから自動生成
}
```

### 5.2 レスポンス
```json
{ "id": "uuid", "title": "string", "createdAt": "..." }
```

Phase 1 ではこのエンドポイントは `/api/chat` 内の自動作成と並行存在で、フロントからの明示作成は必須ではない（Phase 2 で UI から新規会話ボタン経由で使う想定）。

---

## 6. GET /api/sessions/:id/messages

### 6.1 リクエスト
```http
GET /api/sessions/:id/messages?limit=100
```

### 6.2 レスポンス
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user | assistant",
      "content": "string",
      "createdAt": "...",
      "specialistTraces": [
        { "agent": "seo-specialist", "status": "ok", "summary": "...", "toolCalls": [...] }
      ]
    }
  ]
}
```

`ORDER BY created_at ASC`、最大 200 件まで。

---

## 7. POST /api/auth/signout

### 7.1 処理
- `supabase.auth.signOut()` を呼び、Cookie を破棄
- `{ ok: true }` を返す
- クライアントは受信後 `/login` に遷移

---

## 8. GET /api/auth/callback

### 8.1 処理
- Google OAuth のコールバック URL
- クエリの `code` を `supabase.auth.exchangeCodeForSession(code)` でセッションに変換
- `/chat` にリダイレクト

---

## 9. Server Actions を使わない理由

| 事項 | Server Actions | API Routes (採用) |
|---|---|---|
| ストリーミング応答 | 不可（レスポンス完結後に返る） | `ReadableStream` で SSE 可能 |
| `maxDuration` 制御 | ページ単位の制約 | route.ts 単位で個別設定 |
| クライアント側の制御 | useFormStatus / useOptimistic | fetch + AbortController で細粒度 |

チャット主要経路は SSE が必須なため API Routes を選択する。

---

## 10. 未決定事項

- SSE 切断時のクライアント側再接続戦略（Phase 1 は切断＝失敗扱い）
- リロード時の進行中ストリーム復元（clientNonce を活かす設計）
- `/api/sessions` のページング方式（cursor vs. offset）はフロント実装時に再確認
- ブラウザ側 `EventSource` は POST をサポートしないため `fetch` 読み取りで確定、ヘッダ設定も `fetch` 経由で完結
