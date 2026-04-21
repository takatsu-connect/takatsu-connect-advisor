/**
 * エージェント定義バリデーション CLI スクリプト
 *
 * 使用方法:
 *   pnpm validate:agents
 *   または
 *   tsx scripts/validate-agents.ts
 *
 * 検証項目:
 *   1. prompts/agents/*.md のスキーマ検証（frontmatter の zod バリデーション）
 *   2. include ファイルの実在確認
 *   3. tools が src/lib/tools/schemas.ts に登録されているか
 *   4. role: classifier / role: orchestrator は各1件のみ
 *   5. name の一意性
 *   6. classifier-agents-list.md との diff 確認（warning）
 *   7. プロンプトサイズ警告（20,000 文字超え）
 *
 * 設計書: doc/design/agent-system-design.md §4.6
 *        doc/design/prompt-design.md §9
 */

import path from "node:path";
import { validateAllAgents } from "../src/lib/agents/validate";
import type { ValidationError, ValidationWarning } from "../src/lib/agents/validate";

// ---------------------------------------------------------------------------
// 出力ユーティリティ
// ---------------------------------------------------------------------------

function formatError(err: ValidationError): string {
  const fileName = path.basename(err.filePath);
  return `  ✗ [${err.type}] ${fileName}: ${err.message}`;
}

function formatWarning(warn: ValidationWarning): string {
  return `  ⚠ [${warn.type}] ${warn.message}`;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  console.log("Validating agent definitions...\n");

  const result = await validateAllAgents();

  // 警告を表示
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warn of result.warnings) {
      console.log(formatWarning(warn));
    }
    console.log();
  }

  // エラーを表示
  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const err of result.errors) {
      console.error(formatError(err));
    }
    console.error();
    console.error(
      `✗ Validation failed: ${result.agentCount} agents, ${result.errors.length} error(s)`,
    );
    process.exit(1);
  }

  console.log(`✅ Validation passed: ${result.agentCount} agents, 0 errors`);
  process.exit(0);
}

// トップレベル呼び出し（テストで import した場合は呼ばれない）
main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
