/**
 * @jest-environment node
 *
 * src/lib/agents/specialist.ts の単体テスト
 *
 * テスト対象:
 *   - runSpecialist(): tool_use ループ本体（MAX_ITERATIONS=3、並列実行）
 *   - runSpecialistWithTimeout(): 8秒デフォルトタイムアウト付きラッパー
 *
 * モック戦略:
 *   - "server-only": 空オブジェクトでスタブ化（Next.js server-only import ガード回避）
 *   - "@/lib/claude/client": anthropic.messages.create を jest.fn() でモック
 *     - jest hoisting 問題を回避するため、factory 内で遅延参照パターンを使用
 *   - "@/lib/env": getEnv() をモック化（client.ts の依存解決のため）
 *   - "@/lib/claude/api-error": classifyApiError をモック化
 *   - jest.useFakeTimers(): タイムアウトテストで実時間待機を省略
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

// classifyApiError モック
const mockClassifyApiError = jest.fn((error: unknown) => {
  if (error instanceof Error) return error.message;
  return "unknown";
});
jest.mock("@/lib/claude/api-error", () => ({
  classifyApiError: (...args: unknown[]) => mockClassifyApiError(...args),
}));

// ---------------------------------------------------------------------------
// インポート（モック定義の後）
// ---------------------------------------------------------------------------

import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { runSpecialist, runSpecialistWithTimeout } from "@/lib/agents/specialist";
import type { AgentDefinition } from "@/lib/agents/types";
import type { RunToolFn, ToolRunContext } from "@/lib/agents/specialist";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** テスト用の最小 AgentDefinition を生成する */
function makeAgentDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "seo-specialist",
    displayName: "SEO専門家",
    description: "SEOに関する専門家",
    role: "specialist",
    model: "claude-sonnet-4-6",
    systemPrompt: "あなたはSEO専門家です。",
    tools: [],
    filePath: "/prompts/agents/seo-specialist.md",
    mtimeMs: Date.now(),
    temperature: 0.5,
    maxTokens: 4096,
    ...overrides,
  };
}

/** end_turn レスポンスを生成する */
function makeEndTurnResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  };
}

/** tool_use レスポンスを生成する */
function makeToolUseResponse(toolUses: Array<{ id: string; name: string; input: unknown }>) {
  return {
    content: toolUses.map((tu) => ({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    })),
    stop_reason: "tool_use",
    usage: {
      input_tokens: 80,
      output_tokens: 30,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 2,
    },
  };
}

