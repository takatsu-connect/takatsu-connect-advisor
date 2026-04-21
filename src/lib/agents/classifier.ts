/**
 * Classifier エージェント
 *
 * ユーザー入力を読み、呼び出すべき専門家エージェントを選定する。
 * Claude Haiku 4.5 + JSON 構造化応答（tool_use は使わない）。
 *
 * 設計書: doc/design/agent-system-design.md §6
 */

import "server-only";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { anthropic } from "@/lib/claude/client";
import { classifyApiError } from "@/lib/claude/api-error";
import type { AgentDefinition, AgentUsage, ClassifierResult } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const CLASSIFIER_TIMEOUT_MS = 5000;

const FALLBACK_RESULT: ClassifierResult = {
  specialists: [],
  reasoning: "classifier失敗のため統合のみで応答",
};

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface RunClassifierParams {
  /** classifier の AgentDefinition（include 展開済みシステムプロンプトを含む） */
  classifier: AgentDefinition;
  /** Claude API に渡すメッセージ履歴（呼び出し側で件数制限済み） */
  messages: MessageParam[];
  /** 有効な specialist name の許可リスト（loaderから取得） */
  allowedSpecialists: string[];
  /** キャンセルシグナル（省略可） */
  signal?: AbortSignal;
}

export type RunClassifierStatus = "ok" | "timeout" | "parse_error" | "api_error";

export interface RunClassifierReturn {
  result: ClassifierResult;
  status: RunClassifierStatus;
  /** 実行時間（ミリ秒） */
  latencyMs: number;
  /** Claude API の使用トークン情報（失敗時は undefined） */
  usage?: AgentUsage;
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`classifier timeout after ${ms}ms`)), ms),
  );
}

/**
 * Claude API レスポンスの content[0].text を ClassifierResult に変換する。
 * パース失敗・型不一致はすべて null を返す（呼び出し側でフォールバック処理）。
 */
function parseClassifierResponse(text: string): ClassifierResult | null {
  // JSON コードブロックで囲まれている場合を考慮してテキストを前処理する
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.specialists)) {
    return null;
  }

  // specialists の各要素が string であることを確認
  const specialists = obj.specialists.filter((s): s is string => typeof s === "string");

  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";

  return { specialists, reasoning };
}

/**
 * 許可リストに存在しない専門家名をフィルタする。
 */
function filterAllowedSpecialists(specialists: string[], allowedSpecialists: string[]): string[] {
  const allowedSet = new Set(allowedSpecialists);
  return specialists.filter((name) => allowedSet.has(name));
}

// ---------------------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------------------

export async function runClassifier(params: RunClassifierParams): Promise<RunClassifierReturn> {
  const { classifier, messages, allowedSpecialists, signal } = params;
  const startedAt = Date.now();

  const classifierPromise = anthropic.messages.create(
    {
      model: classifier.model,
      max_tokens: classifier.maxTokens ?? 256,
      temperature: classifier.temperature ?? 0.2,
      system: classifier.systemPrompt,
      messages,
    },
    { signal },
  );

  let rawResponse: Awaited<typeof classifierPromise>;
  try {
    rawResponse = await Promise.race([
      classifierPromise,
      createTimeoutPromise(CLASSIFIER_TIMEOUT_MS),
    ]);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    // タイムアウト判定
    if (error instanceof Error && error.message.startsWith("classifier timeout")) {
      return {
        result: FALLBACK_RESULT,
        status: "timeout",
        latencyMs,
      };
    }

    // API エラー判定（api-error.ts の分類関数を活用）
    const kind = classifyApiError(error);
    if (kind !== "unknown") {
      return {
        result: FALLBACK_RESULT,
        status: "api_error",
        latencyMs,
      };
    }

    // その他の予期しないエラー
    return {
      result: FALLBACK_RESULT,
      status: "api_error",
      latencyMs,
    };
  }

  const latencyMs = Date.now() - startedAt;

  // usage を AgentUsage 形式に変換
  // AgentUsage は Pick<Usage, ...> であり、SDK の Usage 型をそのまま引き継ぐ
  const usage: AgentUsage = rawResponse.usage;

  // content[0] が text ブロックであることを確認
  const firstBlock = rawResponse.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    return {
      result: FALLBACK_RESULT,
      status: "parse_error",
      latencyMs,
      usage,
    };
  }

  // JSON パース
  const parsed = parseClassifierResponse(firstBlock.text);
  if (!parsed) {
    return {
      result: FALLBACK_RESULT,
      status: "parse_error",
      latencyMs,
      usage,
    };
  }

  // 許可リストでフィルタ
  const filteredSpecialists = filterAllowedSpecialists(parsed.specialists, allowedSpecialists);

  return {
    result: {
      specialists: filteredSpecialists,
      reasoning: parsed.reasoning,
    },
    status: "ok",
    latencyMs,
    usage,
  };
}
