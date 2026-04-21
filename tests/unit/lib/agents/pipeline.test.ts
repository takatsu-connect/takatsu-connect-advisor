/**
 * @jest-environment node
 *
 * runChatPipeline の単体テスト
 *
 * テスト対象:
 *   - src/lib/agents/pipeline.ts の runChatPipeline AsyncGenerator
 *
 * モック戦略:
 *   - runClassifier, runSpecialistWithTimeout, runOrchestratorStream の3関数を丸ごとモック
 *   - pipeline の結合ロジック（classifier→specialists→orchestrator）のみを検証
 *   - 外部 SDK (anthropic) は classifier/specialist/orchestrator モック経由で分離
 */

// ---------------------------------------------------------------------------
// モック定義（import より前に定義する必要がある）
// ---------------------------------------------------------------------------

jest.mock("server-only", () => ({}));

const mockRunClassifier = jest.fn();
jest.mock("@/lib/agents/classifier", () => ({
  runClassifier: (...args: unknown[]) => mockRunClassifier(...args),
}));

const mockRunSpecialistWithTimeout = jest.fn();
jest.mock("@/lib/agents/specialist", () => {
  const actual = jest.requireActual("@/lib/agents/specialist");
  return {
    ...actual,
    runSpecialistWithTimeout: (...args: unknown[]) => mockRunSpecialistWithTimeout(...args),
  };
});

const mockRunOrchestratorStream = jest.fn();
jest.mock("@/lib/agents/orchestrator", () => {
  const actual = jest.requireActual("@/lib/agents/orchestrator");
  return {
    ...actual,
    runOrchestratorStream: (...args: unknown[]) => mockRunOrchestratorStream(...args),
  };
});

// claude/client と env もモックしておく（specialist/orchestrator の実装が内部で参照するケースへの備え）
jest.mock("@/lib/claude/client", () => ({
  anthropic: { messages: { create: jest.fn() } },
}));

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

import { runChatPipeline } from "@/lib/agents/pipeline";
import type { PipelineParams, PipelineEvent, PipelineFinalResult } from "@/lib/agents/pipeline";
import type {
  AgentDefinition,
  ClassifierResult,
  SpecialistResult,
  SpecialistResultStatus,
} from "@/lib/agents/types";
import type { RunClassifierReturn } from "@/lib/agents/classifier";
import type { OrchestratorEvent } from "@/lib/agents/orchestrator";

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

function makeAgentDef(name: string, overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name,
    displayName: `${name}-display`,
    description: `${name} description`,
    role: "specialist",
    model: "claude-haiku-4-5",
    systemPrompt: `System prompt for ${name}`,
    tools: [],
    filePath: `/prompts/agents/${name}.md`,
    mtimeMs: 0,
    ...overrides,
  };
}

function makeSpecialistResult(agent: string, status: SpecialistResultStatus): SpecialistResult {
  return {
    agent,
    displayName: `${agent}-display`,
    status,
    summary: `${agent} summary`,
    toolCalls: [],
    latencyMs: 100,
  };
}

function makeClassifierReturn(specialists: string[]): RunClassifierReturn {
  return {
    result: {
      specialists,
      reasoning: "テスト用 classifier 結果",
    },
    status: "ok",
    latencyMs: 50,
  };
}

/** runOrchestratorStream のモック用 AsyncGenerator */
async function* mockOrchestratorStream(
  events: OrchestratorEvent[],
): AsyncGenerator<OrchestratorEvent> {
  for (const e of events) yield e;
}

/** AsyncGenerator を最後まで消費してイベント一覧と最終戻り値を収集する */
async function collectPipeline(
  gen: AsyncGenerator<PipelineEvent, PipelineFinalResult>,
): Promise<{ events: PipelineEvent[]; result: PipelineFinalResult | undefined }> {
  const events: PipelineEvent[] = [];
  let result: PipelineFinalResult | undefined;
  while (true) {
    const iter = await gen.next();
    if (iter.done) {
      result = iter.value;
      break;
    }
    events.push(iter.value);
  }
  return { events, result };
}

