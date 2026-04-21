/**
 * @jest-environment node
 *
 * prompts/shared/style-guide.md の品質テスト
 *
 * タスク: takatsu-connect-advisor-k71.3
 *
 * テスト対象:
 *   - prompts/shared/style-guide.md の存在・フォーマット・内容品質
 *   - validateAllAgents() による include ファイル実在確認（結合テスト）
 *
 * テスト戦略:
 *   - fs.readFileSync で実ファイルを直接読む（モック不使用）
 *   - 結合テストは mkdtempSync で一時ディレクトリを作成し、最小構成のエージェント定義と
 *     style-guide.md のコピーを配置して validateAllAgents() を実行する
 *   - 行数テストは設計書 prompt-design.md §3.4 の 50〜500 行を検証する
 *   - \d+(\.\d+)?% パターンは style-guide.md の §6（記述スタイルの細則）に
 *     「10%」という例示が含まれるため、その例示行を除外して検証する
 *   - \d+件 パターンは §6 に「3件」という例示が含まれるため、同様に例示行を除外する
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { validateAllAgents } from "@/lib/agents/validate";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, "../../../../");
const SHARED_FILE_PATH = path.join(PROJECT_ROOT, "prompts", "shared", "style-guide.md");

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

describe("prompts/shared/style-guide.md", () => {
  // =========================================================================
  // 1. ファイル存在確認
  // =========================================================================

  describe("ファイル存在確認", () => {
    test("prompts/shared/style-guide.md が存在する", () => {
      // Act & Assert
      expect(existsSync(SHARED_FILE_PATH)).toBe(true);
    });
  });

  // =========================================================================
  // 以降のテストはファイルが存在する前提で実行する
  // =========================================================================

  describe("フォーマット確認", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SHARED_FILE_PATH, "utf-8");
    });

    test("YAMLフロントマターを含まない（'---' で始まらない）", () => {
      // shared/ ファイルはフロントマター不要（include.ts で gray-matter strip するが、
      // style-guide.md は純粋な Markdown として運用する）
      expect(content.startsWith("---")).toBe(false);
    });

    test("空ファイルではない（1文字以上の内容がある）", () => {
      expect(content.trim().length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. 必須キーワードの含有確認
  // =========================================================================

  describe("必須キーワードの含有確認", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SHARED_FILE_PATH, "utf-8");
    });

    test("'スタイルガイド' が含まれる（見出し）", () => {
      expect(content).toContain("スタイルガイド");
    });

    test("'ですます調' が含まれる（敬語セクション）", () => {
      expect(content).toContain("ですます調");
    });

    test("'禁止事項' が含まれる（セクション見出し）", () => {
      expect(content).toContain("禁止事項");
    });

    test("'推測' が含まれる（数値引用ルール）", () => {
      expect(content).toContain("推測");
    });

    test("'要確認' が含まれる（未検証情報の扱い）", () => {
      expect(content).toContain("要確認");
    });
  });

  // =========================================================================
  // 4. 禁止項目の不在確認（リアルタイム系の具体数値）
  // =========================================================================

  describe("禁止項目の不在確認", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(SHARED_FILE_PATH, "utf-8");
    });

    test("'月間PV' 等の具体的なPV数パターンを含まない（月間\\d+PV|\\d+万PV）", () => {
      // リアルタイムな数値は共通知識ファイルに含めず、ツール経由で取得する方針
      const pvPattern = /月間\d+\s*PV|\d+万\s*PV/;
      expect(pvPattern.test(content)).toBe(false);
    });

    test("'何月何日時点' 等の日付付き情報パターンを含まない（\\d+月\\d+日時点）", () => {
      // 特定時点のデータは共通知識に含めない
      const datePointPattern = /\d+月\d+日時点/;
      expect(datePointPattern.test(content)).toBe(false);
    });

    test("'〇月時点' 等の月次スナップショットパターンを含まない", () => {
      const monthPointPattern = /\d+月時点/;
      expect(monthPointPattern.test(content)).toBe(false);
    });

    test("'\\d+%' 等のKPI数値パターンを含まない（CTR・CVR等の具体数値）", () => {
      // §6（記述スタイルの細則）に「10%」という例示が含まれるため、
      // 例示として列挙している行（「10%」「3件」「1,200セッション」等を含む行）を除外して検証する。
      // CTR・CVR等のKPI具体数値は動的データのため共通知識に含めない。
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      const filteredContent = lines
        .filter(
          (line) =>
            !line.includes("1,200セッション") && !line.includes("10%") && !line.includes("3件"),
        )
        .join("\n");
      const kpiPercentPattern = /\d+(\.\d+)?%/;
      expect(kpiPercentPattern.test(filteredContent)).toBe(false);
    });

    test("'\\d+位' 等の検索順位パターンを含まない", () => {
      // 検索順位はリアルタイムデータのため共通知識に含めない
      const rankPattern = /\d+位/;
      expect(rankPattern.test(content)).toBe(false);
    });

    test("'\\d+件' 等の件数パターンを含まない（記事数・コメント数等の具体数値）", () => {
      // §6（記述スタイルの細則）に「3件」という例示が含まれるため、
      // 例示として列挙している行を除外して検証する。
      // 記事数等の動的な件数は共通知識に含めない。
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      const filteredContent = lines
        .filter(
          (line) =>
            !line.includes("1,200セッション") && !line.includes("10%") && !line.includes("3件"),
        )
        .join("\n");
      const countPattern = /\d+件/;
      expect(countPattern.test(filteredContent)).toBe(false);
    });
  });

  // =========================================================================
  // 5. 行数範囲確認（prompt-design.md §3.4: 50〜500 行）
  // =========================================================================

  describe("行数範囲確認（prompt-design.md §3.4）", () => {
    let lines: string[];

    beforeAll(() => {
      const content = readFileSync(SHARED_FILE_PATH, "utf-8");
      // CRLF と LF を統一してから split する（Windows 環境での改行コード差異を吸収）
      lines = content.replace(/\r\n/g, "\n").split("\n");
    });

    test("行数が 50 行以上である（下限: 設計書 §3.4）", () => {
      expect(lines.length).toBeGreaterThanOrEqual(50);
    });

    test("行数が 500 行以下である（上限: 設計書 §3.4）", () => {
      expect(lines.length).toBeLessThanOrEqual(500);
    });
  });
});

// ---------------------------------------------------------------------------
// 結合テスト: validateAllAgents による include ファイル実在確認
//
// 一時ディレクトリを使ってエージェント定義と style-guide.md のコピーを配置し、
// validateAllAgents() の include 解決ロジックが正常に動作することを検証する。
// ---------------------------------------------------------------------------

describe("validateAllAgents による style-guide.md の include 参照整合性", () => {
  let tmpDir: string;

  beforeEach(() => {
    // 一時ディレクトリを作成して最小構成の prompts/ 構造を構築する
    tmpDir = mkdtempSync(path.join(tmpdir(), "style-guide-shared-test-"));

    const promptsDir = path.join(tmpDir, "prompts");
    const agentsDir = path.join(promptsDir, "agents");
    const sharedDir = path.join(promptsDir, "shared");

    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    // 実際の style-guide.md をコピーして shared/ に配置する
    const realContent = readFileSync(SHARED_FILE_PATH, "utf-8");
    writeFileSync(path.join(sharedDir, "style-guide.md"), realContent, "utf-8");

    // style-guide.md を include する最小限のエージェント定義を作成する
    const agentSource = [
      "---",
      "name: test-agent",
      "displayName: テストエージェント",
      "description: include 参照テスト用のエージェント定義。",
      "include:",
      "  - shared/style-guide.md",
      "---",
      "",
      "あなたはスタイルガイドに従って回答する専門家です。",
    ].join("\n");
    writeFileSync(path.join(agentsDir, "test-agent.md"), agentSource, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("style-guide.md を include している agent がある場合、include_missing エラーが出ない", async () => {
    // Arrange: tmpDir 下の prompts/ ディレクトリを指定して検証
    const promptsDir = path.join(tmpDir, "prompts");

    // Act
    const result = await validateAllAgents({ promptsDir });

    // Assert: style-guide.md に関する include_missing エラーが出ない
    const includeMissingErrors = result.errors.filter(
      (e) => e.type === "include_missing" && e.message.includes("style-guide.md"),
    );
    expect(includeMissingErrors).toHaveLength(0);
  });

  test("validateAllAgents がエージェントを1件認識し、agentCount が 1 である", async () => {
    // Arrange
    const promptsDir = path.join(tmpDir, "prompts");

    // Act
    const result = await validateAllAgents({ promptsDir });

    // Assert: agents_dir_missing が出ず、agentCount が 1 であること
    // （prompts/agents/ に .md ファイルが1件配置されているため）
    const agentsDirWarning = result.warnings.find((w) => w.type === "agents_dir_missing");
    expect(agentsDirWarning).toBeUndefined();
    expect(result.agentCount).toBe(1);
  });

  test("存在しない shared ファイルを include している agent は include_missing エラーになる（include 解決が機能している）", async () => {
    // Arrange: style-guide.md を参照するエージェントに加えて、
    // 存在しないファイルを参照するエージェントを追加して include 解決が動いていることを確認する
    const promptsDir = path.join(tmpDir, "prompts");
    const agentsDir = path.join(promptsDir, "agents");

    const agentWithMissingInclude = [
      "---",
      "name: missing-include-agent",
      "displayName: 不在include確認エージェント",
      "description: 存在しない shared ファイルを include するエージェント。",
      "include:",
      "  - shared/does-not-exist.md",
      "---",
      "",
      "あなたはテスト用エージェントです。",
    ].join("\n");
    writeFileSync(
      path.join(agentsDir, "missing-include-agent.md"),
      agentWithMissingInclude,
      "utf-8",
    );

    // Act
    const result = await validateAllAgents({ promptsDir });

    // Assert: does-not-exist.md に関する include_missing エラーが検出される
    // （include 解決ロジックが実際に動作している証拠）
    const missingErrors = result.errors.filter(
      (e) => e.type === "include_missing" && e.message.includes("does-not-exist.md"),
    );
    expect(missingErrors.length).toBeGreaterThan(0);

    // style-guide.md 自体は存在するのでエラーにならない
    const sgMissingErrors = result.errors.filter(
      (e) => e.type === "include_missing" && e.message.includes("style-guide.md"),
    );
    expect(sgMissingErrors).toHaveLength(0);
  });
});
