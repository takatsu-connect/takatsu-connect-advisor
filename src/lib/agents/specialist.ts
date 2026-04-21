/**
 * Specialist エージェント
 *
 * 担当領域の知見 + tool_use を駆使して要点（中間回答）を返す。
 * tool_use ループ（MAX_ITERATIONS=3）、並列ツール実行（Promise.all）、
 * タイムアウト（Promise.race）を実装する。
 *
 * 設計書: doc/design/agent-system-design.md §7
 */

import "server-only";
import type {
  MessageParam,
  Tool,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import { anthropic } from "@/lib/claude/client";
import { classifyApiError } from "@/lib/claude/api-error";
import type {
  AgentDefinition,
  AgentUsage,
  SpecialistResult,
  ToolCallLog,
} from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 3;
const DEFAULT_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// 公開型（DI インターフェース）
// ---------------------------------------------------------------------------

/**
 * ツール実行関数に渡す共通コンテキスト。
 * p5b 系タスクで実装される各ツールが必要とする情報を保持する。
 */
export interface ToolRunContext {
  userId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

/**
 * ツール実行結果。
 */
export interface ToolRunResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  latencyMs: number;
}

/**
 * DI で注入するツール実行関数の型。
 * p5b 系タスクで実装される。
 */
export type RunToolFn = (
  toolName: string,
  input: unknown,
  ctx: ToolRunContext,
) => Promise<ToolRunResult>;

// ---------------------------------------------------------------------------
// runSpecialist パラメータ
// ---------------------------------------------------------------------------

export interface RunSpecialistParams {
  /** specialist の AgentDefinition（include 展開済みシステムプロンプトを含む） */
  agent: AgentDefinition;
  /** 履歴 + Classifier reasoning を含めたコンテキスト */
  messages: MessageParam[];
  /** ツール名 → Anthropic SDK Tool定義 のマップ（呼び出し側が解決して渡す） */
  tools: Tool[];
  /** DI: p5b で実装されるツール実行関数 */
  runTool: RunToolFn;
  /** runTool に渡すコンテキスト */
  toolContext: ToolRunContext;
  /** キャンセルシグナル（省略可） */
  signal?: AbortSignal;
}

export interface RunSpecialistWithTimeoutParams extends RunSpecialistParams {
  /** タイムアウト時間（ミリ秒）。デフォルト 8000 */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

/**
 * レスポンスの content から tool_use ブロックを抽出する。
 */
function extractToolUseBlocks(content: { type: string }[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

/**
 * レスポンスの content からテキストを結合して返す。
 * テキストブロックが存在しない場合は空文字を返す。
 */
function extractTextSummary(content: { type: string; text?: string }[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * 単一の tool_use ブロックを実行し、ToolCallLog と ToolResultBlockParam を返す。
 */
async function executeSingleToolUse(
  toolUse: ToolUseBlock,
  runTool: RunToolFn,
  toolContext: ToolRunContext,
): Promise<{ log: ToolCallLog; resultBlock: ToolResultBlockParam }> {
  const toolResult = await runTool(toolUse.name, toolUse.input, toolContext);

  const log: ToolCallLog = {
    tool: toolUse.name,
    input: toolUse.input,
    ok: toolResult.ok,
    ms: toolResult.latencyMs,
  };

  let resultContent: string;
  if (toolResult.ok) {
    resultContent =
      typeof toolResult.result === "string"
        ? toolResult.result
        : JSON.stringify(toolResult.result ?? null);
  } else {
    resultContent = toolResult.error ?? "ツール実行エラー";
  }

  const resultBlock: ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: resultContent,
    is_error: !toolResult.ok,
  };

  return { log, resultBlock };
}

// ---------------------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------------------

/**
 * specialist エージェントを実行する。
 * tool_use ループ（MAX_ITERATIONS=3）で Claude API を呼び出し、
 * 複数ツールは Promise.all で並列実行する。
 */
export async function runSpecialist(params: RunSpecialistParams): Promise<SpecialistResult> {
  const { agent, messages, tools, runTool, toolContext, signal } = params;
  const startedAt = Date.now();

  const accumulatedToolCalls: ToolCallLog[] = [];
  let accumulatedUsage: AgentUsage | undefined;

  // tool_use ループ用のメッセージ列（初期は入力をコピー）
  const loopMessages: MessageParam[] = [...messages];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let rawResponse: Awaited<ReturnType<typeof anthropic.messages.create>>;

    try {
      rawResponse = await anthropic.messages.create(
        {
          model: agent.model,
          max_tokens: agent.maxTokens ?? 4096,
          temperature: agent.temperature ?? 0.5,
          system: agent.systemPrompt,
          messages: loopMessages,
          tools: tools.length > 0 ? tools : undefined,
        },
        { signal },
      );
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const kind = classifyApiError(error);

      return {
        agent: agent.name,
        displayName: agent.displayName,
        status: "error",
        summary: `api error: ${kind}`,
        toolCalls: accumulatedToolCalls,
        latencyMs,
        usage: accumulatedUsage,
      };
    }

    // usage を累積（複数ターンに渡る場合は最後のターンの値を採用）
    accumulatedUsage = rawResponse.usage;

    const { stop_reason, content } = rawResponse;

    if (stop_reason === "end_turn") {
      // 正常終了
      const summary = extractTextSummary(content as { type: string; text?: string }[]);
      return {
        agent: agent.name,
        displayName: agent.displayName,
        status: "ok",
        summary,
        toolCalls: accumulatedToolCalls,
        latencyMs: Date.now() - startedAt,
        usage: accumulatedUsage,
      };
    }

    if (stop_reason === "tool_use") {
      // tool_use ブロックを抽出
      const toolUseBlocks = extractToolUseBlocks(content as { type: string }[]);

      if (toolUseBlocks.length === 0) {
        // tool_use と言われたがブロックがない異常系
        return {
          agent: agent.name,
          displayName: agent.displayName,
          status: "error",
          summary: "stop_reason: tool_use だがツール呼び出しブロックが存在しません",
          toolCalls: accumulatedToolCalls,
          latencyMs: Date.now() - startedAt,
          usage: accumulatedUsage,
        };
      }

      // 同一ターン内の複数ツールを並列実行
      const toolResults = await Promise.all(
        toolUseBlocks.map((toolUse) => executeSingleToolUse(toolUse, runTool, toolContext)),
      );

      // ToolCallLog を累積
      for (const { log } of toolResults) {
        accumulatedToolCalls.push(log);
      }

      // アシスタントの応答を messages に追加
      loopMessages.push({
        role: "assistant",
        content: content,
      });

      // ツール結果を user メッセージとして追加
      loopMessages.push({
        role: "user",
        content: toolResults.map(({ resultBlock }) => resultBlock),
      });

      // 次のイテレーションへ
      continue;
    }

    // 予期しない stop_reason
    return {
      agent: agent.name,
      displayName: agent.displayName,
      status: "error",
      summary: `stop_reason: ${stop_reason ?? "unknown"}`,
      toolCalls: accumulatedToolCalls,
      latencyMs: Date.now() - startedAt,
      usage: accumulatedUsage,
    };
  }

  // ループが上限に達した
  return {
    agent: agent.name,
    displayName: agent.displayName,
    status: "error",
    summary: "tool_use ループが上限に達しました",
    toolCalls: accumulatedToolCalls,
    latencyMs: Date.now() - startedAt,
    usage: accumulatedUsage,
  };
}

// ---------------------------------------------------------------------------
// タイムアウトラッパー
// ---------------------------------------------------------------------------

/**
 * runSpecialist を Promise.race でタイムアウト付きで実行する。
 * タイムアウト時は status: "timeout" の SpecialistResult を返す。
 */
export async function runSpecialistWithTimeout(
  params: RunSpecialistWithTimeoutParams,
): Promise<SpecialistResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...specialistParams } = params;
  const startedAt = Date.now();

  const timeoutPromise: Promise<SpecialistResult> = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          agent: params.agent.name,
          displayName: params.agent.displayName,
          status: "timeout",
          summary: "タイムアウトしました",
          toolCalls: [],
          latencyMs: timeoutMs,
        }),
      timeoutMs,
    ),
  );

  // タイムアウト用の Promise と競争させる
  // createTimeoutPromise は reject するが、ここでは resolve 型の timeout を使う
  // 両者を race させて先に完了した方を返す
  const result = await Promise.race([runSpecialist(specialistParams), timeoutPromise]);

  // runSpecialist が timeout より先に完了した場合、latencyMs を実測値に補正
  // （timeoutPromise が勝った場合は latencyMs: timeoutMs のまま）
  void startedAt; // 実測 latencyMs は runSpecialist 内で計算済み

  return result;
}