/** テスト用の最小 Tool 定義 */
function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} ツール`,
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  };
}

/** 常に成功する runTool モック */
function makeSuccessRunTool(resultValue: unknown = "tool result"): RunToolFn {
  return jest.fn().mockResolvedValue({
    ok: true,
    result: resultValue,
    latencyMs: 100,
  });
}

/** 常に失敗する runTool モック */
function makeFailRunTool(errorMessage = "tool error"): RunToolFn {
  return jest.fn().mockResolvedValue({
    ok: false,
    error: errorMessage,
    latencyMs: 50,
  });
}

/** テスト用の ToolRunContext */
const testToolContext: ToolRunContext = {
  userId: "user-123",
  sessionId: "session-456",
};

/** テスト用のメッセージ */
const testMessages = [{ role: "user" as const, content: "SEOを改善するには？" }];

// ---------------------------------------------------------------------------
// 共通セットアップ
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Section 1: runSpecialist 正常系
// ---------------------------------------------------------------------------

describe("runSpecialist - 正常系", () => {
  test("1-1. 単一ターン（end_turn）: status: ok、summary が text ブロックの内容になる", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("SEO改善のポイントは..."));

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("ok");
    expect(result.summary).toBe("SEO改善のポイントは...");
    expect(result.agent).toBe("seo-specialist");
    expect(result.displayName).toBe("SEO専門家");
    expect(result.toolCalls).toEqual([]);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("1-2. 複数ターン（tool_use → end_turn）: status: ok、toolCalls が記録されている", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([{ id: "tu-1", name: "search_tool", input: { query: "SEO" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse("ツール結果を踏まえた回答"));

    const runTool = makeSuccessRunTool("検索結果");

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("search_tool")],
      runTool,
      toolContext: testToolContext,
    });

    expect(result.status).toBe("ok");
    expect(result.summary).toBe("ツール結果を踏まえた回答");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("search_tool");
    expect(result.toolCalls[0].ok).toBe(true);
  });

  test("1-3. 並列ツール実行: 1回目レスポンスに tool_use が2つ → 次ターンに両方の tool_result が送られる", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: "tu-1", name: "tool_a", input: { key: "a" } },
          { id: "tu-2", name: "tool_b", input: { key: "b" } },
        ]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse("並列ツール実行の結果"));

    const runTool = makeSuccessRunTool("result");

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("tool_a"), makeTool("tool_b")],
      runTool,
      toolContext: testToolContext,
    });

    // runTool が2回並列で呼ばれた
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(runTool).toHaveBeenCalledWith("tool_a", { key: "a" }, testToolContext);
    expect(runTool).toHaveBeenCalledWith("tool_b", { key: "b" }, testToolContext);

    // 2ターン目の messages.create の引数を確認
    const secondCallArg = mockMessagesCreate.mock.calls[1][0] as {
      messages: { role: string; content: unknown[] }[];
    };
    const lastUserMessage = secondCallArg.messages[secondCallArg.messages.length - 1];
    expect(lastUserMessage.role).toBe("user");
    expect(Array.isArray(lastUserMessage.content)).toBe(true);
    const userContent = lastUserMessage.content as { type: string; tool_use_id: string }[];
    expect(userContent).toHaveLength(2);
    expect(userContent[0].type).toBe("tool_result");
    expect(userContent[0].tool_use_id).toBe("tu-1");
    expect(userContent[1].type).toBe("tool_result");
    expect(userContent[1].tool_use_id).toBe("tu-2");

    expect(result.status).toBe("ok");
    expect(result.toolCalls).toHaveLength(2);
  });

  test("1-4. usage が設定される: 最後のターンの usage が返り値に含まれる", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(makeToolUseResponse([{ id: "tu-1", name: "search_tool", input: {} }]))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "最終回答" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
        },
      });

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("search_tool")],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("ok");
    // 最後のターン（2ターン目）の usage が採用される
    expect(result.usage).toBeDefined();
    expect(result.usage?.input_tokens).toBe(200);
    expect(result.usage?.output_tokens).toBe(80);
    expect(result.usage?.cache_creation_input_tokens).toBe(20);
    expect(result.usage?.cache_read_input_tokens).toBe(10);
  });

  test("1-5. 複数の text ブロック連結: content に text が2つ → 改行区切りで結合される", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [
        { type: "text", text: "パートA" },
        { type: "text", text: "パートB" },
      ],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    });

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("ok");
    // extractTextSummary は join("\n").trim() で連結する
    expect(result.summary).toBe("パートA\nパートB");
  });
});

// ---------------------------------------------------------------------------
// Section 2: runSpecialist 異常系
// ---------------------------------------------------------------------------

describe("runSpecialist - 異常系", () => {
  test('2-1. stop_reason "max_tokens" など他: status: error, summary に stop_reason が含まれる', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "..." }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 100,
        output_tokens: 4096,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("error");
    expect(result.summary).toBe("stop_reason: max_tokens");
  });

  test("2-2. tool_use ループ上限到達: 3ターン連続 tool_use → status: error, summary に上限メッセージ", async () => {
    // MAX_ITERATIONS = 3 なので 3回 tool_use を返す
    mockMessagesCreate
      .mockResolvedValueOnce(makeToolUseResponse([{ id: "tu-1", name: "tool_a", input: {} }]))
      .mockResolvedValueOnce(makeToolUseResponse([{ id: "tu-2", name: "tool_a", input: {} }]))
      .mockResolvedValueOnce(makeToolUseResponse([{ id: "tu-3", name: "tool_a", input: {} }]));

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("tool_a")],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("error");
    expect(result.summary).toBe("tool_use ループが上限に達しました");
    // 3回のイテレーションが実行された
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    // toolCalls に3件のログが積まれている
    expect(result.toolCalls).toHaveLength(3);
  });

  test("2-3. tool_use ブロックが空: stop_reason: tool_use だが content に tool_use ブロックがない → status: error", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "テキストのみ" }],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("error");
    expect(result.summary).toContain("tool_use");
  });

  test("2-4. API reject: anthropic.messages.create が throw → status: error, summary に api error が含まれる", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("API connection failed"));
    mockClassifyApiError.mockReturnValue("API connection failed");

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(result.status).toBe("error");
    expect(result.summary).toContain("api error");
  });

  test("2-5. tool 個別失敗（runTool が ok: false）: tool_result に error が記録され、次ターンで continue、ToolCallLog に ok: false 記録", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([{ id: "tu-fail", name: "failing_tool", input: { key: "val" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse("ツール失敗後の回答"));

    const runTool = makeFailRunTool("tool execution failed");

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("failing_tool")],
      runTool,
      toolContext: testToolContext,
    });

    // ツール失敗でも処理は継続する
    expect(result.status).toBe("ok");
    expect(result.summary).toBe("ツール失敗後の回答");

    // ToolCallLog に ok: false が記録されている
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.toolCalls[0].tool).toBe("failing_tool");

    // 2ターン目の messages に is_error: true の tool_result が含まれる
    const secondCallArg = mockMessagesCreate.mock.calls[1][0] as {
      messages: { role: string; content: unknown[] }[];
    };
    const lastUserMessage = secondCallArg.messages[secondCallArg.messages.length - 1];
    const userContent = lastUserMessage.content as {
      type: string;
      tool_use_id: string;
      is_error: boolean;
      content: string;
    }[];
    expect(userContent[0].is_error).toBe(true);
    expect(userContent[0].content).toBe("tool execution failed");
  });
});

// ---------------------------------------------------------------------------
// Section 3: runSpecialistWithTimeout
// ---------------------------------------------------------------------------

describe("runSpecialistWithTimeout", () => {
  test("3-1. タイムアウトしない（正常完了）: end_turn が返る → status: ok", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("正常に完了しました"));

    const result = await runSpecialistWithTimeout({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
      timeoutMs: 5000,
    });

    expect(result.status).toBe("ok");
    expect(result.summary).toBe("正常に完了しました");
  });

  test("3-2. タイムアウト（デフォルト8秒）: 9秒後にresolve → status: timeout, latencyMs: 8000", async () => {
    jest.useFakeTimers();

    // 9000ms 後に解決するが、8000ms でタイムアウトする
    mockMessagesCreate.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(makeEndTurnResponse("遅延応答")), 9000)),
    );

    const promise = runSpecialistWithTimeout({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
      // timeoutMs 未指定 → DEFAULT_TIMEOUT_MS = 8000
    });

    await jest.advanceTimersByTimeAsync(8100);
    const result = await promise;

    jest.useRealTimers();

    expect(result.status).toBe("timeout");
    expect(result.summary).toBe("タイムアウトしました");
    expect(result.toolCalls).toEqual([]);
    expect(result.latencyMs).toBe(8000);
  });

  test("3-3. カスタム timeoutMs: 1000 設定で 1.1秒後にresolve → status: timeout, latencyMs: 1000", async () => {
    jest.useFakeTimers();

    // 1100ms 後に解決するが、1000ms でタイムアウトする
    mockMessagesCreate.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(makeEndTurnResponse("遅延応答")), 1100)),
    );

    const promise = runSpecialistWithTimeout({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
      timeoutMs: 1000,
    });

    await jest.advanceTimersByTimeAsync(1100);
    const result = await promise;

    jest.useRealTimers();

    expect(result.status).toBe("timeout");
    expect(result.latencyMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Section 4: DI & パラメータ
// ---------------------------------------------------------------------------

describe("runSpecialist - DI & パラメータ", () => {
  test("4-1. tools 引数が messages.create に伝達される", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("ツールあり回答"));

    const customTools: Tool[] = [makeTool("custom_tool_a"), makeTool("custom_tool_b")];

    await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: customTools,
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.tools).toEqual(customTools);
  });

  test("4-1b. tools が空配列の場合は messages.create に tools: undefined が渡される", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("ツールなし回答"));

    await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.tools).toBeUndefined();
  });

  test("4-2. agent.model が messages.create に伝達される", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("モデル確認"));

    const customModel = "claude-haiku-4-5";
    await runSpecialist({
      agent: makeAgentDef({ model: customModel }),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe(customModel);
  });

  test("4-3. agent.systemPrompt が messages.create の system に伝達される", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("system確認"));

    const customSystemPrompt = "テスト用システムプロンプト: SEO専門家として回答せよ";
    await runSpecialist({
      agent: makeAgentDef({ systemPrompt: customSystemPrompt }),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.system).toBe(customSystemPrompt);
  });

  test("4-4. runTool に toolContext が渡される: userId, sessionId がそのまま伝達される", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([{ id: "tu-ctx", name: "context_tool", input: { q: "test" } }]),
      )
      .mockResolvedValueOnce(makeEndTurnResponse("コンテキスト確認"));

    const customContext: ToolRunContext = {
      userId: "user-999",
      sessionId: "session-888",
    };
    const runTool = makeSuccessRunTool("ctx-result");

    await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [makeTool("context_tool")],
      runTool,
      toolContext: customContext,
    });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("context_tool", { q: "test" }, customContext);
  });

  test("4-5. latencyMs が 0 以上の数値として返る", async () => {
    mockMessagesCreate.mockResolvedValue(makeEndTurnResponse("latency確認"));

    const result = await runSpecialist({
      agent: makeAgentDef(),
      messages: testMessages,
      tools: [],
      runTool: makeSuccessRunTool(),
      toolContext: testToolContext,
    });

    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
