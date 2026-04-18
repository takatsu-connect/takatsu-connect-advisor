# フロントエンド設計書

## 関連ドキュメント
- [設計概要](./overview.md)
- [アプリ構成](./app-architecture.md)
- [API設計](./api-design.md)
- [スタイリング設計](./styling-design.md)
- [セキュリティ設計](./security-design.md)

---

## 1. 基本方針

- **Next.js App Router** による Server Component デフォルト、必要箇所のみ `"use client"`
- **CSS Modules + CSS Custom Properties**（Tailwind 禁止: `.claude/rules/no-tailwind.md`）
- **レスポンシブ**: モバイルファースト、ブレークポイントは [styling-design.md](./styling-design.md)
- **状態管理**: React 標準のみ（Zustand等は Phase 2 で検討）
- **アクセシビリティ**: セマンティックHTML、キーボード操作、タッチ44x44px 最小
- **国際化**: 日本語のみ（i18n なし）

---

## 2. ページ遷移とレイアウト

```
/ (ルート)                           → Server: redirect('/chat')

/login  (auth)/layout.tsx            → ログイン中なら /chat に redirect
  └─ page.tsx                         → LoginForm + GoogleLoginButton

/chat   (main)/layout.tsx            → 未ログインなら /login に redirect
  └─ page.tsx (Server Component)     → 初期データ取得（最新セッションID、直近メッセージ）
      └─ <ChatWindow> (Client)       → 全体の統括
          ├─ <MessageList>
          │   └─ <MessageBubble> × N
          │       └─ <SpecialistTrace> (assistant のみ折りたたみ)
          ├─ <ContextProgressBar>
          ├─ <StatusIndicator>       (SSE の status イベント表示)
          └─ <MessageInput>
```

### 2.1 ルートレイアウト (`app/layout.tsx`)

```tsx
// Server Component
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```
CSS 変数は `src/styles/tokens.css` を `globals.css` で import する。

### 2.2 (auth)/layout.tsx

Server Component。ログイン済みなら `/chat` にリダイレクト。

```tsx
export default async function AuthLayout({ children }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/chat');
  return <div className={styles.authShell}>{children}</div>;
}
```

### 2.3 (main)/layout.tsx

Server Component。未ログインなら `/login` にリダイレクト。

```tsx
export default async function MainLayout({ children }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return (
    <UserContextProvider value={{ id: user.id, email: user.email! }}>
      <div className={styles.mainShell}>{children}</div>
    </UserContextProvider>
  );
}
```

### 2.4 chat/page.tsx（Server Component）

```tsx
export default async function ChatPage() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const sessionRow = await getOrCreateLatestSession(supabase, user!.id);
  const messages = await fetchMessages(supabase, sessionRow.id, 50);

  return <ChatWindow initialSessionId={sessionRow.id} initialMessages={messages} />;
}
```

- 初期セッションの取得・メッセージ取得はサーバー側で一括
- `ChatWindow` に props として渡す
- これにより初回描画時はデータが揃った状態で表示される（FOUC 回避）

---

## 3. 主要コンポーネント設計

### 3.1 `<ChatWindow>` (Client Component)

責務:
- `useChatStream` を使った送受信
- セッション管理（currentSessionId）
- エラー表示・再送信

Props:
```ts
type ChatWindowProps = {
  initialSessionId: string;
  initialMessages: Message[];
};
```

Layout:
```
┌───────────────────────────────┐
│  Header (ユーザー名/ログアウト)  │
├───────────────────────────────┤
│                               │
│  <MessageList>  (scrollable)  │
│                               │
├───────────────────────────────┤
│  <StatusIndicator>            │
│  <ContextProgressBar>         │
│  <MessageInput>               │
└───────────────────────────────┘
```

### 3.2 `<MessageList>`

責務:
- メッセージ配列の描画
- 自動スクロール（末尾に張り付く、ユーザーが上スクロール中は停止）
- 新規メッセージのフェードイン

Props:
```ts
type MessageListProps = {
  messages: Message[];
  streamingDelta: string | null;   // Orchestrator が生成中のテキスト
};
```

実装メモ:
- 末尾の assistant メッセージは `streamingDelta` をマージして表示
- `useEffect` + `scrollTop` で自動スクロール制御
- 長いセッションでの仮想化は Phase 2 検討（まずは 200件固定）

