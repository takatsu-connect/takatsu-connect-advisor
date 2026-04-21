/**
 * @jest-environment node
 *
 * src/lib/agents/orchestrator.ts の単体テスト
 *
 * テスト対象:
 *   - runOrchestratorStream(): Orchestrator エージェントをストリーミングで実行する AsyncGenerator
 *
 * モック戦略:
 *   - "server-only": 空オブジェクトでスタブ化（Next.js server-only import ガード回避）
 *   - "@/lib/claude/client": anthropic.messages.create を jest.fn() でモック
 *     - jest hoisting 問題を回避するため、factory 内で遅延参照パターンを使用
 *     - stream: true レスポンスは AsyncIterable を返す必要があるため makeMockStream ヘルパーで生成
 *   - "@/lib/env": getEnv() をモック化（client.ts 経由の依存解決のため）
 *   - "@/lib/claude/api-error": classifyApiError をモック化（シンプルな返却値）
 */

// ---------------------------------------------------------------------------
// モック定義（import より前に定義する必要がある）
// ---------------------------------------------------------------------------

jest.mock("server-only", () => ({}));

// anthropic.messages.create をモック可能にする
// jest.mock は hoisting されるため、mockMessagesCreate の参照は factory 内で遅延させる
const mockMessagesCreate = jest.fn();
jest.mock("@/lib/claude/client", () => ({
  anthropic: {
    messages: {
      create: (...args: unknown[]) => mockMessagesCreate(...args),
    },
  },
}));

// getEnv モック（client.ts 経由の依存）
jest.mock("@/lib/env", () => ({
  getEnv: jest.fn(() => ({ ANTHROPIC_API_KEY: "test-key" })),
}));

// classifyApiError モック（シンプルな返却値）
jest.mock("@/lib/claude/api-error", () => ({
  classifyApiError: (error: unknown) => "unknown",
}));

// ---------------------------------------------------------------------------
// インポート（モック定義の後）
// ---------------------------------------------------------------------------

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { runOrchestratorStream } from "@/lib/agents/orchestrator";
import type { OrchestratorEvent } from "@/lib/agents/orchestrator";
import type { AgentDefinition, SpecialistResult } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// テストヘルパー: AsyncIterable モック
// ---------------------------------------------------------------------------

/**
 * stream: true のレスポンスとして使用する AsyncIterable を生成する。
 * messages.create が stream: true の場合、AsyncIterable<RawMessageStreamEvent> を返す必要がある。
 */
function makeMockStream(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

/**
 * ストリーミング中にエラーを投げる AsyncIterable を生成する。
 */
function makeErrorStream(error: Error): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      throw error;
    },
  };
}

// ---------------------------------------------------------------------------
// テストヘルパー: ストリームイベント生成
// ---------------------------------------------------------------------------

/**
 * 標準的なストリームイベント列を生成するヘルパー。
 * message_start → content_block_start → content_block_delta(s) → content_block_stop → message_delta → message_stop
 */
function makeStreamEvents(
  textChunks: string[],
  opts?: {
    inputTokens?: number;
    cacheCreationInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    outputTokens?: number;
  },
): unknown[] {
  const {
    inputTokens = 100,
    cacheCreationInputTokens = 10,
    cacheReadInputTokens = 5,
    outputTokens = 50,
  } = opts ?? {};

  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: inputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cache_read_input_tokens: cacheReadInputTokens,
        },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ];

  for (const text of textChunks) {
    events.push({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    });
  }

  events.push({ type: "content_block_stop", index: 0 });
  events.push({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: outputTokens },
  });
  events.push({ type: "message_stop" });

  return events;
}

// ---------------------------------------------------------------------------
// テストヘルパー: AgentDefinition / SpecialistResult 生成
// ---------------------------------------------------------------------------

/** テスト用の最小 AgentDefinition を生成する */
function makeOrchestratorDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "orchestrator",
    displayName: "オーケストレーター",
    description: "専門家の結果を統合してストリーミング応答を生成する",
    role: "orchestrator",
    model: "claude-sonnet-4-6",
    systemPrompt: "あなたは統合エージェントです。",
    tools: [],
    filePath: "/prompts/agents/orchestrator.md",
    mtimeMs: Date.now(),
    temperature: 0.7,
    maxTokens: 2048,
    ...overrides,
  };
}

