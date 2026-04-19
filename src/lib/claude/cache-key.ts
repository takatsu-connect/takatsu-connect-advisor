/**
 * キャッシュキー生成ユーティリティ
 *
 * 設計書: doc/design/agent-system-design.md §9.3 ローカル完全一致キャッシュ
 *
 * Anthropic リクエストのキャッシュキー対象フィールドを安定シリアライズして
 * SHA-256 ダイジェスト（16進数 64 文字）を返す。
 *
 * 安定シリアライズの方針:
 * - オブジェクトのキーを再帰的にソートした JSON を生成する
 * - undefined のフィールドは JSON.stringify と同様に除外する
 * - cache_control フィールドはキャッシュキー計算から除外する
 *   （Prompt Caching の制御フィールドであり、実際のリクエスト内容には影響しない）
 * - max_tokens はキャッシュキーに含める（出力長が変わる可能性があるため）
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * キャッシュキー計算の入力型。
 * 設計書 §9.3 のコード例に従い、model / system / tools / messages を対象とする。
 * max_tokens も含める（出力長に影響するため）。
 * temperature は含める（応答の決定論性に影響するため）。
 */
export interface CacheKeyInput {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  /**
   * system プロンプト。
   * string または TextBlockParam 配列（cache_control を含む場合あり）。
   * cache_control フィールドはキャッシュキー計算から除外される。
   */
  system?: unknown;
  /**
   * ツール定義配列。
   * cache_control フィールドはキャッシュキー計算から除外される。
   */
  tools?: unknown;
  temperature?: number;
  /**
   * 最大トークン数。出力長に影響するため含める。
   */
  max_tokens?: number;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * cache_control フィールドを再帰的に除外した値を返す。
 * Prompt Caching の制御フィールドはキャッシュキーの同一性判定に不要。
 */
function removeCacheControl(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(removeCacheControl);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key === "cache_control") continue;
      result[key] = removeCacheControl(obj[key]);
    }
    return result;
  }
  return value;
}

/**
 * オブジェクトのキーを再帰的にソートして JSON 文字列化する。
 * JSON.stringify はキー挿入順に依存するため、呼び出し元がキーを追加する順序に
 * よってハッシュが変わる問題を防ぐ。
 *
 * - undefined の値を持つキーは除外する（JSON.stringify と同じ挙動）
 * - null は保持する
 * - 配列は要素順を保持する（ソートしない）
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  // オブジェクト: キーをソートして列挙
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    // undefined のフィールドは除外（JSON.stringify と同じ挙動）
    if (v === undefined) continue;
    pairs.push(JSON.stringify(k) + ":" + stableStringify(v));
  }
  return "{" + pairs.join(",") + "}";
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * Anthropic リクエストの「キャッシュキー対象フィールド」を安定シリアライズして
 * SHA-256 ダイジェスト（16進数 64 文字）を返す。
 *
 * 同一入力であれば必ず同一ハッシュが返る（オブジェクトキー順序に依存しない）。
 *
 * @param input キャッシュキー計算の入力
 * @returns SHA-256 ダイジェスト（16進数 64 文字）
 */
export function cacheKey(input: CacheKeyInput): string {
  // cache_control フィールドを除外してから安定シリアライズ
  const sanitized = removeCacheControl(input);
  const serialized = stableStringify(sanitized);
  return createHash("sha256").update(serialized, "utf-8").digest("hex");
}
