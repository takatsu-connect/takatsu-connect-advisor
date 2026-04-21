/**
 * @jest-environment node
 *
 * src/lib/agents/classifier.ts の単体テスト
 *
 * テスト対象:
 *   - runClassifier(): Claude API を呼び出して専門家選定結果を返す関数
 *
 * モック戦略:
 *   - "server-only": 空オブジェクトでスタブ化（Next.js server-only import ガード回避）
 *   - "@/lib/claude/client": anthropic.messages.create を jest.fn() でモック
 *   - "@/lib/env": getEnv() をモック化（client.ts の依存解決のため）
 *   - jest.useFakeTimers(): タイムアウトテストで 5 秒待機を省略
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

// ---------------------------------------------------------------------------
// インポート（モック定義の後）
// ---------------------------------------------------------------------------

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { runClassifier } from "@/lib/agents/classifier";
import type { AgentDefinition } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** テスト用の最小 AgentDefinition を生成する */
function makeClassifierDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "classifier",
    displayName: "分類器",
    description: "呼ぶべき専門家を選定する",
    role: "classifier",
    model: "claude-haiku-4-5",
    systemPrompt: "あなたは専門家振り分けエージェントです。",
    tools: [],
    filePath: "/prompts/agents/classifier.md",
    mtimeMs: Date.now(),
    temperature: 0.2,
    maxTokens: 256,
    ...overrides,
  };
}

/** テスト用の最小 MessageParam 配列 */
const testMessages: MessageParam[] = [{ role: "user", content: "SEOについて教えてください" }];

/** anthropic.messages.create の正常系レスポンスを生成する */
function makeSuccessResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  };
}

// ---------------------------------------------------------------------------
// 共通セットアップ
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Section 1: 正常系
// ---------------------------------------------------------------------------

describe("runClassifier - 正常系", () => {
  test("1-1. 正しいJSON応答 → status: ok、結果がそのまま返る", async () => {
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "SEOに関する質問",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist", "data-analyst"],
    });

    expect(result.status).toBe("ok");
    expect(result.result.specialists).toEqual(["seo-specialist"]);
    expect(result.result.reasoning).toBe("SEOに関する質問");
  });

  test("1-2. JSONコードブロック（```json ... ```）形式の応答 → コードブロックを剥がして正常にパースする", async () => {
    const innerJson = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "SEOの質問のため",
    });
    const responseText = `\`\`\`json\n${innerJson}\n\`\`\``;
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.status).toBe("ok");
    expect(result.result.specialists).toEqual(["seo-specialist"]);
  });

  test("1-3. allowedSpecialists でフィルタ → unknown-agent は除外される", async () => {
    const responseText = JSON.stringify({
      specialists: ["seo-specialist", "unknown-agent"],
      reasoning: "複数の専門家が必要",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist", "data-analyst"],
    });

    expect(result.status).toBe("ok");
    expect(result.result.specialists).toEqual(["seo-specialist"]);
    expect(result.result.specialists).not.toContain("unknown-agent");
  });

  test("1-4. allowedSpecialists に存在しない specialists のみ → フィルタ後に specialists: []", async () => {
    const responseText = JSON.stringify({
      specialists: ["fake-agent"],
      reasoning: "該当なし",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist", "data-analyst"],
    });

    expect(result.status).toBe("ok");
    expect(result.result.specialists).toEqual([]);
  });

  test("1-5. usage がレスポンスから返り値の usage に伝達される", async () => {
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "SEOの質問",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.usage).toBeDefined();
    expect(result.usage?.input_tokens).toBe(100);
    expect(result.usage?.output_tokens).toBe(50);
    expect(result.usage?.cache_creation_input_tokens).toBe(10);
    expect(result.usage?.cache_read_input_tokens).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Section 2: 異常系
// ---------------------------------------------------------------------------

describe("runClassifier - 異常系", () => {
  test("2-1. JSONパース失敗 → status: parse_error、フォールバック返却", async () => {
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse("not json at all"));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.status).toBe("parse_error");
    expect(result.result.specialists).toEqual([]);
    expect(result.result.reasoning).toBe("classifier失敗のため統合のみで応答");
  });

  test("2-2. specialists が配列でない → status: parse_error", async () => {
    const responseText = JSON.stringify({
      specialists: "seo-specialist",
      reasoning: "文字列で来た",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.status).toBe("parse_error");
    expect(result.result.specialists).toEqual([]);
    expect(result.result.reasoning).toBe("classifier失敗のため統合のみで応答");
  });

  test("2-3. specialists に非string要素 → string以外を除外後にallowedSpecialistsフィルタ → status: ok、specialists: []", async () => {
    const responseText = JSON.stringify({
      specialists: [1, 2],
      reasoning: "数値配列",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    // 実装: string以外をfilterしてから allowedSpecialists フィルタ → status: ok で specialists: []
    expect(result.status).toBe("ok");
    expect(result.result.specialists).toEqual([]);
  });

  test("2-4. content[0] が text ブロックでない（tool_use ブロック）→ status: parse_error", async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "some_tool",
          input: {},
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.status).toBe("parse_error");
    expect(result.result.specialists).toEqual([]);
    expect(result.result.reasoning).toBe("classifier失敗のため統合のみで応答");
  });

  test("2-5. anthropic.messages.create が reject → status: api_error、フォールバック返却", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("API connection failed"));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(result.status).toBe("api_error");
    expect(result.result.specialists).toEqual([]);
    expect(result.result.reasoning).toBe("classifier失敗のため統合のみで応答");
  });

  test("2-6. 5秒タイムアウト → status: timeout、フォールバック返却", async () => {
    jest.useFakeTimers();

    // 6000ms 後に解決するが、5000ms で Promise.race がタイムアウトする
    mockMessagesCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                makeSuccessResponse(
                  JSON.stringify({ specialists: ["seo-specialist"], reasoning: "遅延" }),
                ),
              ),
            6000,
          ),
        ),
    );

    const promise = runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    await jest.advanceTimersByTimeAsync(5100);
    const result = await promise;

    jest.useRealTimers();

    expect(result.status).toBe("timeout");
    expect(result.result.specialists).toEqual([]);
    expect(result.result.reasoning).toBe("classifier失敗のため統合のみで応答");
  });
});

