/**
 * エージェント定義ローダー（mtime キャッシュ付き）
 *
 * prompts/agents/*.md をファイルシステムから読み込み、AgentDefinition を返す。
 * キャッシュはモジュールレベルの Map で管理し、mtime が変化した場合のみ再読み込みを行う。
 *
 * 設計書: doc/design/agent-system-design.md §4
 */

import "server-only";
import { stat, readFile } from "node:fs/promises";
import { expandIncludes } from "./include";
import { parseAgentDefinition } from "./parser";
import type { AgentDefinition } from "./types";

// ---------------------------------------------------------------------------
// キャッシュ（モジュールレベル・プロセス内シングルトン）
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  definition: AgentDefinition;
}

/** filePath をキーとするエージェント定義キャッシュ */
const agentCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 単一エージェント定義をファイルからロードする（mtime キャッシュあり）。
 *
 * - 初回: stat → readFile → parse → キャッシュ保存
 * - 2回目以降: stat で mtime を確認し、一致すればキャッシュを返す。不一致なら再読み込みしてキャッシュを更新。
 *
 * @param filePath 読み込む .md ファイルのパス（絶対パス・相対パスどちらも可）
 * @throws {Error} ファイルが存在しない場合、またはパースに失敗した場合
 */
export async function loadAgentDefinition(filePath: string): Promise<AgentDefinition> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(filePath);
  } catch {
    throw new Error(`[loadAgentDefinition] ファイルが見つかりません: ${filePath}`);
  }

  const currentMtimeMs = stats.mtimeMs;
  const cached = agentCache.get(filePath);

  // mtime が一致する場合はキャッシュをそのまま返す
  if (cached !== undefined && cached.mtimeMs === currentMtimeMs) {
    return cached.definition;
  }

  // mtime 不一致（または未キャッシュ）の場合は再読み込み・再パース
  let source: string;
  try {
    source = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`[loadAgentDefinition] ファイルの読み込みに失敗しました: ${filePath}`);
  }

  const parsed = parseAgentDefinition({ filePath, source, mtimeMs: currentMtimeMs });
  const definition = await expandIncludes(parsed);

  agentCache.set(filePath, { mtimeMs: currentMtimeMs, definition });

  return definition;
}

/**
 * エージェント定義キャッシュを全件クリアする。
 * テスト・ホットリロード用。
 */
export function clearAgentCache(): void {
  agentCache.clear();
}

/**
 * 現在のキャッシュ状態を返す。
 * テスト・デバッグ用。
 */
export function getAgentCacheStats(): { size: number } {
  return { size: agentCache.size };
}