// ---------------------------------------------------------------------------
// 共通テストパラメータ
// ---------------------------------------------------------------------------

const classifierDef = makeAgentDef("classifier", { role: "classifier" });
const orchestratorDef = makeAgentDef("orchestrator", { role: "orchestrator" });
const seoSpecialist = makeAgentDef("seo-specialist");
const marketingSpecialist = makeAgentDef("marketing-specialist");

const baseParams: PipelineParams = {
  classifier: classifierDef,
  orchestrator: orchestratorDef,
  specialists: {
    "seo-specialist": seoSpecialist,
    "marketing-specialist": marketingSpecialist,
  },
  messages: [{ role: "user", content: "テストメッセージ" }],
  toolSchemas: {},
  runTool: jest.fn(),
  toolContext: {},
};

// ---------------------------------------------------------------------------
// Section 1: 正常系
// ---------------------------------------------------------------------------

describe("Section 1: 正常系", () => {
  test("1-1. フル3フェーズ（1 specialist）: 7イベント yield + PipelineFinalResult 返却", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn(["seo-specialist"]));
    mockRunSpecialistWithTimeout.mockResolvedValueOnce(
      makeSpecialistResult("seo-specialist", "ok"),
    );
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([
        { type: "delta", text: "Hello" },
        { type: "delta", text: " World" },
        { type: "done", fullText: "Hello World", latencyMs: 200 },
      ]),
    );

    // Act
    const { events, result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: イベント数 = classification(1) + specialist_start(1) + specialist_result(1)
    //         + orchestrator_delta(2) + orchestrator_done(1) = 6
    expect(events).toHaveLength(6);

    expect(events[0]).toMatchObject({ type: "classification" });
    expect(events[1]).toMatchObject({ type: "specialist_start", agent: "seo-specialist" });
    expect(events[2]).toMatchObject({ type: "specialist_result" });
    expect(events[3]).toMatchObject({ type: "orchestrator_delta", text: "Hello" });
    expect(events[4]).toMatchObject({ type: "orchestrator_delta", text: " World" });
    expect(events[5]).toMatchObject({ type: "orchestrator_done", fullText: "Hello World" });

    // Assert: PipelineFinalResult
    expect(result).toBeDefined();
    expect(result!.fullText).toBe("Hello World");
    expect(result!.specialistResults).toHaveLength(1);
    expect(result!.okSpecialistResults).toHaveLength(1);
    expect(result!.classification.specialists).toEqual(["seo-specialist"]);
  });

  test("1-2. 複数 specialist 全て ok: orchestrator に ok 結果2件が渡る", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["seo-specialist", "marketing-specialist"]),
    );
    mockRunSpecialistWithTimeout
      .mockResolvedValueOnce(makeSpecialistResult("seo-specialist", "ok"))
      .mockResolvedValueOnce(makeSpecialistResult("marketing-specialist", "ok"));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "統合回答", latencyMs: 300 }]),
    );

    // Act
    const { result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: orchestrator に渡された引数を確認
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(2);
    expect(orchestratorCall.specialistResults[0].agent).toBe("seo-specialist");
    expect(orchestratorCall.specialistResults[1].agent).toBe("marketing-specialist");

    expect(result!.okSpecialistResults).toHaveLength(2);
  });

  test("1-3. PipelineFinalResult の検証: 全フィールドが適切に設定される", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["seo-specialist", "marketing-specialist"]),
    );
    mockRunSpecialistWithTimeout
      .mockResolvedValueOnce(makeSpecialistResult("seo-specialist", "ok"))
      .mockResolvedValueOnce(makeSpecialistResult("marketing-specialist", "timeout"));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "最終テキスト", latencyMs: 150 }]),
    );

    // Act
    const { result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert
    expect(result).toBeDefined();
    expect(result!.classification).toEqual({
      specialists: ["seo-specialist", "marketing-specialist"],
      reasoning: "テスト用 classifier 結果",
    });
    // specialistResults は全件（ok + timeout）
    expect(result!.specialistResults).toHaveLength(2);
    // okSpecialistResults は ok のみ
    expect(result!.okSpecialistResults).toHaveLength(1);
    expect(result!.okSpecialistResults[0].agent).toBe("seo-specialist");
    expect(result!.fullText).toBe("最終テキスト");
    // totalLatencyMs は数値であること
    expect(typeof result!.totalLatencyMs).toBe("number");
    expect(result!.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Graceful degradation（最重要）
// ---------------------------------------------------------------------------

describe("Section 2: Graceful degradation", () => {
  test("2-1. 1 specialist timeout → 残り継続: orchestrator には ok 1件だけ渡る", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["seo-specialist", "marketing-specialist"]),
    );
    mockRunSpecialistWithTimeout
      .mockResolvedValueOnce(makeSpecialistResult("seo-specialist", "timeout"))
      .mockResolvedValueOnce(makeSpecialistResult("marketing-specialist", "ok"));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([
        { type: "delta", text: "部分回答" },
        { type: "done", fullText: "部分回答", latencyMs: 100 },
      ]),
    );

    // Act
    const { events, result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: orchestrator には ok 1件のみ渡る
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(1);
    expect(orchestratorCall.specialistResults[0].agent).toBe("marketing-specialist");
    expect(orchestratorCall.specialistResults[0].status).toBe("ok");

    // specialist_result イベントは timeout も含め2件 yield される
    const specialistResultEvents = events.filter((e) => e.type === "specialist_result");
    expect(specialistResultEvents).toHaveLength(2);

    expect(result!.specialistResults).toHaveLength(2);
    expect(result!.okSpecialistResults).toHaveLength(1);
  });

  test("2-2. 全 specialist timeout → 空でも orchestrator 呼ぶ", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["seo-specialist", "marketing-specialist"]),
    );
    mockRunSpecialistWithTimeout
      .mockResolvedValueOnce(makeSpecialistResult("seo-specialist", "timeout"))
      .mockResolvedValueOnce(makeSpecialistResult("marketing-specialist", "timeout"));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([
        { type: "delta", text: "知識のみ回答" },
        { type: "done", fullText: "知識のみ回答", latencyMs: 120 },
      ]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: orchestrator が空配列で呼ばれている
    expect(mockRunOrchestratorStream).toHaveBeenCalledTimes(1);
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(0);

    // orchestrator_delta が yield される
    const deltaEvents = events.filter((e) => e.type === "orchestrator_delta");
    expect(deltaEvents).toHaveLength(1);
    expect(deltaEvents[0]).toMatchObject({ type: "orchestrator_delta", text: "知識のみ回答" });
  });

  test("2-3. specialist 0件（classifier が空配列）→ orchestrator 呼ぶ", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn([]));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "空の応答", latencyMs: 80 }]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: specialist_start / specialist_result は yield されない
    const specialistStartEvents = events.filter((e) => e.type === "specialist_start");
    const specialistResultEvents = events.filter((e) => e.type === "specialist_result");
    expect(specialistStartEvents).toHaveLength(0);
    expect(specialistResultEvents).toHaveLength(0);

    // orchestrator は空配列で呼ばれる
    expect(mockRunOrchestratorStream).toHaveBeenCalledTimes(1);
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(0);

    // runSpecialistWithTimeout は一切呼ばれない
    expect(mockRunSpecialistWithTimeout).not.toHaveBeenCalled();
  });

  test("2-4. classifier が存在しない specialist名を返す → 除外して既知のみ実行", async () => {
    // Arrange: unknown-agent は params.specialists に存在しない
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["unknown-agent", "seo-specialist"]),
    );
    mockRunSpecialistWithTimeout.mockResolvedValueOnce(
      makeSpecialistResult("seo-specialist", "ok"),
    );
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "SEO回答", latencyMs: 90 }]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: seo-specialist のみ specialist_start が yield される
    const startEvents = events.filter((e) => e.type === "specialist_start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({
      type: "specialist_start",
      agent: "seo-specialist",
    });

    // runSpecialistWithTimeout は seo-specialist のみで1回呼ばれる
    expect(mockRunSpecialistWithTimeout).toHaveBeenCalledTimes(1);
    const callArg = mockRunSpecialistWithTimeout.mock.calls[0][0];
    expect(callArg.agent.name).toBe("seo-specialist");
  });

  test("2-5. specialist error → orchestrator は ok 以外除外（空配列）", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn(["seo-specialist"]));
    mockRunSpecialistWithTimeout.mockResolvedValueOnce(
      makeSpecialistResult("seo-specialist", "error"),
    );
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "エラー時の回答", latencyMs: 60 }]),
    );

    // Act
    const { events, result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: orchestrator には空配列
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(0);

    // specialist_result には error が yield される
    const specialistResultEvents = events.filter((e) => e.type === "specialist_result");
    expect(specialistResultEvents).toHaveLength(1);
    expect(specialistResultEvents[0]).toMatchObject({
      type: "specialist_result",
      result: expect.objectContaining({ status: "error" }),
    });

    expect(result!.okSpecialistResults).toHaveLength(0);
    expect(result!.specialistResults).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Classifier のフォールバック挙動
// ---------------------------------------------------------------------------

describe("Section 3: Classifier のフォールバック挙動", () => {
  test("3-1. classifier が parse_error で fallback → pipeline 続行、orchestrator は空配列で呼ばれる", async () => {
    // Arrange: parse_error フォールバック（specialists = []）
    const fallbackReturn: RunClassifierReturn = {
      result: { specialists: [], reasoning: "classifier失敗のため統合のみで応答" },
      status: "parse_error",
      latencyMs: 30,
    };
    mockRunClassifier.mockResolvedValueOnce(fallbackReturn);
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "フォールバック回答", latencyMs: 70 }]),
    );

    // Act & Assert: pipeline は throw しない
    const { result } = await collectPipeline(runChatPipeline(baseParams));
    expect(result).toBeDefined();

    // orchestrator は空配列で呼ばれている
    expect(mockRunOrchestratorStream).toHaveBeenCalledTimes(1);
    const orchestratorCall = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorCall.specialistResults).toHaveLength(0);

    // specialist は一切呼ばれない
    expect(mockRunSpecialistWithTimeout).not.toHaveBeenCalled();
  });

  test("3-1-detail. classification イベントには fallback ClassifierResult が入る", async () => {
    // Arrange
    const fallbackReturn: RunClassifierReturn = {
      result: { specialists: [], reasoning: "classifier失敗のため統合のみで応答" },
      status: "parse_error",
      latencyMs: 30,
    };
    mockRunClassifier.mockResolvedValueOnce(fallbackReturn);
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "フォールバック回答", latencyMs: 70 }]),
    );

    // Act
    const { events, result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert
    const classificationEvent = events.find((e) => e.type === "classification");
    expect(classificationEvent).toBeDefined();
    expect(classificationEvent).toMatchObject({
      type: "classification",
      classification: {
        specialists: [],
        reasoning: "classifier失敗のため統合のみで応答",
      },
    });
    expect(result!.classification.specialists).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Orchestrator イベントの変換
// ---------------------------------------------------------------------------

describe("Section 4: Orchestrator イベントの変換", () => {
  test("4-1. delta → orchestrator_delta 変換", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn([]));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "delta", text: "Hello" }]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert
    const deltaEvent = events.find((e) => e.type === "orchestrator_delta");
    expect(deltaEvent).toMatchObject({ type: "orchestrator_delta", text: "Hello" });
  });

  test("4-2. done → orchestrator_done 変換（usage は pipeline event に含まれない）", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn([]));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([
        {
          type: "done",
          fullText: "完全テキスト",
          latencyMs: 250,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      ]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert
    const doneEvent = events.find((e) => e.type === "orchestrator_done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent).toMatchObject({
      type: "orchestrator_done",
      fullText: "完全テキスト",
      latencyMs: 250,
    });
    // usage は pipeline event に含まれない
    expect(doneEvent).not.toHaveProperty("usage");
  });

  test("4-3. error → orchestrator_error 変換 → その後 PipelineFinalResult を return", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn([]));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([
        { type: "delta", text: "部分" },
        { type: "error", error: "ストリーミングエラー", latencyMs: 180 },
      ]),
    );

    // Act
    const { events, result } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: orchestrator_error イベントが yield される
    const errorEvent = events.find((e) => e.type === "orchestrator_error");
    expect(errorEvent).toMatchObject({
      type: "orchestrator_error",
      error: "ストリーミングエラー",
      latencyMs: 180,
    });

    // PipelineFinalResult は返却される（pipeline 自体は throw しない）
    expect(result).toBeDefined();
    // fullText はエラー前の delta を結合した部分テキスト
    expect(result!.fullText).toBe("部分");
  });
});

