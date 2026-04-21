/**
 * include 展開ロジック
 *
 * AgentDefinition の include フィールドに列挙された shared ファイルを読み込み、
 * systemPrompt の先頭に prepend して新しい AgentDefinition を返す。
 *
 * 設計書: doc/design/agent-system-design.md §4.4
 *        doc/design/prompt-design.md §3
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { AgentDefinition } from "./types";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 環境変数で上書き可能な prompts/ ディレクトリのデフォルトパス */
const DEFAULT_PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.join(process.cwd(), "prompts");

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * include パスのパストラバーサル検証。
 *
 * 条件:
 * 1. パスが `shared/` で始まること
 * 2. path.resolve 後の絶対パスが promptsDir 配下に収まること
 *
 * @throws {Error} パスが不正な場合
 */
function validateIncludePath(rel: string, promptsDir: string): void {
  // shared/ で始まらないパスを拒否（path traversal の第一関門）
  if (!rel.startsWith("shared/")) {
    throw new Error(`[expandIncludes] include パスは "shared/" で始まる必要があります: "${rel}"`);
  }

  // path.resolve して promptsDir の外に出ないか検証
  const resolved = path.resolve(promptsDir, rel);
  const resolvedPromptsDir = path.resolve(promptsDir);
  if (!resolved.startsWith(resolvedPromptsDir + path.sep) && resolved !== resolvedPromptsDir) {
    throw new Error(
      `[expandIncludes] include パスが prompts/ ディレクトリ外を指しています: "${rel}"`,
    );
  }
}

/**
 * 単一の shared ファイルを読み込み、フロントマターを除いた本文を返す。
 *
 * @throws {Error} ファイルが読み込めない場合（filePath を含むメッセージ）
 */
async function readSharedFile(filePath: string, rel: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(
      `[expandIncludes] include ファイルの読み込みに失敗しました: "${rel}" (${filePath})`,
    );
  }

  // gray-matter でフロントマターを除去し、本文のみを取得
  return matter(raw).content.trim();
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

export interface ExpandIncludesOptions {
  /**
   * prompts/ ディレクトリの絶対パス。
   * 未指定の場合は環境変数 PROMPTS_DIR または process.cwd()/prompts を使用。
   */
  promptsDir?: string;
}

/**
 * AgentDefinition の include フィールドに列挙された shared ファイルを読み込み、
 * systemPrompt の先頭に prepend して新しい AgentDefinition を返す。
 *
 * 展開ルール（設計書 prompt-design.md §3.2 / §3.3）:
 * 1. include 配列の順序通り各ファイルの本文を連結し、systemPrompt の先頭に prepend する
 * 2. 各 include ファイルは `<!-- shared/xxx.md -->` の HTML コメント見出しで区切る
 * 3. 本文中の `{{include:shared/xxx.md}}` マーカーも解決する
 * 4. 最終結合形式: [...included, "---", body].join("\n\n")
 * 5. include が undefined または空配列の場合はそのまま definition を返す
 * 6. 1段階展開のみ（shared ファイル内の include は展開しない）
 *
 * パストラバーサル防御:
 * - include パスは "shared/" で始まること
 * - path.resolve 後が promptsDir 配下に収まること
 *
 * @param definition パース済みの AgentDefinition
 * @param options オプション（promptsDir の上書き等）
 * @returns include 展開済みの新しい AgentDefinition
 * @throws {Error} include パスが不正な場合、またはファイルの読み込みに失敗した場合
 */
export async function expandIncludes(
  definition: AgentDefinition,
  options?: ExpandIncludesOptions,
): Promise<AgentDefinition> {
  // include がなければ何もしない
  if (!definition.include || definition.include.length === 0) {
    return definition;
  }

  const promptsDir = options?.promptsDir ? path.resolve(options.promptsDir) : DEFAULT_PROMPTS_DIR;

  const includes = definition.include;

  // 各 include パスを検証・読み込み
  const includedParts: string[] = [];
  for (const rel of includes) {
    // パストラバーサル検証
    validateIncludePath(rel, promptsDir);

    const filePath = path.resolve(promptsDir, rel);
    const content = await readSharedFile(filePath, rel);

    // 設計書 §3.2: `<!-- shared/xxx.md -->` 形式の見出しで区切る
    includedParts.push(`<!-- ${rel} -->\n${content}`);
  }

  // 本文中の {{include:shared/xxx.md}} マーカーを解決（設計書 §3.3）
  let body = definition.systemPrompt;
  const inlinePattern = /\{\{include:([^}]+)\}\}/g;
  const inlineMatches = [...body.matchAll(inlinePattern)];

  if (inlineMatches.length > 0) {
    for (const match of inlineMatches) {
      const rel = match[1].trim();
      // パストラバーサル検証
      validateIncludePath(rel, promptsDir);

      const filePath = path.resolve(promptsDir, rel);
      const content = await readSharedFile(filePath, rel);
      body = body.replace(match[0], content);
    }
  }

  // 設計書 §3.3: [...included, "---", result].join("\n\n")
  const expandedSystemPrompt = [...includedParts, "---", body].join("\n\n");

  return {
    ...definition,
    systemPrompt: expandedSystemPrompt,
  };
}
