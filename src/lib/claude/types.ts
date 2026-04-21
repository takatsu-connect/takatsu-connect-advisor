/**
 * Claude API 共通型定義
 *
 * - Anthropic SDK に依存しない独自型定義
 * - SDK の型が変わっても内部型を安定させる意図で分離する
 */

// ---------------------------------------------------------------------------
// トークン使用量
// ---------------------------------------------------------------------------

/**
 * Claude API レスポンスのトークン使用量。
 * prompt caching 使用時は cache_creation_input_tokens / cache_read_input_tokens が付与される。
 */
export type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

// ---------------------------------------------------------------------------
// メッセージ
// ---------------------------------------------------------------------------

export type ClaudeMessageRole = "user" | "assistant";

export type ClaudeMessage = {
  role: ClaudeMessageRole;
  content: string | ClaudeContentBlock[];
};

// ---------------------------------------------------------------------------
// コンテンツブロック（discriminated union）
// ---------------------------------------------------------------------------

export type ClaudeTextBlock = {
  type: "text";
  text: string;
};

export type ClaudeToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ClaudeToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | ClaudeContentBlock[];
  is_error?: boolean;
};

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock;

// ---------------------------------------------------------------------------
// 停止理由
// ---------------------------------------------------------------------------

export type ClaudeStopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";

// ---------------------------------------------------------------------------
// ストリーミング
// ---------------------------------------------------------------------------

/**
 * ストリーミングデルタ。SSE の `content_block_delta` イベントで受け取るテキスト差分。
 */
export type StreamDelta = {
  delta: string;
};

// ---------------------------------------------------------------------------
// キャッシュ格納値
// ---------------------------------------------------------------------------

/**
 * localCache に格納する Chat 結果の型。
 * 生成元: src/lib/claude/local-cache.ts の `LocalCache<CachedChatResult>`
 */
export type CachedChatResult = {
  text: string;
  usage: ClaudeUsage;
  stopReason: ClaudeStopReason;
};