/** テスト用の最小 SpecialistResult を生成する */
function makeSpecialistResult(overrides?: Partial<SpecialistResult>): SpecialistResult {
  return {
    agent: "seo-specialist",
    displayName: "SEO専門家",
    status: "ok",
    summary: "SEO分析の結果です",
    toolCalls: [],
    latencyMs: 100,
    ...overrides,
  };
}

/** テスト用のメッセージ */
const testMessages: MessageParam[] = [{ role: "user", content: "SEOについて教えてください" }];

/**
 * AsyncGenerator を全件消費してイベント配列を返すヘルパー。
 */
async function collectEvents(
  gen: AsyncGenerator<OrchestratorEvent, void, unknown>,
): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const ev of gen) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// 共通セットアップ
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Section 1: 正常系（ストリーミング）
// ---------------------------------------------------------------------------

describe("runOrchestratorStream - 正常系", () => {
  test("1-1. 単一テキストチャンク: message_start + content_block_delta(text_delta 'Hello') + message_delta + message_stop → delta × 1, done（fullText='Hello', usage設定）", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["Hello"])));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    // delta × 1
    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents).toHaveLength(1);
    expect(deltaEvents[0]).toEqual({ type: "delta", text: "Hello" });

    // done が最後に来る
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.fullText).toBe("Hello");
      expect(doneEvent.usage).toBeDefined();
      expect(doneEvent.latencyMs).toBeGreaterThanOrEqual(0);
    }

    // error は出ない
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  test("1-2. 複数テキストチャンク: text_delta 'Hel', 'lo' 2件 → delta × 2、done の fullText='Hello'", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["Hel", "lo"])));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents).toHaveLength(2);
    expect(deltaEvents[0]).toEqual({ type: "delta", text: "Hel" });
    expect(deltaEvents[1]).toEqual({ type: "delta", text: "lo" });

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.fullText).toBe("Hello");
    }
  });

  test("1-3. text_delta以外のdelta無視: delta.type === 'input_json_delta' のようなtool_use系は無視される → delta 0件", async () => {
    const events_stream = [
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 50,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"key":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"value"}' },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 20 },
      },
      { type: "message_stop" },
    ];

    mockMessagesCreate.mockResolvedValue(makeMockStream(events_stream));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    // text_delta でないので delta イベントは 0件
    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents).toHaveLength(0);

    // done は来る（fullText は空文字）
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.fullText).toBe("");
    }
  });

  test("1-4. usage組立: message_start (input_tokens:100, cache_creation:10, cache_read:5) + message_delta (output_tokens:50) → done.usage = {input_tokens:100, output_tokens:50, cache_creation_input_tokens:10, cache_read_input_tokens:5}", async () => {
    mockMessagesCreate.mockResolvedValue(
      makeMockStream(
        makeStreamEvents(["text"], {
          inputTokens: 100,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 5,
          outputTokens: 50,
        }),
      ),
    );

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      });
    }
  });

  test("1-5. cache系null → 0 fallback: message_start で cache_creation/read が null → done.usage で 0 に変換", async () => {
    mockMessagesCreate.mockResolvedValue(
      makeMockStream(
        makeStreamEvents(["text"], {
          inputTokens: 80,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          outputTokens: 30,
        }),
      ),
    );

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.usage?.cache_creation_input_tokens).toBe(0);
      expect(doneEvent.usage?.cache_read_input_tokens).toBe(0);
    }
  });

  test("1-6. message_delta なしでストリーム終了 → done.usage === undefined、fullText === 'Hello'", async () => {
    // message_delta を含まないストリームイベント列
    const streamEvents = [
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      { type: "message_stop" },
    ];

    mockMessagesCreate.mockResolvedValue(makeMockStream(streamEvents));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    // delta × 1
    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents).toHaveLength(1);
    expect(deltaEvents[0]).toEqual({ type: "delta", text: "Hello" });

    // done が来る
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      // message_delta がないので usage は undefined
      expect(doneEvent.usage).toBeUndefined();
      // fullText は "Hello"
      expect(doneEvent.fullText).toBe("Hello");
    }

    // error は出ない
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 2: system prompt 構築
// ---------------------------------------------------------------------------

