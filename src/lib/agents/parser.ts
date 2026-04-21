/**
 * エージェント定義パーサー
 *
 * gray-matter を使って Markdown フロントマターをパースし、
 * AgentDefinition 型に変換する純粋関数。
 * ファイル I/O は行わない（loader.ts の責務）。
 *
 * 設計書: doc/design/agent-system-design.md §4
 *        doc/design/prompt-design.md §3
 */

import matter from "gray-matter";
import { z } from "zod";
import type { AgentDefinition } from "./types";

// ---------------------------------------------------------------------------
// フロントマタースキーマ
// ---------------------------------------------------------------------------

/**
 * エージェント定義 Markdown のフロントマタースキーマ。
 * 設計書 §4.3 の FRONTMATTER_SCHEMA に対応。
 */
const frontmatterSchema = z.object({
  /** エージェント識別子。^[a-z0-9-]+$ 形式 */
  name: z.string().regex(/^[a-z0-9-]+$/, {
    message: "name は小文字英数字とハイフンのみ使用できます（例: seo-specialist）",
  }),
  /** UI / トレース表示用の日本語名 */
  displayName: z.string().min(1, { message: "displayName は必須です" }),
  /** カード表示・トレース用の説明文 */
  description: z.string().min(1, { message: "description は必須です" }),
  /**
   * エージェントの役割。
   * 未指定時は "specialist" をデフォルト値とする。
   */
  role: z.enum(["classifier", "orchestrator", "specialist"]).default("specialist"),
  /**
   * 使用モデル（例: "claude-haiku-4-5"）。
   * 未指定時はローダーが role ごとの環境変数で解決する。
   * パーサーでは空文字列をデフォルトとして AgentDefinition.model に格納する。
   */
  model: z.string().optional(),
  /** 利用可能なツール名の配列 */
  tools: z.array(z.string()).default([]),
  /** include 展開対象のパス配列（prompts/ 配下の相対パス） */
  include: z.array(z.string()).default([]),
  /** temperature (0〜1) */
  temperature: z.number().min(0).max(1).optional(),
  /** max_tokens (正の整数) */
  maxTokens: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

export interface ParseAgentDefinitionOptions {
  /** ロード元ファイルパス（エラーメッセージに使用） */
  filePath: string;
  /** .md ファイルの中身全文 */
  source: string;
  /** ファイルの mtime（ms）。ホットリロード検知用 */
  mtimeMs: number;
}

/**
 * Markdown フロントマター付きソースを受け取り、AgentDefinition を返す。
 *
 * - gray-matter でフロントマター（YAML）と本文を分離する
 * - zod でフロントマターを検証する
 * - 本文（gray-matter の content）をそのまま systemPrompt に使用する
 *   （include 展開はローダーの責務）
 * - 必須フィールド欠落・型不一致・role が union 外の場合はエラーを throw する
 *
 * @throws {Error} バリデーション失敗時（メッセージにファイルパスを含む）
 *
 * @example
 * ```ts
 * const source = `---
 * name: seo-specialist
 * displayName: SEO専門家
 * description: 検索流入・キーワード分析・SEO施策を担当する。
 * role: specialist
 * model: claude-haiku-4-5
 * tools:
 *   - query_search_console
 *   - fetch_webpage
 * temperature: 0.4
 * maxTokens: 1024
 * ---
 *
 * あなたは地域メディアのSEO専門家です。
 * `;
 *
 * const def = parseAgentDefinition({
 *   filePath: "prompts/agents/seo-specialist.md",
 *   source,
 *   mtimeMs: Date.now(),
 * });
 * // def.name => "seo-specialist"
 * // def.systemPrompt => "\nあなたは地域メディアのSEO専門家です。\n"
 * ```
 */
export function parseAgentDefinition(options: ParseAgentDefinitionOptions): AgentDefinition {
  const { filePath, source, mtimeMs } = options;

  // gray-matter でフロントマターと本文を分離
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(source);
  } catch (err) {
    throw new Error(
      `[parseAgentDefinition] フロントマターの解析に失敗しました: ${filePath}\n${err}`,
    );
  }

  // zod でフロントマターをバリデーション
  const result = frontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[parseAgentDefinition] フロントマターのバリデーションに失敗しました: ${filePath}\n${issues}`,
    );
  }

  const fm = result.data;

  // AgentDefinition に詰めて返す
  // model が未指定の場合は空文字列をセット（ローダーが role 別環境変数で解決する）
  const agentDefinition: AgentDefinition = {
    name: fm.name,
    displayName: fm.displayName,
    description: fm.description,
    role: fm.role,
    model: fm.model ?? "",
    systemPrompt: parsed.content,
    tools: fm.tools,
    ...(fm.temperature !== undefined && { temperature: fm.temperature }),
    ...(fm.maxTokens !== undefined && { maxTokens: fm.maxTokens }),
    ...(fm.include.length > 0 && { include: fm.include }),
    filePath,
    mtimeMs,
  };

  return agentDefinition;
}