### 3.3 `<MessageBubble>`

Props:
```ts
type MessageBubbleProps = {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  traces?: SpecialistTrace[];
  isStreaming?: boolean;
};
```

- `role` に応じて左右のレイアウト分け
- `content` は Markdown レンダリング（`react-markdown` + サニタイズ or 自前の軽量 renderer）
- `traces` があれば折りたたみ `<SpecialistTrace>` を下に表示

### 3.4 `<SpecialistTrace>`

責務: 専門家の中間回答を折りたたみ表示（`<details>`）。

```tsx
<details className={styles.trace}>
  <summary>{displayName} ({status})</summary>
  <p>{summary}</p>
  <ul>{toolCalls.map(tc => <li key={tc.id}>{tc.tool} ({tc.ms}ms)</li>)}</ul>
</details>
```

### 3.5 `<ContextProgressBar>`

要件 3.5.3 に準拠し、ごく簡単な視覚的ヒントのみ。

```tsx
// 入力欄の直上、または画面端の細いライン
<div className={styles.progress} role="progressbar"
     aria-valuemin={0} aria-valuemax={limit} aria-valuenow={count}>
  <div className={styles.progressFill} style={{ width: `${(count/limit)*100}%` }} />
</div>
```

- 数値・ラベル表示なし
- 高さ 2〜4px
- `aria-label="コンテキスト使用量"` のみで可視数値は非表示

### 3.6 `<StatusIndicator>`

SSE の `status` / `specialist_start` イベントに応じて「◯◯専門家に相談中...」と表示。
- 進行中は薄いドットアニメーション
- `done` 受信時に非表示

### 3.7 `<MessageInput>`

責務: 入力、送信、IME 対応。

- 多行対応: `<textarea>` + `auto-resize`
- Enter = 送信、Shift+Enter = 改行、IME 変換中の Enter は送信しない
- モバイル: 送信ボタン別途表示（Enter で改行）
- Disabled 制御: `isStreaming` の間は送信不可

```tsx
<form onSubmit={handleSubmit} className={styles.form}>
  <textarea
    value={text}
    onChange={(e) => setText(e.target.value)}
    onKeyDown={onKeyDown}
    onCompositionStart={() => (composingRef.current = true)}
    onCompositionEnd={() => (composingRef.current = false)}
    placeholder="質問を入力..."
    rows={1}
    disabled={isStreaming}
  />
  <button type="submit" disabled={isStreaming || !text.trim()}>送信</button>
</form>
```

---

## 4. SSE 受信フック `useChatStream`

```ts
// src/hooks/useChatStream.ts
export function useChatStream(initialSessionId: string, initialMessages: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setStreaming] = useState(false);
  const [streamingDelta, setStreamingDelta] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [traces, setTraces] = useState<SpecialistTrace[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function sendMessage(text: string) {
    if (isStreaming) return;
    abortRef.current = new AbortController();
    setStreaming(true);
    setStreamingDelta('');
    setStatus(null);
    setTraces([]);
    setError(null);

    // 楽観的追加
    const tempUserMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages(m => [...m, tempUserMsg]);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: initialSessionId, message: text, clientNonce: tempUserMsg.id }),
      signal: abortRef.current.signal,
    });
    if (!res.ok || !res.body) { setError(new Error('送信に失敗しました')); setStreaming(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSse(buffer);
        buffer = rest;
        for (const ev of events) {
          switch (ev.event) {
            case 'status':            setStatus(ev.data.text); break;
            case 'specialist_start':  setStatus(`${ev.data.displayName}に相談中...`); break;
            case 'specialist_result': setTraces(t => [...t, ev.data]); break;
            case 'content':           setStreamingDelta(d => (d ?? '') + ev.data.delta); break;
            case 'done':              /* 成功時は下で確定 */ break;
            case 'error':             setError(new Error(ev.data.message)); break;
          }
        }
      }
      // 確定
      setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', content: streamingDeltaRef.current ?? '', createdAt: new Date().toISOString(), traces }]);
    } finally {
      setStreaming(false);
      setStreamingDelta(null);
      setStatus(null);
    }
  }

  function cancel() { abortRef.current?.abort(); }

  return { messages, isStreaming, streamingDelta, status, traces, error, sendMessage, cancel };
}
```