describe("runOrchestratorStream - system prompt 構築", () => {
  test("2-1. specialistResults 空配列 → messages.create の system が orchestrator.systemPrompt そのまま（XML 差し込みなし）", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const customSystemPrompt = "テスト用システムプロンプト";
    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ systemPrompt: customSystemPrompt }),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.system).toBe(customSystemPrompt);
  });

  test("2-2. specialistResults 1件 → system に <specialist_results>, <result agent='seo' status='ok'>summary</result>, </specialist_results> が含まれる", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const specialistResults: SpecialistResult[] = [
      makeSpecialistResult({ agent: "seo", status: "ok", summary: "SEO分析結果" }),
    ];

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ systemPrompt: "base prompt" }),
        messages: testMessages,
        specialistResults,
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    const system = callArg.system as string;

    expect(system).toContain("<specialist_results>");
    expect(system).toContain('<result agent="seo" status="ok">');
    expect(system).toContain("SEO分析結果");
    expect(system).toContain("</result>");
    expect(system).toContain("</specialist_results>");
    // base prompt も含まれる
    expect(system).toContain("base prompt");
  });

  test("2-3. specialistResults 複数件 → 複数の <result> が含まれる", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const specialistResults: SpecialistResult[] = [
      makeSpecialistResult({ agent: "seo", status: "ok", summary: "SEO結果" }),
      makeSpecialistResult({ agent: "data-analyst", status: "ok", summary: "データ分析結果" }),
    ];

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ systemPrompt: "base prompt" }),
        messages: testMessages,
        specialistResults,
      }),
    );

    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    const system = callArg.system as string;

    expect(system).toContain('<result agent="seo" status="ok">');
    expect(system).toContain("SEO結果");
    expect(system).toContain('<result agent="data-analyst" status="ok">');
    expect(system).toContain("データ分析結果");
  });

  test('2-4. XMLエスケープ: summary に < > & " が含まれる → それぞれ &lt; &gt; &amp; &quot; に変換される', async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const specialistResults: SpecialistResult[] = [
      makeSpecialistResult({
        agent: "seo",
        status: "ok",
        summary: 'summary with <tag> & "quoted" > chars',
      }),
    ];

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults,
      }),
    );

    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    const system = callArg.system as string;

    expect(system).toContain("&lt;tag&gt;");
    expect(system).toContain("&amp;");
    expect(system).toContain("&quot;quoted&quot;");
    // 生の < > & " が summary 部分に含まれないこと
    expect(system).not.toContain("summary with <tag>");
  });

  test("2-5. agent/statusのエスケープ: agent = 'Tom&Jerry' → agent='Tom&amp;Jerry'", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const specialistResults: SpecialistResult[] = [
      makeSpecialistResult({
        agent: "Tom&Jerry",
        status: "ok",
        summary: "summary",
      }),
    ];

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults,
      }),
    );

    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    const system = callArg.system as string;

    expect(system).toContain('agent="Tom&amp;Jerry"');
    expect(system).not.toContain('agent="Tom&Jerry"');
  });
});

// ---------------------------------------------------------------------------
// Section 3: エラーハンドリング
// ---------------------------------------------------------------------------

