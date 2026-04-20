/**
 * @jest-environment node
 *
 * prompts/shared/takatsu-connect.md の品質テスト
 *
 * タスク: takatsu-connect-advisor-k71.1
 *
 * テスト対象:
 *   - prompts/shared/takatsu-connect.md の存在・フォーマット・内容品質
 *   - validateAllAgents() による include ファイル実在確認（結合テスト）
 *
 * テスト戦略:
 *   - fs.readFileSync で実ファイルを直接読む（モック不使用）
 *   - 結合テストは mkdtempSync で一時ディレクトリを作成し、最小構成のエージェント定義と
 *     takatsu-connect.md のコピーを配置して validateAllAgents() を実行する
 *   - 行数テストは設計書 prompt-design.md §3.4 の 50〜500 行を検証する
 *     ※ 現状 49 行のため失敗する — takatsu-connect.md の内容追記で修正すること
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { validateAllAgents } from "@/lib/agents/validate";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, "../../../../");
const SHARED_FILE_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "shared",
  "takatsu-connect.md",
);

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

describe("prompts/shared/takatsu-connect.md", () => {
  // =========================================================================
  // 1. ファイル存在確認
  // =========================================================================

  describe("ファイル存在確認", () => {
    test("prompts/shared/takatsu-connect.md が存在する", () => {
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
      // takatsu-connect.md は純粋な Markdown として運用する）
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

    test("'高津コネクト' が含まれる", () => {
      expect(content).toContain("高津コネクト");
    });

    test("'takatsu-connect.com' が含まれる", () => {
      expect(content).toContain("takatsu-connect.com");
    });

    test("'川崎市高津区' が含まれる", () => {
      expect(content).toContain("川崎市高津区");
    });

    test("'まちの企画室' が含まれる", () => {
      expect(content).toContain("まちの企画室");
    });

    test("'WordPress' が含まれる", () => {
      expect(content).toContain("WordPress");
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
      // CTR・CVR等のKPI具体数値は動的データのため共通知識に含めない
      const kpiPercentPattern = /\d+(\.\d+)?%/;
      expect(kpiPercentPattern.test(content)).toBe(false);
    });

    test("'\\d+位' 等の検索順位パターンを含まない", () => {
      // 検索順位はリアルタイムデータのため共通知識に含めない
      const rankPattern = /\d+位/;
      expect(rankPattern.test(content)).toBe(false);
    });

    test("'\\d+件' 等の件数パターンを含まない（記事数・コメント数等の具体数値）", () => {
      // 記事数等の動的な件数は共通知識に含めない
      const countPattern = /\d+件/;
      expect(countPattern.test(content)).toBe(false);
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
      // 現状 49 行のためこのテストは失敗する。
      // takatsu-connect.md に 1 行以上の内容を追記して修正すること。
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
// 一時ディレクトリを使ってエージェント定義と takatsu-connect.md のコピーを配置し、
// validateAllAgents() の include 解決ロジックが正常に動作することを検証する。
// ---------------------------------------------------------------------------

describe("validateAllAgents による takatsu-connect.md の include 参照整合性", () => {
  let tmpDir: string;

  beforeEach(() => {
    // 一時ディレクトリを作成して最小構成の prompts/ 構造を構築する
    tmpDir = mkdtempSync(path.join(tmpdir(), "takatsu-connect-shared-test-"));

    const promptsDir = path.join(tmpDir, "prompts");
    const agentsDir = path.join(promptsDir, "agents");
    const sharedDir = path.join(promptsDir, "shared");

    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    // 実際の takatsu-connect.md をコピーして shared/ に配置する
    const realContent = readFileSync(SHARED_FILE_PATH, "utf-8");
    writeFileSync(path.join(sharedDir, "takatsu-connect.md"), realContent, "utf-8");

    // takatsu-connect.md を include する最小限のエージェント定義を作成する
    const agentSource = [
      "---",
      "name: test-agent",
      "displayName: テストエージェント",
      "description: include 参照テスト用のエージェント定義。",
      "include:",
      "  - shared/takatsu-connect.md",
      "---",
      "",
      "あなたは高津コネクトの運営をサポートする専門家です。",
    ].join("\n");
    writeFileSync(path.join(agentsDir, "test-agent.md"), agentSource, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("takatsu-connect.md を include している agent がある場合、include_missing エラーが出ない", async () => {
    // Arrange: tmpDir 下の prompts/ ディレクトリを指定して検証
    const promptsDir = path.join(tmpDir, "prompts");

    // Act
    const result = await validateAllAgents({ promptsDir });

    // Assert: takatsu-connect.md に関する include_missing エラーが出ない
    const includeMissingErrors = result.errors.filter(
      (e) =>
        e.type === "include_missing" &&
        e.message.includes("takatsu-connect.md"),
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
    const agentsDirWarning = result.warnings.find(
      (w) => w.type === "agents_dir_missing",
    );
    expect(agentsDirWarning).toBeUndefined();
    expect(result.agentCount).toBe(1);
  });

  test("存在しない shared ファイルを include している agent は include_missing エラーになる（include 解決が機能している）", async () => {
    // Arrange: takatsu-connect.md を参照するエージェントに加えて、
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
      (e) =>
        e.type === "include_missing" &&
        e.message.includes("does-not-exist.md"),
    );
    expect(missingErrors.length).toBeGreaterThan(0);

    // takatsu-connect.md 自体は存在するのでエラーにならない
    const tcMissingErrors = result.errors.filter(
      (e) =>
        e.type === "include_missing" &&
        e.message.includes("takatsu-connect.md"),
    );
    expect(tcMissingErrors).toHaveLength(0);
  });
});
