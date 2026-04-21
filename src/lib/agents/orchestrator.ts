/**
 * Orchestrator エージェント
 *
 * Specialist の ok 結果配列 + 履歴を受け、ユーザーへの統合応答を
 * ストリーミングで生成する。
 *
 * 設計書: doc/design/agent-system-design.md §8
 */

import "server-only";
import type {
  MessageParam,
  RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import { anthropic } from "@/lib/claude/client";
import { classifyApiError } from "@/lib/claude/api-error";
import type { AgentDefinition, AgentUsage, SpecialistResult } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface RunOrchestratorParams {
  /** Orchestrator の AgentDefinition */
  orchestrator: AgentDefinition;
  /** 直近履歴（呼び出し側で件数制限済み） */
  messages: MessageParam[];
  /** ok 状態の Specialist 結果（空配列可） */
  specialistResults: SpecialistResult[];
  /** キャンセル用 AbortSignal（タイムアウト制御は呼び出し側責務） */
  signal?: AbortSignal;
}

export interface OrchestratorTextDelta {
  type: "delta";
  text: string;
}

export interface OrchestratorDoneEvent {
  type: "done";
  /** 全テキスト結合 */
  fullText: string;
  usage?: AgentUsage;
  latencyMs: number;
}

export interface OrchestratorErrorEvent {
  type: "error";
  error: string;
  latencyMs: number;
}

export type OrchestratorEvent =
  | OrchestratorTextDelta
  | OrchestratorDoneEvent
  | OrchestratorErrorEvent;

// ---------------------------------------------------------------------------
// 内部ヘルパー: XML エスケープ
// ---------------------------------------------------------------------------

/**
 * XML 特殊文字をエスケープする（属性値にも対応）。
 */
function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ---------------------------------------------------------------------------
// 内部ヘルパー: specialist 結果 XML ビルド
// ---------------------------------------------------------------------------

/**
 * SpecialistResult 配列を <specialist_results> XML 文字列に変換する。
 * 結果が空の場合は空文字を返す。
 */
function buildSpecialistResultsXml(results: SpecialistResult[]): string {
  if (results.length === 0) return "";
  const lines = ["<specialist_results>"];
  for (const r of results) {
    lines.push(`<result agent="${escapeXml(r.agent)}" status="${escapeXml(r.status)}">`);
    lines.push(escapeXml(r.summary));
    lines.push(`</result>`);
  }
  lines.push("</specialist_results>");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 内部ヘルパー: system プロンプト構築
// ---------------------------------------------------------------------------

/**
 * orchestrator.systemPrompt の末尾に specialist 結果 XML を差し込んで
 * 最終的な system 文字列を組み立てる。
 */
function buildSystemPrompt(
  baseSystemPrompt: string,
  specialistResults: SpecialistResult[],
): string {
  const xml = buildSpecialistResultsXml(specialistResults);
  if (!xml) return baseSystemPrompt;
  return `${baseSystemPrompt}\n\n${xml}`;
}

// ---------------------------------------------------------------------------
// メイン: ストリーミング AsyncGenerator
// ---------------------------------------------------------------------------

/**
 * Orchestrator エージェントをストリーミングで実行する AsyncGenerator。
 *
 * - text_delta を受け取るたびに `OrchestratorTextDelta` を yield する
 * - ストリーム終了時に `OrchestratorDoneEvent` を yield する
 * - エラー発生時に `OrchestratorErrorEvent` を yield して generator を終了する
 */
export async function* runOrchestratorStream(
  params: RunOrchestratorParams,
): AsyncGenerator<OrchestratorEvent, void, unknown> {
  const { orchestrator, messages, specialistResults, signal } = params;
  const startedAt = Date.now();

  const systemPrompt = buildSystemPrompt(orchestrator.systemPrompt, specialistResults);

  let stream: AsyncIterable<RawMessageStreamEvent>;
  try {
    stream = await anthropic.messages.create(
      {
        model: orchestrator.model,
        max_tokens: orchestrator.maxTokens ?? 2048,
        temperature: orchestrator.temperature ?? 0.7,
        system: systemPrompt,
        messages,
        stream: true,
      },
      { signal },
    );
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const kind = classifyApiError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield {
      type: "error",
      error: `API リクエスト失敗 (${kind}): ${errorMessage}`,
      latencyMs,
    };
    return;
  }

  let fullText = "";
  let usage: AgentUsage | undefined;

  // message_start で input_tokens を取得するための変数
  let inputTokens = 0;
  let cacheCreationInputTokens: number | null = null;
  let cacheReadInputTokens: number | null = null;

  try {
    for await (const event of stream) {
      // AbortSignal が発火した場合にループを抜ける
      if (signal?.aborted) {
        yield {
          type: "error",
          error: "ストリーミングがキャンセルされました",
          latencyMs: Date.now() - startedAt,
        };
        return;
      }

      if (event.type === "message_start") {
        // message_start の usage から input 系トークン数を取得
        const u = event.message.usage;
        inputTokens = u.input_tokens;
        cacheCreationInputTokens = u.cache_creation_input_tokens ?? null;
        cacheReadInputTokens = u.cache_read_input_tokens ?? null;
      } else if (event.type === "content_block_delta") {
        const { delta } = event;
        if (delta.type === "text_delta") {
          fullText += delta.text;
          yield { type: "delta", text: delta.text };
        }
      } else if (event.type === "message_delta") {
        // message_delta の usage から output_tokens を取得
        const deltaUsage = event.usage;
        usage = {
          input_tokens: inputTokens,
          output_tokens: deltaUsage.output_tokens,
          cache_creation_input_tokens: cacheCreationInputTokens ?? 0,
          cache_read_input_tokens: cacheReadInputTokens ?? 0,
        };
      }
      // message_stop / content_block_start / content_block_stop は何もしない
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    // AbortSignal 由来のエラーかを判定
    if (signal?.aborted) {
      yield {
        type: "error",
        error: "ストリーミングがキャンセルされました",
        latencyMs,
      };
      return;
    }

    const kind = classifyApiError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield {
      type: "error",
      error: `ストリーミング中にエラーが発生しました (${kind}): ${errorMessage}`,
      latencyMs,
    };
    return;
  }

  yield {
    type: "done",
    fullText,
    usage,
    latencyMs: Date.now() - startedAt,
  };
}