// ---------------------------------------------------------------------------
// Section 5: 並列実行 & signal
// ---------------------------------------------------------------------------

describe("Section 5: 並列実行 & signal", () => {
  test("5-1. specialist_start は Promise.all 前に全件 yield される（順序確認）", async () => {
    // Arrange
    mockRunClassifier.mockResolvedValueOnce(
      makeClassifierReturn(["seo-specialist", "marketing-specialist"]),
    );
    mockRunSpecialistWithTimeout
      .mockResolvedValueOnce(makeSpecialistResult("seo-specialist", "ok"))
      .mockResolvedValueOnce(makeSpecialistResult("marketing-specialist", "ok"));
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "完了", latencyMs: 200 }]),
    );

    // Act
    const { events } = await collectPipeline(runChatPipeline(baseParams));

    // Assert: specialist_start 2件が specialist_result より前に並ぶ
    const startIndices = events
      .map((e, i) => (e.type === "specialist_start" ? i : -1))
      .filter((i) => i !== -1);
    const resultIndices = events
      .map((e, i) => (e.type === "specialist_result" ? i : -1))
      .filter((i) => i !== -1);

    expect(startIndices).toHaveLength(2);
    expect(resultIndices).toHaveLength(2);
    // 全 specialist_start のインデックスは全 specialist_result のインデックスより小さい
    expect(Math.max(...startIndices)).toBeLessThan(Math.min(...resultIndices));

    // specialist_start の順序（seo → marketing）
    expect(events[startIndices[0]]).toMatchObject({ agent: "seo-specialist" });
    expect(events[startIndices[1]]).toMatchObject({ agent: "marketing-specialist" });
  });

  test("5-2. signal が各サブ関数の引数に含まれる", async () => {
    // Arrange
    const controller = new AbortController();
    const { signal } = controller;

    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn(["seo-specialist"]));
    mockRunSpecialistWithTimeout.mockResolvedValueOnce(
      makeSpecialistResult("seo-specialist", "ok"),
    );
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "signal テスト", latencyMs: 50 }]),
    );

    // Act
    await collectPipeline(runChatPipeline({ ...baseParams, signal }));

    // Assert: 各サブ関数の引数に signal が含まれる
    const classifierArg = mockRunClassifier.mock.calls[0][0];
    expect(classifierArg.signal).toBe(signal);

    const specialistArg = mockRunSpecialistWithTimeout.mock.calls[0][0];
    expect(specialistArg.signal).toBe(signal);

    const orchestratorArg = mockRunOrchestratorStream.mock.calls[0][0];
    expect(orchestratorArg.signal).toBe(signal);
  });

  test("5-3. specialistTimeoutMs を変更すると runSpecialistWithTimeout に timeoutMs が渡る", async () => {
    // Arrange
    const customTimeoutMs = 5000;
    mockRunClassifier.mockResolvedValueOnce(makeClassifierReturn(["seo-specialist"]));
    mockRunSpecialistWithTimeout.mockResolvedValueOnce(
      makeSpecialistResult("seo-specialist", "ok"),
    );
    mockRunOrchestratorStream.mockReturnValueOnce(
      mockOrchestratorStream([{ type: "done", fullText: "タイムアウトテスト", latencyMs: 60 }]),
    );

    // Act
    await collectPipeline(runChatPipeline({ ...baseParams, specialistTimeoutMs: customTimeoutMs }));

    // Assert
    const specialistArg = mockRunSpecialistWithTimeout.mock.calls[0][0];
    expect(specialistArg.timeoutMs).toBe(customTimeoutMs);
  });
});
