/**
 * Prompt Caching ヘルパ
 *
 * Anthropic Prompt Caching の cache_control: { type: "ephemeral" } フラグを
 * リクエストオブジェクトの特定位置に付与するためのユーティリティ関数群。
 *
 * 設計書: doc/design/prompt-design.md §5 Prompt Caching 戦略
 *
 * 使用側 (4l4.2) では system / tools / messages それぞれの末尾に対して
 * 以下のように呼び出す:
 *
 *   system:   systemWithCacheControl(agentDef.systemPrompt)
 *   tools:    addCacheControlToLast(tools)
 *   messages: addCacheControlToLastMessage(messages)
 */

import type {
  CacheControlEphemeral,
  ContentBlockParam,
  TextBlockParam,
  ToolUnion,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

// ---------------------------------------------------------------------------
// 内部型
// ---------------------------------------------------------------------------

/** cache_control フィールドを持てるオブジェクト */
type WithOptionalCacheControl = {
  cache_control?: CacheControlEphemeral | null;
};

// ---------------------------------------------------------------------------
// cache_control 定数
// ---------------------------------------------------------------------------

const CACHE_CONTROL_EPHEMERAL: CacheControlEphemeral = { type: "ephemeral" } as const;

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 単一ブロックに cache_control を付与して返す。
 * 元のオブジェクトは変更しない（イミュータブル）。
 *
 * @param block - cache_control フィールドを持てる任意のオブジェクト
 * @returns cache_control: { type: "ephemeral" } が付与された新しいオブジェクト
 *
 * @example
 * const tool = withCacheControl(myTool);
 * // => { ...myTool, cache_control: { type: "ephemeral" } }
 */
export function withCacheControl<T extends WithOptionalCacheControl>(
  block: T,
): T & { cache_control: CacheControlEphemeral } {
  return { ...block, cache_control: CACHE_CONTROL_EPHEMERAL };
}

/**
 * 配列の末尾要素にのみ cache_control を付与して返す。
 * 末尾以外の要素は変更しない。空配列の場合はそのまま返す。
 * 元の配列・要素は変更しない（イミュータブル）。
 *
 * Anthropic API の仕様: 配列の末尾要素に cache_control を付与することで
 * 配列全体がキャッシュ境界となる。
 *
 * tools 配列に対して使用する。messages 配列に対しては
 * {@link addCacheControlToLastMessage} を使用すること。
 *
 * @param blocks - cache_control フィールドを持てるオブジェクトの配列
 * @returns 末尾要素にのみ cache_control が付与された新しい配列
 *
 * @example
 * // tools 配列末尾にキャッシュブレークポイントを設定
 * const toolsWithCache = addCacheControlToLast(tools);
 */
export function addCacheControlToLast<T extends WithOptionalCacheControl>(
  blocks: readonly T[],
): T[] {
  if (blocks.length === 0) {
    return [];
  }
  const result = [...blocks] as T[];
  result[result.length - 1] = withCacheControl(result[result.length - 1]);
  return result;
}

/**
 * system プロンプト（文字列 または TextBlockParam 配列）の末尾に
 * cache_control を付与して TextBlockParam[] 形式に統一して返す。
 *
 * - 文字列の場合: `[{ type: "text", text, cache_control }]` に変換
 * - TextBlockParam[] の場合: 末尾要素にのみ cache_control を付与
 * - 空文字列の場合: 空配列を返す
 *
 * Anthropic API の `system` フィールドは string | TextBlockParam[] を受け付けるが、
 * cache_control を付与するには TextBlockParam[] 形式でなければならない。
 *
 * @param system - エージェントのシステムプロンプト（文字列 または TextBlockParam[]）
 * @returns cache_control 付きの TextBlockParam[]
 *
 * @example
 * // 文字列からの変換
 * const systemBlocks = systemWithCacheControl("あなたはSEO専門家です。");
 * // => [{ type: "text", text: "あなたはSEO専門家です。", cache_control: { type: "ephemeral" } }]
 *
 * @example
 * // TextBlockParam[] の末尾に付与
 * const systemBlocks = systemWithCacheControl([
 *   { type: "text", text: "共通知識ブロック" },
 *   { type: "text", text: "エージェント固有ブロック" },
 * ]);
 * // => [
 * //   { type: "text", text: "共通知識ブロック" },
 * //   { type: "text", text: "エージェント固有ブロック", cache_control: { type: "ephemeral" } },
 * // ]
 */
export function systemWithCacheControl(system: string | TextBlockParam[]): TextBlockParam[] {
  if (typeof system === "string") {
    if (system.length === 0) {
      return [];
    }
    return [{ type: "text", text: system, cache_control: CACHE_CONTROL_EPHEMERAL }];
  }

  return addCacheControlToLast(system);
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * ContentBlockParam の中で cache_control フィールドを持たない型。
 * Anthropic API 仕様上、ThinkingBlockParam / RedactedThinkingBlockParam には
 * cache_control を付与できない。
 */
type ContentBlockWithoutCacheControl = {
  type: "thinking" | "redacted_thinking";
};

/** ContentBlockParam が cache_control を付与可能かどうかを判定する型ガード */
function isCacheControlCapable(
  block: ContentBlockParam,
): block is Exclude<ContentBlockParam, ContentBlockWithoutCacheControl> {
  return block.type !== "thinking" && block.type !== "redacted_thinking";
}

// ---------------------------------------------------------------------------
// メッセージ向け公開 API
// ---------------------------------------------------------------------------

/**
 * 単一の MessageParam の content 末尾ブロックに cache_control を付与して返す。
 * 元のメッセージ・content 配列は変更しない（イミュータブル）。
 *
 * - content が string の場合: `[{ type: "text", text, cache_control }]` に変換した
 *   新しい MessageParam を返す
 * - content が ContentBlockParam[] の場合: 末尾要素に cache_control を付与した
 *   新しい content を持つ新しい MessageParam を返す
 * - content が空配列の場合: 元の MessageParam をそのまま返す
 * - 末尾ブロックが cache_control 非対応型（thinking / redacted_thinking）の場合:
 *   元の MessageParam をそのまま返す
 *
 * @param message - cache_control を付与する MessageParam
 * @returns content 末尾ブロックに cache_control が付与された新しい MessageParam
 *
 * @example
 * // content が文字列の場合
 * const msg = withCacheControlOnLastContentBlock({ role: "user", content: "こんにちは" });
 * // => { role: "user", content: [{ type: "text", text: "こんにちは", cache_control: { type: "ephemeral" } }] }
 *
 * @example
 * // content が ContentBlockParam[] の場合
 * const msg = withCacheControlOnLastContentBlock({
 *   role: "user",
 *   content: [
 *     { type: "text", text: "ブロック1" },
 *     { type: "text", text: "ブロック2" },
 *   ],
 * });
 * // => { role: "user", content: [
 * //   { type: "text", text: "ブロック1" },
 * //   { type: "text", text: "ブロック2", cache_control: { type: "ephemeral" } },
 * // ]}
 */
export function withCacheControlOnLastContentBlock(message: MessageParam): MessageParam {
  const { content } = message;

  if (typeof content === "string") {
    return {
      ...message,
      content: [{ type: "text", text: content, cache_control: CACHE_CONTROL_EPHEMERAL }],
    };
  }

  // ContentBlockParam[] の場合
  if (content.length === 0) {
    return message;
  }

  const lastBlock = content[content.length - 1];

  // thinking / redacted_thinking は cache_control 非対応のためそのまま返す
  if (!isCacheControlCapable(lastBlock)) {
    return message;
  }

  const newContent: ContentBlockParam[] = [
    ...content.slice(0, content.length - 1),
    { ...lastBlock, cache_control: CACHE_CONTROL_EPHEMERAL },
  ];

  return { ...message, content: newContent };
}

/**
 * messages 配列末尾の 1 メッセージの content 末尾ブロックに
 * cache_control を付与した新しい配列を返す。
 * 元の配列・メッセージ・content 配列は変更しない（イミュータブル）。
 *
 * - 空配列の場合: 空配列をそのまま返す
 *
 * @param messages - cache_control を付与する MessageParam の配列
 * @returns 末尾メッセージの content 末尾ブロックに cache_control が付与された新しい配列
 *
 * @example
 * // messages 配列末尾のメッセージにキャッシュブレークポイントを設定
 * const messagesWithCache = addCacheControlToLastMessage(messages);
 */
export function addCacheControlToLastMessage(messages: readonly MessageParam[]): MessageParam[] {
  if (messages.length === 0) {
    return [];
  }

  const result: MessageParam[] = [...messages];
  result[result.length - 1] = withCacheControlOnLastContentBlock(result[result.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// 型エイリアス（呼び出し側の利便性のため再エクスポート）
// ---------------------------------------------------------------------------

export type { CacheControlEphemeral, ContentBlockParam, TextBlockParam, ToolUnion, MessageParam };
