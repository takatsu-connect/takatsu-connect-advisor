/**
 * src/lib/agents/types.ts の型テスト
 *
 * 目的:
 *   - 各インターフェース・型エイリアスが意図通りに定義されているかを検証する
 *   - @ts-expect-error を使い、不正な値がコンパイル時に拒否されることを確認する
 *   - Jest 実行時にサンプル値の実行時プロパティも確認する
 */

import type {
  AgentDefinition,
  AgentRole,
  SpecialistResult,
  SpecialistResultStatus,
  ToolCallLog,
  ClassifierResult,
  PipelineContext,
  AgentUsage,
  AggregatedUsage,
} from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// AgentRole
// ---------------------------------------------------------------------------

describe("AgentRole", () => {
  test("union の 3 値すべてを配列に格納できる", () => {
    const roles: AgentRole[] = ["classifier", "orchestrator", "specialist"];
    expect(roles).toHaveLength(3);
    expect(roles).toContain("classifier");
    expect(roles).toContain("orchestrator");
    expect(roles).toContain("specialist");
  });

  test("不正な文字列は AgentRole として代入できない（コンパイル時エラー）", () => {
    // @ts-expect-error: "analyst" は AgentRole に含まれない
    const invalid: AgentRole = "analyst";
    // 実行時は文字列として通る – コンパイル時に @ts-expect-error が機能していることが重要
    expect(typeof invalid).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// AgentDefinition
// ---------------------------------------------------------------------------

describe("AgentDefinition", () => {
  test("必須プロパティのみで構築できる", () => {
    const def: AgentDefinition = {
      name: "seo-specialist",
      displayName: "SEO専門家",
      description: "SEOに関する質問に答える専門家",
      role: "specialist",
      model: "claude-haiku-4-5",
      systemPrompt: "あなたはSEO専門家です。",
      tools: ["fetch_webpage"],
      filePath: "prompts/agents/seo-specialist.md",
      mtimeMs: 1234567890,
    };

    expect(def.name).toBe("seo-specialist");
    expect(def.displayName).toBe("SEO専門家");
    expect(def.role).toBe("specialist");
    expect(def.tools).toHaveLength(1);
    expect(def.tools[0]).toBe("fetch_webpage");
    expect(def.filePath).toBe("prompts/agents/seo-specialist.md");
    expect(def.mtimeMs).toBe(1234567890);
  });

  test("optional プロパティ（temperature, maxTokens, include）を含めて構築できる", () => {
    const def: AgentDefinition = {
      name: "marketing-specialist",
      displayName: "マーケティング専門家",
      description: "マーケティング戦略を提案する専門家",
      role: "specialist",
      model: "claude-sonnet-4-6",
      systemPrompt: "あなたはマーケティング専門家です。",
      tools: [],
      temperature: 0.7,
      maxTokens: 2048,
      include: ["shared/takatsu-connect.md", "shared/guidelines.md"],
      filePath: "prompts/agents/marketing-specialist.md",
      mtimeMs: 9876543210,
    };

    expect(def.temperature).toBe(0.7);
    expect(def.maxTokens).toBe(2048);
    expect(def.include).toHaveLength(2);
    expect(def.include?.[0]).toBe("shared/takatsu-connect.md");
  });

  test("optional プロパティが未指定の場合は undefined になる", () => {
    const def: AgentDefinition = {
      name: "classifier",
      displayName: "クラシファイア",
      description: "専門家を選定するエージェント",
      role: "classifier",
      model: "claude-haiku-4-5",
      systemPrompt: "あなたは専門家選定エージェントです。",
      tools: [],
      filePath: "prompts/agents/classifier.md",
      mtimeMs: 0,
    };

    expect(def.temperature).toBeUndefined();
    expect(def.maxTokens).toBeUndefined();
    expect(def.include).toBeUndefined();
  });

  test("tools は空配列を受け入れる", () => {
    const def: AgentDefinition = {
      name: "orchestrator",
      displayName: "オーケストレーター",
      description: "専門家の回答を統合するエージェント",
      role: "orchestrator",
      model: "claude-sonnet-4-6",
      systemPrompt: "あなたは統合エージェントです。",
      tools: [],
      filePath: "prompts/agents/orchestrator.md",
      mtimeMs: 111111111,
    };

    expect(def.tools).toEqual([]);
  });

  test("role に不正な文字列は代入できない（コンパイル時エラー）", () => {
    // @ts-expect-error: "admin" は AgentRole に含まれない
    const role: AgentRole = "admin";
    expect(typeof role).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// ToolCallLog
// ---------------------------------------------------------------------------

describe("ToolCallLog", () => {
  test("成功した tool_use ログを構築できる", () => {
    const log: ToolCallLog = {
      tool: "query_search_console",
      input: { query: "高津コネクト SEO" },
      ok: true,
      ms: 342,
    };

    expect(log.tool).toBe("query_search_console");
    expect(log.ok).toBe(true);
    expect(log.ms).toBe(342);
  });

  test("失敗した tool_use ログを構築できる", () => {
    const log: ToolCallLog = {
      tool: "fetch_webpage",
      input: { url: "https://example.com" },
      ok: false,
      ms: 5001,
    };

    expect(log.ok).toBe(false);
  });

  test("input は任意の型を受け入れる（unknown 型）", () => {
    const logWithStringInput: ToolCallLog = {
      tool: "some_tool",
      input: "simple string",
      ok: true,
      ms: 10,
    };
    const logWithNullInput: ToolCallLog = {
      tool: "some_tool",
      input: null,
      ok: true,
      ms: 10,
    };

    expect(logWithStringInput.input).toBe("simple string");
    expect(logWithNullInput.input).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SpecialistResultStatus
// ---------------------------------------------------------------------------

describe("SpecialistResultStatus", () => {
  test("union の 4 値すべてを格納できる", () => {
    const statuses: SpecialistResultStatus[] = [
      "ok",
      "timeout",
      "error",
      "skipped",
    ];
    expect(statuses).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// SpecialistResult
// ---------------------------------------------------------------------------

describe("SpecialistResult", () => {
  test("status=ok の結果を構築できる", () => {
    const result: SpecialistResult = {
      agent: "seo-specialist",
      displayName: "SEO専門家",
      status: "ok",
      summary: "SEOの観点から、タイトルタグの最適化が重要です。",
      toolCalls: [],
      latencyMs: 1500,
    };

    expect(result.agent).toBe("seo-specialist");
    expect(result.status).toBe("ok");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toBeUndefined();
  });

  test("status=timeout の結果を構築できる", () => {
    const result: SpecialistResult = {
      agent: "data-analyst",
      displayName: "データアナリスト",
      status: "timeout",
      summary: "",
      toolCalls: [],
      latencyMs: 30000,
    };

    expect(result.status).toBe("timeout");
  });

  test("status=error の結果を構築できる", () => {
    const result: SpecialistResult = {
      agent: "content-strategist",
      displayName: "コンテンツストラテジスト",
      status: "error",
      summary: "",
      toolCalls: [],
      latencyMs: 200,
    };

    expect(result.status).toBe("error");
  });

  test("status=skipped の結果を構築できる", () => {
    const result: SpecialistResult = {
      agent: "seo-specialist",
      displayName: "SEO専門家",
      status: "skipped",
      summary: "",
      toolCalls: [],
      latencyMs: 0,
    };

    expect(result.status).toBe("skipped");
  });

  test("optional の usage プロパティを含めて構築できる", () => {
    const usage: AgentUsage = {
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 300,
    };

    const result: SpecialistResult = {
      agent: "seo-specialist",
      displayName: "SEO専門家",
      status: "ok",
      summary: "回答サマリ",
      toolCalls: [
        { tool: "fetch_webpage", input: {}, ok: true, ms: 500 },
      ],
      latencyMs: 2000,
      usage,
    };

    expect(result.usage?.input_tokens).toBe(500);
    expect(result.usage?.output_tokens).toBe(200);
    expect(result.toolCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ClassifierResult
// ---------------------------------------------------------------------------

describe("ClassifierResult", () => {
  test("複数の specialists を持つ結果を構築できる", () => {
    const result: ClassifierResult = {
      specialists: ["seo-specialist", "content-strategist"],
      reasoning: "SEOとコンテンツ両方の観点が必要なため選定",
    };

    expect(result.specialists).toHaveLength(2);
    expect(result.specialists[0]).toBe("seo-specialist");
    expect(result.reasoning).toBeTruthy();
  });

  test("specialists が空配列の場合も受け入れる", () => {
    const result: ClassifierResult = {
      specialists: [],
      reasoning: "該当する専門家なし",
    };

    expect(result.specialists).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------

describe("PipelineContext", () => {
  test("必須プロパティのみで構築できる", () => {
    const ctx: PipelineContext = {
      requestId: "req-abc123",
      userId: "user-xyz789",
      sessionId: "session-001",
      messages: [],
      startedAt: Date.now(),
    };

    expect(ctx.requestId).toBe("req-abc123");
    expect(ctx.userId).toBe("user-xyz789");
    expect(ctx.sessionId).toBe("session-001");
    expect(ctx.messages).toEqual([]);
    expect(typeof ctx.startedAt).toBe("number");
  });

  test("optional プロパティが未指定の場合は undefined になる", () => {
    const ctx: PipelineContext = {
      requestId: "req-1",
      userId: "user-1",
      sessionId: "session-1",
      messages: [],
      startedAt: 1000000,
    };

    expect(ctx.classifierResult).toBeUndefined();
    expect(ctx.specialistResults).toBeUndefined();
  });

  test("classifierResult を含めて構築できる", () => {
    const ctx: PipelineContext = {
      requestId: "req-2",
      userId: "user-2",
      sessionId: "session-2",
      messages: [],
      startedAt: 1000000,
      classifierResult: {
        specialists: ["seo-specialist"],
        reasoning: "SEO関連の質問",
      },
    };

    expect(ctx.classifierResult?.specialists).toHaveLength(1);
  });

  test("specialistResults を含めて構築できる", () => {
    const specialistResult: SpecialistResult = {
      agent: "seo-specialist",
      displayName: "SEO専門家",
      status: "ok",
      summary: "SEO分析の結果",
      toolCalls: [],
      latencyMs: 1200,
    };

    const ctx: PipelineContext = {
      requestId: "req-3",
      userId: "user-3",
      sessionId: "session-3",
      messages: [],
      startedAt: 1000000,
      classifierResult: {
        specialists: ["seo-specialist"],
        reasoning: "SEO関連",
      },
      specialistResults: [specialistResult],
    };

    expect(ctx.specialistResults).toHaveLength(1);
    expect(ctx.specialistResults?.[0].agent).toBe("seo-specialist");
  });

  test("messages に Anthropic SDK の MessageParam 形式の値を格納できる", () => {
    const ctx: PipelineContext = {
      requestId: "req-4",
      userId: "user-4",
      sessionId: "session-4",
      messages: [
        { role: "user", content: "SEOについて教えてください" },
        { role: "assistant", content: "SEOとはSearch Engine Optimizationです" },
      ],
      startedAt: 1000000,
    };

    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[1].role).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// AgentUsage
// ---------------------------------------------------------------------------

describe("AgentUsage", () => {
  test("必要なトークン情報を格納できる", () => {
    const usage: AgentUsage = {
      input_tokens: 1000,
      output_tokens: 300,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 800,
    };

    expect(usage.input_tokens).toBe(1000);
    expect(usage.output_tokens).toBe(300);
    expect(usage.cache_creation_input_tokens).toBe(200);
    expect(usage.cache_read_input_tokens).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// AggregatedUsage
// ---------------------------------------------------------------------------

describe("AggregatedUsage", () => {
  test("パイプライン全体の集計データを構築できる", () => {
    const aggregated: AggregatedUsage = {
      cacheReadTokens: 1500,
      cacheCreationTokens: 400,
      inputTokens: 2000,
      outputTokens: 600,
      contextCount: 5,
    };

    expect(aggregated.cacheReadTokens).toBe(1500);
    expect(aggregated.cacheCreationTokens).toBe(400);
    expect(aggregated.inputTokens).toBe(2000);
    expect(aggregated.outputTokens).toBe(600);
    expect(aggregated.contextCount).toBe(5);
  });

  test("contextCount がゼロの場合も受け入れる", () => {
    const aggregated: AggregatedUsage = {
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      inputTokens: 100,
      outputTokens: 50,
      contextCount: 0,
    };

    expect(aggregated.contextCount).toBe(0);
  });
});
