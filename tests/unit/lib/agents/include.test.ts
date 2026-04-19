/**
 * @jest-environment node
 *
 * src/lib/agents/include.ts の単体テスト
 *
 * テスト対象:
 *   - expandIncludes(definition, options?): include 配列と {{include:}} マーカーを展開する
 *
 * テスト戦略:
 *   - mkdtempSync で一時ディレクトリを作成し、shared/ サブディレクトリ内に shared ファイルを書き出す
 *   - options.promptsDir で一時ディレクトリを指定する
 *   - afterEach で一時ディレクトリを削除してクリーンアップする
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { expandIncludes } from "@/lib/agents/include";
import type { AgentDefinition } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** 最小有効 AgentDefinition を生成する */
function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "test-agent",
    displayName: "テストエージェント",
    description: "テスト用エージェント。",
    role: "specialist",
    model: "",
    systemPrompt: "\nあなたは専門家です。\n",
    tools: [],
    filePath: "prompts/agents/test-agent.md",
    mtimeMs: 1_700_000_000_000,
    ...overrides,
  };
}

/** gray-matter 形式のフロントマター付き shared ファイル内容を生成する */
function buildSharedFileWithFrontmatter(content: string): string {
  return [
    "---",
    "title: 共有知識",
    "version: 1",
    "---",
    "",
    content,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

describe("expandIncludes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "agent-include-"));
    // shared/ サブディレクトリを作成
    mkdirSync(path.join(tmpDir, "shared"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 正常系
  // -------------------------------------------------------------------------

  test("1. include が undefined → definition そのまま返す（参照同一性）", async () => {
    // Arrange
    const def = buildDefinition({ include: undefined });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: 同じオブジェクト参照
    expect(result).toBe(def);
  });

  test("2. include が空配列 → definition そのまま返す（参照同一性）", async () => {
    // Arrange
    const def = buildDefinition({ include: [] });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: 同じオブジェクト参照
    expect(result).toBe(def);
  });

  test("3. 1つの shared ファイルを読み込み prepend する（フロントマター付き → content のみが展開される）", async () => {
    // Arrange: gray-matter フロントマター付き shared ファイル
    const sharedContent = "# 共通知識\nこれは共有コンテンツです。";
    writeFileSync(
      path.join(tmpDir, "shared", "knowledge.md"),
      buildSharedFileWithFrontmatter(sharedContent),
      "utf-8"
    );

    const def = buildDefinition({
      include: ["shared/knowledge.md"],
      systemPrompt: "\n本文プロンプト\n",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: フロントマターが除去されて content のみが含まれる
    expect(result.systemPrompt).toContain(sharedContent);
    // タイトル YAML は含まれない
    expect(result.systemPrompt).not.toContain("title: 共有知識");
    // 本文も含まれる
    expect(result.systemPrompt).toContain("本文プロンプト");
  });

  test("4. 複数の shared ファイルを配列順に連結する", async () => {
    // Arrange
    writeFileSync(
      path.join(tmpDir, "shared", "first.md"),
      "最初の共有内容",
      "utf-8"
    );
    writeFileSync(
      path.join(tmpDir, "shared", "second.md"),
      "2番目の共有内容",
      "utf-8"
    );

    const def = buildDefinition({
      include: ["shared/first.md", "shared/second.md"],
      systemPrompt: "\n本文\n",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: 配列順に連結されている
    const idx1 = result.systemPrompt.indexOf("最初の共有内容");
    const idx2 = result.systemPrompt.indexOf("2番目の共有内容");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeLessThan(idx2);
  });

  test("5. 結合形式 `<!-- rel -->\\n${content}\\n\\n---\\n\\n${body}` を完全一致で検証", async () => {
    // Arrange
    const sharedContent = "共有コンテンツ本文";
    writeFileSync(
      path.join(tmpDir, "shared", "takatsu.md"),
      sharedContent,
      "utf-8"
    );

    const body = "\n本文プロンプト\n";
    const def = buildDefinition({
      include: ["shared/takatsu.md"],
      systemPrompt: body,
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: 結合形式の完全一致
    // 設計書 §3.3: [...included, "---", body].join("\n\n")
    // included は `<!-- shared/takatsu.md -->\n${content}` 形式
    const expectedSystemPrompt = [
      `<!-- shared/takatsu.md -->\n${sharedContent}`,
      "---",
      body,
    ].join("\n\n");

    expect(result.systemPrompt).toBe(expectedSystemPrompt);
  });

  test("6. {{include:shared/xxx.md}} マーカーが body に含まれる場合、該当位置に挿入される", async () => {
    // Arrange
    // 注意: include 配列が undefined/空配列の場合は早期 return されるため、
    // マーカーのみの場合はマーカー展開も行われない（実装仕様）。
    // マーカー展開は include 配列に 1 件以上ある場合に実行される。
    const markerContent = "マーカー挿入コンテンツ";
    writeFileSync(
      path.join(tmpDir, "shared", "marker.md"),
      markerContent,
      "utf-8"
    );
    // prepend 用の別ファイルも用意して include 配列を有効にする
    writeFileSync(
      path.join(tmpDir, "shared", "prepend-for-marker-test.md"),
      "prepend 内容",
      "utf-8"
    );

    const def = buildDefinition({
      // include 配列に 1 件設定して早期 return を回避する
      include: ["shared/prepend-for-marker-test.md"],
      systemPrompt: "前半テキスト\n{{include:shared/marker.md}}\n後半テキスト",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: マーカーが対応ファイルの本文で置換されている
    expect(result.systemPrompt).toContain("前半テキスト");
    expect(result.systemPrompt).toContain(markerContent);
    expect(result.systemPrompt).toContain("後半テキスト");
    // マーカー自体は残っていない
    expect(result.systemPrompt).not.toContain("{{include:shared/marker.md}}");
  });

  test("7. マーカーと include 配列の両方を同時に処理できる", async () => {
    // Arrange
    writeFileSync(
      path.join(tmpDir, "shared", "prepend.md"),
      "prepend コンテンツ",
      "utf-8"
    );
    writeFileSync(
      path.join(tmpDir, "shared", "inline.md"),
      "inline コンテンツ",
      "utf-8"
    );

    const def = buildDefinition({
      include: ["shared/prepend.md"],
      systemPrompt: "本文開始\n{{include:shared/inline.md}}\n本文終了",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: prepend も inline も両方展開されている
    expect(result.systemPrompt).toContain("prepend コンテンツ");
    expect(result.systemPrompt).toContain("inline コンテンツ");
    expect(result.systemPrompt).toContain("本文開始");
    expect(result.systemPrompt).toContain("本文終了");
    // マーカーは置換済み
    expect(result.systemPrompt).not.toContain("{{include:");
  });

  // -------------------------------------------------------------------------
  // 異常系
  // -------------------------------------------------------------------------

  test("8. include パスが `shared/` で始まらない → throw", async () => {
    // Arrange
    const def = buildDefinition({
      include: ["../../../etc/passwd"],
    });

    // Act & Assert
    await expect(expandIncludes(def, { promptsDir: tmpDir })).rejects.toThrow();
  });

  test("8b. include パスが `shared/` で始まらない（絶対パス形式）→ throw", async () => {
    // Arrange
    const def = buildDefinition({
      include: ["/etc/passwd"],
    });

    // Act & Assert
    await expect(expandIncludes(def, { promptsDir: tmpDir })).rejects.toThrow(
      'shared/'
    );
  });

  test("9. path.resolve 後に promptsDir の外に出るパス → throw", async () => {
    // Arrange: shared/ で始まるが .. で外に出るパス
    const def = buildDefinition({
      include: ["shared/../../../etc/passwd"],
    });

    // Act & Assert
    await expect(expandIncludes(def, { promptsDir: tmpDir })).rejects.toThrow();
  });

  test("10. include ファイルが存在しない → throw（メッセージに rel と filePath を含む）", async () => {
    // Arrange: shared ディレクトリはあるがファイルが存在しない
    const rel = "shared/nonexistent.md";
    const def = buildDefinition({
      include: [rel],
    });

    // Act & Assert
    await expect(expandIncludes(def, { promptsDir: tmpDir })).rejects.toThrow(rel);
  });

  test("10b. 存在しないファイルのエラーメッセージに filePath が含まれる", async () => {
    // Arrange
    const rel = "shared/missing-file.md";
    const expectedFilePath = path.resolve(tmpDir, rel);
    const def = buildDefinition({
      include: [rel],
    });

    // Act & Assert
    await expect(expandIncludes(def, { promptsDir: tmpDir })).rejects.toThrow(expectedFilePath);
  });

  // -------------------------------------------------------------------------
  // 境界値
  // -------------------------------------------------------------------------

  test("11. shared ファイルがフロントマター無しの純本文 → そのまま content として読み込める", async () => {
    // Arrange: フロントマターなしのプレーンテキスト
    const plainContent = "フロントマターなしの純粋な本文です。";
    writeFileSync(
      path.join(tmpDir, "shared", "plain.md"),
      plainContent,
      "utf-8"
    );

    const def = buildDefinition({
      include: ["shared/plain.md"],
      systemPrompt: "\n本文\n",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: コンテンツがそのまま展開される
    expect(result.systemPrompt).toContain(plainContent);
  });

  test("12. shared ファイル内部に include: がフロントマター定義されていても、それは展開しない（1段階のみ）", async () => {
    // Arrange: shared ファイル自体が include フロントマターを持つ
    const nestedSharedContent = "ネストされた共有コンテンツ";
    writeFileSync(
      path.join(tmpDir, "shared", "nested-ref.md"),
      nestedSharedContent,
      "utf-8"
    );

    const sharedWithInclude = [
      "---",
      "include:",
      "  - shared/nested-ref.md",
      "---",
      "",
      "shared ファイルの本文（1段階目）",
    ].join("\n");

    writeFileSync(
      path.join(tmpDir, "shared", "with-include.md"),
      sharedWithInclude,
      "utf-8"
    );

    const def = buildDefinition({
      include: ["shared/with-include.md"],
      systemPrompt: "\n本文\n",
    });

    // Act
    const result = await expandIncludes(def, { promptsDir: tmpDir });

    // Assert: 1段階目の本文は展開されるが、nested-ref の内容は展開されない
    expect(result.systemPrompt).toContain("shared ファイルの本文（1段階目）");
    // ネストされた shared ファイルの内容は展開されない（1段階のみ）
    expect(result.systemPrompt).not.toContain(nestedSharedContent);
    // shared ファイル内の include フロントマター YAML は gray-matter で除去されるので本文には含まれない
    expect(result.systemPrompt).not.toContain("shared/nested-ref.md");
  });
});