（擬似コード。実装時に小さなリファクタが発生しうる）

---

## 5. レスポンシブ方針

### 5.1 ブレークポイント（詳細は [styling-design.md](./styling-design.md)）
- モバイル: `~ 640px`
- タブレット: `641px ~ 1024px`
- デスクトップ: `1025px ~`

### 5.2 各デバイスでの振る舞い

| 要素 | モバイル | タブレット/PC |
|---|---|---|
| `<ChatWindow>` | 全画面（100dvh） | センタリング、最大幅 960px |
| `<MessageList>` | flex: 1; overflow-y: auto | 同左 |
| `<MessageBubble>` | `max-width: 88%` | `max-width: 72%` |
| `<MessageInput>` | 下部固定、safe-area 考慮 | 下部 padded |
| 送信ボタン | 常時表示 | 入力中のみ高コントラスト |
| `<ContextProgressBar>` | 入力欄の直上、高さ 2px | 同左、または画面右端 |
| `<SpecialistTrace>` | 折りたたみ、full-width | インライン、max-width 制限 |
| タッチ領域 | 44×44px 以上 | 32×32px でも可 |

### 5.3 iOS Safari 対応
- `100vh` ではなく `100dvh` を使う（アドレスバー表示変動対応）
- 入力欄はキーボード表示時に隠れないよう `position: sticky; bottom: 0` + `env(safe-area-inset-bottom)`
- IME 変換中の Enter 誤送信防止（上記 `MessageInput` 参照）

### 5.4 自動スクロールの安全装置
- ユーザーがスクロールを上にずらしたら、ストリーム中でも自動スクロールを停止
- 停止中は「最新へ戻る」ボタンを表示（右下フローティング）

---

## 6. エラーハンドリング UI

| シナリオ | UI |
|---|---|
| 送信失敗（ネットワーク） | トースト「送信に失敗しました。もう一度お試しください」 |
| 認証失効 (401) | `/login?error=session_expired` にリダイレクト |
| SSE 途中切断 | 部分メッセージを保持し、末尾に「応答が途中で切れました」表示 |
| 全専門家タイムアウト | Orchestrator が「情報取得できませんでした」と応答を返すため専用UIなし |
| クライアント側 JS エラー | `error.tsx` でリロード案内 |

`app/(main)/error.tsx` を設置し、汎用エラーページを用意する。

---

## 7. アクセシビリティ

- `<main>`, `<header>`, `<form>` 等のランドマーク使用
- `<button>` vs. `<a>` の正しい使い分け
- 各メッセージは `role="article"` + `aria-label="ユーザーのメッセージ"` / `aria-label="アドバイザーのメッセージ"`
- `aria-live="polite"` を assistant 応答領域に付与しスクリーンリーダー読み上げ
- フォーカスリング消去禁止（`:focus-visible` で強調）
- コントラスト比 4.5:1 以上（[styling-design.md](./styling-design.md) 参照）

---

## 8. Markdown レンダリング

- `react-markdown` + `rehype-sanitize` を採用（XSS 対策）
- 許可タグ: `p, strong, em, ul, ol, li, code, pre, a, h2, h3, blockquote, br`
- 外部リンクは `target="_blank" rel="noopener noreferrer"`
- コードブロックは背景グレー + 等幅フォント（シンタックスハイライトは Phase 2）

---

## 9. テスト方針（抜粋、詳細は `.claude/rules/mandatory-testing.md`）

| コンポーネント/フック | テスト手段 |
|---|---|
| `MessageBubble` | Jest + RTL（role、Markdown 描画） |
| `MessageInput` | RTL（IME・Shift+Enter・送信ハンドラ） |
| `useChatStream` | Jest（fetch モック、ReadableStream モック） |
| `<ChatWindow>` 全体 | Playwright（実際のSSEパイプラインは BE のモックAPI） |
| レスポンシブ崩れ | Playwright visual snapshot（モバイル/タブレット/PC） |

---

## 10. 未決定事項

- `react-markdown` vs. 自前の軽量 Markdown パーサ（バンドルサイズ vs. 機能）
- 画像・ファイル添付の将来計画（現状は扱わない）
- ショートカット（Ctrl+Enter で送信など）の要否
- 過去セッション一覧UIのPhase 1 での見せ方（サイドバー vs. ヘッダードロップダウン vs. モーダル）
