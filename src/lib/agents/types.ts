/**
 * エージェントシステムのコア型定義
 *
 * 設計書: doc/design/agent-system-design.md
 */

import type { MessageParam, Usage } from "@anthropic-ai/sdk/resources/messages/messages.js";

// ---------------------------------------------------------------------------
// AgentRole
// ---------------------------------------------------------------------------

/**
 * エージェントの役割を表すリテラル union。
 * - classifier: 呼ぶべき専門家を選定する
 * - orchestrator: 専門家の結果を統合してストリーミング応答を生成する
 * - specialist: 担当領域の知見 + tool_use で中間回答を返す
 */
export type AgentRole = "classifier" | "orchestrator" | "specialist";

// ---------------------------------------------------------------------------
// AgentDefinition
// ---------------------------------------------------------------------------

/**
 * prompts/agents/*.md からロードされたエージェント定義。
 * ローダーが mtime キャッシュとともに管理する。
 */
export interface AgentDefinition {
  /** エージェント識別子（例: "seo-specialist"）。^[a-z0-9-]+$ 形式 */
  name: string;
  /** UI / トレース表示用の日本語名（例: "SEO専門家"） */
  displayName: string;
  /** カード表示・トレース用の説明文 */
  description: string;
  /** エージェントの役割 */
  role: AgentRole;
  /**
   * 使用モデル（例: "claude-haiku-4-5"）。
   * フロントマターで未指定の場合は role ごとの環境変数で解決する。
   */
  model: string;
  /** include 展開済みのシステムプロンプト本文 */
  systemPrompt: string;
  /** 利用可能なツール名の配列（例: ["query_search_console", "fetch_webpage"]） */
  tools: string[];
  temperature?: number;
  maxTokens?: number;
  /** 参考情報として保持する include パス配列（再ロード検知用） */
  include?: string[];
  /** ロード元ファイルパス */
  filePath: string;
  /** ホットリロード検知用の最終更新時刻（ms） */
  mtimeMs: number;
}

// ---------------------------------------------------------------------------
// ToolCallLog
// ---------------------------------------------------------------------------

/** specialist が tool_use を実行した際の記録 */
export interface ToolCallLog {
  /** ツール名（例: "query_search_console"） */
  tool: string;
  /** ツールへの入力値 */
  input: unknown;
  /** 実行成功フラグ */
  ok: boolean;
  /** 実行時間（ミリ秒） */
  ms: number;
}

// ---------------------------------------------------------------------------
// SpecialistResult
// ---------------------------------------------------------------------------

/** specialist 実行の結果ステータス */
export type SpecialistResultStatus = "ok" | "timeout" | "error" | "skipped";

/**
 * specialist エージェントが返すサマリ。
 * 設計書 §7.2 に対応。
 */
export interface SpecialistResult {
  /** エージェント識別子 */
  agent: string;
  /** UI 表示用の日本語名 */
  displayName: string;
  /** 実行結果ステータス */
  status: SpecialistResultStatus;
  /** LLM が生成した最終テキスト（中間回答） */
  summary: string;
  /** tool_use の実行記録 */
  toolCalls: ToolCallLog[];
  /** 実行時間（ミリ秒） */
  latencyMs: number;
  /** Claude API の使用トークン情報 */
  usage?: AgentUsage;
}

// ---------------------------------------------------------------------------
// ClassifierResult
// ---------------------------------------------------------------------------

/**
 * Classifier エージェントが返す選定結果。
 * 設計書 §6.2 に対応。
 */
export interface ClassifierResult {
  /** 呼ぶべき specialist の name 配列 */
  specialists: string[];
  /** 選定理由（80 文字以内を目安） */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------

/**
 * 3 段階パイプライン全体で共有されるコンテキスト。
 * Classifier → Specialists → Orchestrator の各フェーズを横断して利用される。
 * 設計書 §9 に対応。
 */
export interface PipelineContext {
  /** リクエスト追跡用 ID */
  requestId: string;
  /** 認証済みユーザーの ID */
  userId: string;
  /** Supabase 上のチャットセッション ID */
  sessionId: string;
  /**
   * Claude API に渡す直近メッセージ履歴（CONTEXT_MESSAGE_LIMIT 件以下）。
   * Anthropic SDK の MessageParam 型を再利用する。
   */
  messages: MessageParam[];
  /** Classifier の選定結果（Specialists フェーズ以降で参照） */
  classifierResult?: ClassifierResult;
  /** 各 specialist の実行結果（Orchestrator フェーズで参照） */
  specialistResults?: SpecialistResult[];
  /** リクエスト受付時刻（ms）。タイムアウト計算に使用 */
  startedAt: number;
}

// ---------------------------------------------------------------------------
// AgentUsage（Claude API の Usage の部分集合）
// ---------------------------------------------------------------------------

/**
 * エージェント実行時の Claude API トークン使用量。
 * Anthropic SDK の Usage 型から必要なプロパティのみを抽出する。
 */
export type AgentUsage = Pick<
  Usage,
  "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens"
>;

// ---------------------------------------------------------------------------
// AggregatedUsage
// ---------------------------------------------------------------------------

/**
 * パイプライン全体の集計トークン使用量。
 * /api/chat の `usage` SSE イベントで送出するデータ形式。
 * 設計書 §3.5 (api-design.md) に対応。
 */
export interface AggregatedUsage {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** クライアントに送ったコンテキストのメッセージ件数 */
  contextCount: number;
}