describe("runOrchestratorStream - エラーハンドリング", () => {
  test("3-1. API create 失敗: messages.create が throw → {type: 'error', error: 'API リクエスト失敗 ...'} を yield、その後 done は出ない", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("API connection failed"));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    if (events[0].type === "error") {
      expect(events[0].error).toContain("API リクエスト失敗");
      expect(events[0].error).toContain("API connection failed");
      expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
    }

    // done は出ない
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });

  test("3-2. ストリーミング中例外: for await 内で throw → {type: 'error', error: 'ストリーミング中にエラーが発生しました ...'} を yield", async () => {
    mockMessagesCreate.mockResolvedValue(
      makeErrorStream(new Error("stream error during iteration")),
    );

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    if (events[0].type === "error") {
      expect(events[0].error).toContain("ストリーミング中にエラーが発生しました");
      expect(events[0].error).toContain("stream error during iteration");
      expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("3-3. AbortSignal (事前aborted): signal.aborted=true で呼ぶ → ループ内で検知し {type: 'error', error: 'ストリーミングがキャンセルされました'} を yield", async () => {
    // signal.aborted=true な AbortSignal を作る
    const controller = new AbortController();
    controller.abort();
    const signal = controller.signal;

    // stream は1つ以上イベントを持つ（ループ内で signal チェックされる）
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["chunk1", "chunk2"])));

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
        signal,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBe("ストリーミングがキャンセルされました");
      expect(errorEvent.latencyMs).toBeGreaterThanOrEqual(0);
    }

    // done は出ない
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });

  test("3-4. ストリーミング中に signal.abort() → ループ次iterationでキャンセル検知（経路A境界）", async () => {
    // 実装 L163-172: for await の各iteration先頭で signal?.aborted をチェックする（経路A）
    // ストリームの途中で abort() を呼び、次のiterでキャンセルを検知することを確認する
    const controller = new AbortController();

    const mockStream: AsyncIterable<unknown> = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
            },
          },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "First" },
        };
        // 1件目の delta を yield した後に abort → 次のiterでキャンセル検知される
        controller.abort();
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Second" },
        };
        yield { type: "message_stop" };
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
        signal: controller.signal,
      }),
    );

    // "First" の delta は yield される（abort 前に処理済み）
    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents).toHaveLength(1);
    expect(deltaEvents[0]).toEqual({ type: "delta", text: "First" });

    // キャンセルエラーが出る
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBe("ストリーミングがキャンセルされました");
      expect(errorEvent.latencyMs).toBeGreaterThanOrEqual(0);
    }

    // done は出ない
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });

  test("3-5. AbortSignal 経路B (catchブロック): ストリーム中に SDK が throw + signal.aborted=true → catch で 'ストリーミングがキャンセルされました' を yield", async () => {
    // 実装 L198-208: for await ループが例外をthrowした場合の catch ブロック内で
    // signal?.aborted をチェックし、true なら「ストリーミングがキャンセルされました」を yield する（経路B）
    //
    // 再現方法: ストリーム中に throw する AsyncIterable を使い、
    // かつ signal をあらかじめ abort 済みにしておく
    const controller = new AbortController();
    controller.abort();

    const abortError = new Error("The user aborted a request.");
    const mockStream: AsyncIterable<unknown> = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 50,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
            },
          },
        };
        // ループ内でthrow → catch ブロックへ
        throw abortError;
      },
    };

    mockMessagesCreate.mockResolvedValue(mockStream);

    const events = await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
        signal: controller.signal,
      }),
    );

    // catch ブロックで signal.aborted === true → キャンセルメッセージ
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.error).toBe("ストリーミングがキャンセルされました");
      expect(errorEvent.latencyMs).toBeGreaterThanOrEqual(0);
    }

    // done は出ない
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 4: パラメータ
// ---------------------------------------------------------------------------

describe("runOrchestratorStream - パラメータ", () => {
  test("4-1. model 伝達: orchestrator.model が messages.create に渡る", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const customModel = "claude-haiku-4-5";
    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ model: customModel }),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe(customModel);
  });

  test("4-2. デフォルト max_tokens=2048 / temperature=0.7: maxTokens/temperature 未指定の場合", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ maxTokens: undefined, temperature: undefined }),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.max_tokens).toBe(2048);
    expect(callArg.temperature).toBe(0.7);
  });

  test("4-3. カスタム maxTokens=1024 / temperature=0.5: 指定値がそのまま渡る", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef({ maxTokens: 1024, temperature: 0.5 }),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.max_tokens).toBe(1024);
    expect(callArg.temperature).toBe(0.5);
  });

  test("4-4. stream: true が渡る", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.stream).toBe(true);
  });

  test("4-5. signal が第2引数 {signal} で渡る", async () => {
    mockMessagesCreate.mockResolvedValue(makeMockStream(makeStreamEvents(["ok"])));

    const controller = new AbortController();
    const signal = controller.signal;

    await collectEvents(
      runOrchestratorStream({
        orchestrator: makeOrchestratorDef(),
        messages: testMessages,
        specialistResults: [],
        signal,
      }),
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    // 第2引数として {signal} が渡されることを確認
    const secondArg = mockMessagesCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(secondArg).toBeDefined();
    expect(secondArg.signal).toBe(signal);
  });
});
