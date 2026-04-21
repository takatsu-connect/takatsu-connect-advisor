/**
 * 3段階パイプライン: Classifier → Specialists（並列） → Orchestrator（ストリーミング）
 *
 * Graceful degradation:
 *   - Specialist がタイムアウト/エラーになっても status 付きで結果に含める
 *   - Orchestrator には status: "ok" のもののみ渡す
 *   - 全 Specialist が失敗しても Orchestrator は空配列で呼ぶ（知識ベースのみで回答）
 *
 * 設計書: doc/design/agent-system-design.md §7.6, §9.1
 */

import "server-only";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { AgentDefinition, ClassifierResult, SpecialistResult } from "@/lib/agents/types";
import { runClassifier } from "@/lib/agents/classifier";
import { runSpecialistWithTimeout } from "@/lib/agents/specialist";
import type { RunToolFn, ToolRunContext } from "@/lib/agents/specialist";
import { runOrchestratorStream } from "@/lib/agents/orchestrator";

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface PipelineParams {
  /** Classifier エージェント定義 */
  classifier: AgentDefinition;
  /** Orchestrator エージェント定義 */
  orchestrator: AgentDefinition;
  /**
   * 全 specialist 定義の辞書（name → AgentDefinition）。
   * classifier が返した specialist 名の解決に使う。
   */
  specialists: Record<string, AgentDefinition>;
  /** 履歴メッセージ（呼び出し側で件数制限済み） */
  messages: MessageParam[];
  /** 各 specialist agent.tools の解決済み Tool スキーマ（toolName → Tool） */
  toolSchemas: Record<string, Tool>;
  /** ツール実行器（DI） */
  runTool: RunToolFn;
  /** runTool に渡すコンテキスト */
  toolContext: ToolRunContext;
  /** specialist タイムアウト（デフォルト 8000ms） */
  specialistTimeoutMs?: number;
  /** 中止シグナル */
  signal?: AbortSignal;
}

/** パイプラインが yield する全イベント種別 */
export type PipelineEvent =
  | { type: "classification"; classification: ClassifierResult }
  | { type: "specialist_start"; agent: string; displayName: string }
  | { type: "specialist_result"; result: SpecialistResult }
  | { type: "orchestrator_delta"; text: string }
  | { type: "orchestrator_done"; fullText: string; latencyMs: number }
  | { type: "orchestrator_error"; error: string; latencyMs: number };

export interface PipelineFinalResult {
  classification: ClassifierResult;
  /** 全結果（ok + timeout + error + skipped） */
  specialistResults: SpecialistResult[];
  /** orchestrator に渡したサブセット（status: "ok" のみ） */
  okSpecialistResults: SpecialistResult[];
  fullText: string;
  totalLatencyMs: number;
}

// ---------------------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------------------

/**
 * 3段階パイプラインを AsyncGenerator として実行する。
 *
 * yield: PipelineEvent（各フェーズの進行状況）
 * return: PipelineFinalResult（全フェーズ完了後のまとめ）
 */
export async function* runChatPipeline(
  params: PipelineParams,
): AsyncGenerator<PipelineEvent, PipelineFinalResult, unknown> {
  const startedAt = Date.now();

  // -------------------------------------------------------------------------
  // Phase 1: Classifier
  // -------------------------------------------------------------------------

  const classifierReturn = await runClassifier({
    classifier: params.classifier,
    messages: params.messages,
    allowedSpecialists: Object.keys(params.specialists),
    signal: params.signal,
  });

  const classifierResult = classifierReturn.result;
  yield { type: "classification", classification: classifierResult };

  // -------------------------------------------------------------------------
  // Phase 2: Specialists（並列）
  // -------------------------------------------------------------------------

  // classifier が返した specialist 名を AgentDefinition に解決する。
  // 存在しない名前はスキップする（allowedSpecialists でフィルタ済みのはずだが念のため）。
  const selectedAgents: AgentDefinition[] = classifierResult.specialists
    .map((name) => params.specialists[name])
    .filter((a): a is AgentDefinition => !!a);

  // specialist_start を全件 yield（並列実行開始の通知）
  for (const agent of selectedAgents) {
    yield { type: "specialist_start", agent: agent.name, displayName: agent.displayName };
  }

  let specialistResults: SpecialistResult[] = [];

  if (selectedAgents.length > 0) {
    // Promise.all で並列実行する。各 specialist は独立して timeout/error を返す。
    specialistResults = await Promise.all(
      selectedAgents.map((agent) =>
        runSpecialistWithTimeout({
          agent,
          messages: params.messages,
          tools: agent.tools.map((t) => params.toolSchemas[t]).filter((t): t is Tool => !!t),
          runTool: params.runTool,
          toolContext: params.toolContext,
          timeoutMs: params.specialistTimeoutMs ?? 8000,
          signal: params.signal,
        }),
      ),
    );
  }

  // 各 specialist の結果（成否問わず）を yield する
  for (const result of specialistResults) {
    yield { type: "specialist_result", result };
  }

  // ----------------------------------------------------------------
  // Graceful degradation のコア:
  //   status: "ok" のものだけを Orchestrator に渡す。
  //   timeout/error/skipped の結果はノイズとなるため除外する。
  //   空配列でも Orchestrator は呼ぶ（知識ベースのみで回答させる）。
  // ----------------------------------------------------------------
  const okResults = specialistResults.filter((r) => r.status === "ok");

  // -------------------------------------------------------------------------
  // Phase 3: Orchestrator（ストリーミング、常に呼ぶ）
  // -------------------------------------------------------------------------

  let fullText = "";

  const orchestratorStream = runOrchestratorStream({
    orchestrator: params.orchestrator,
    messages: params.messages,
    specialistResults: okResults, // 空配列でも可
    signal: params.signal,
  });

  for await (const ev of orchestratorStream) {
    // OrchestratorEvent の各種別を PipelineEvent に変換して yield する
    if (ev.type === "delta") {
      fullText += ev.text;
      yield { type: "orchestrator_delta", text: ev.text };
    } else if (ev.type === "done") {
      // ev.fullText は orchestrator 内で結合済みのため fullText と一致するはずだが
      // ここでは ev.fullText を正としてローカル変数も更新する
      fullText = ev.fullText;
      yield { type: "orchestrator_done", fullText: ev.fullText, latencyMs: ev.latencyMs };
    } else if (ev.type === "error") {
      yield { type: "orchestrator_error", error: ev.error, latencyMs: ev.latencyMs };
    }
  }

  // -------------------------------------------------------------------------
  // 戻り値
  // -------------------------------------------------------------------------

  return {
    classification: classifierResult,
    specialistResults,
    okSpecialistResults: okResults,
    fullText,
    totalLatencyMs: Date.now() - startedAt,
  };
}