// ---------------------------------------------------------------------------
// Section 3: パラメータ確認
// ---------------------------------------------------------------------------

describe("runClassifier - パラメータ確認", () => {
  test("3-1. classifier に maxTokens / temperature 未指定 → デフォルト値 256 / 0.2 が渡される", async () => {
    const classifierWithoutDefaults = makeClassifierDef({
      maxTokens: undefined,
      temperature: undefined,
    });
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "デフォルト確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: classifierWithoutDefaults,
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.max_tokens).toBe(256);
    expect(callArg.temperature).toBe(0.2);
  });

  test("3-2. classifier に maxTokens: 128, temperature: 0.1 → そのまま渡される", async () => {
    const customClassifier = makeClassifierDef({ maxTokens: 128, temperature: 0.1 });
    const responseText = JSON.stringify({
      specialists: ["data-analyst"],
      reasoning: "カスタム値確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: customClassifier,
      messages: testMessages,
      allowedSpecialists: ["data-analyst"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.max_tokens).toBe(128);
    expect(callArg.temperature).toBe(0.1);
  });

  test("3-3. classifier.model が messages.create の model パラメータに渡される", async () => {
    const customModel = "claude-haiku-4-5";
    const classifierWithModel = makeClassifierDef({ model: customModel });
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "モデル確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: classifierWithModel,
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe(customModel);
  });

  test("3-4. classifier.systemPrompt が system パラメータにそのまま渡される", async () => {
    const customSystemPrompt = "テスト用システムプロンプト: 専門家を選定せよ";
    const classifierWithPrompt = makeClassifierDef({ systemPrompt: customSystemPrompt });
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "system確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: classifierWithPrompt,
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.system).toBe(customSystemPrompt);
  });

  test("3-5. tools パラメータなしで messages.create が呼ばれる（tools プロパティが undefined または存在しない）", async () => {
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "tools不要確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.tools).toBeUndefined();
  });

  test("3-6. latencyMs が 0 以上の数値として返る", async () => {
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "latency確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    const result = await runClassifier({
      classifier: makeClassifierDef(),
      messages: testMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("3-7. messages パラメータが messages.create にそのまま渡される", async () => {
    const customMessages: MessageParam[] = [
      { role: "user", content: "最初のメッセージ" },
      { role: "assistant", content: "最初の応答" },
      { role: "user", content: "2番目のメッセージ" },
    ];
    const responseText = JSON.stringify({
      specialists: ["seo-specialist"],
      reasoning: "messages確認",
    });
    mockMessagesCreate.mockResolvedValue(makeSuccessResponse(responseText));

    await runClassifier({
      classifier: makeClassifierDef(),
      messages: customMessages,
      allowedSpecialists: ["seo-specialist"],
    });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.messages).toEqual(customMessages);
  });
});
