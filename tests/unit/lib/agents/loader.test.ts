/**
 * @jest-environment node
 *
 * src/lib/agents/loader.ts の単体テスト
 *
 * テスト対象:
 *   - loadAgentDefinition(filePath): mtime キャッシュ付きでエージェント定義を返す
 *   - clearAgentCache(): キャッシュを全クリアする
 *   - getAgentCacheStats(): キャッシュ件数を返す
 *
 * モック戦略:
 *   - server-only: Jest の node 環境ではインポートエラーになるためスタブ化
 *   - node:fs/promises の stat / readFile は実ファイルを使用（os.tmpdir() 下に一時ファイル作成）
 *   - mtime 制御: fs.utimesSync() で任意の mtime を設定する
 *   - readFile 呼び出し検証: jest.spyOn(fsp, "readFile") でスパイ
 */

// ---------------------------------------------------------------------------
// モック定義（import より前に定義する必要がある）
// ---------------------------------------------------------------------------

// server-only は node 環境でインポートエラーになるためスタブ化
jest.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  loadAgentDefinition,
  clearAgentCache,
  getAgentCacheStats,
} from "@/lib/agents/loader";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** 最小有効 Markdown ソースを生成する */
function buildValidMd(name = "test-agent", body = "\nあなたは専門家です。\n"): string {
  return [
    "---",
    `name: ${name}`,
    "displayName: テストエージェント",
    "description: テスト用エージェントの説明。",
    "role: specialist",
    "---",
    body,
  ].join("\n");
}

/**
 * ファイルの mtime を指定の Date に変更する。
 * atime は mtime と同じ値を設定して副作用を最小化する。
 */
function setMtime(filePath: string, mtime: Date): void {
  utimesSync(filePath, mtime, mtime);
}

// ---------------------------------------------------------------------------
// describe: loadAgentDefinition - mtime キャッシュ
// ---------------------------------------------------------------------------

describe("loadAgentDefinition (mtime cache)", () => {
  let tmpDir: string;

  beforeEach(() => {
    clearAgentCache();
    tmpDir = mkdtempSync(path.join(tmpdir(), "agent-loader-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 正常系
  // -------------------------------------------------------------------------

  test("1. 初回呼び出し: 正しい .md を読み込み AgentDefinition が返る", async () => {
    // Arrange
    const file = path.join(tmpDir, "test-agent.md");
    writeFileSync(file, buildValidMd("test-agent"), "utf-8");

    // Act
    const def = await loadAgentDefinition(file);

    // Assert
    expect(def.name).toBe("test-agent");
    expect(def.displayName).toBe("テストエージェント");
    expect(def.description).toBe("テスト用エージェントの説明。");
    expect(def.role).toBe("specialist");
    expect(def.filePath).toBe(file);
    expect(typeof def.mtimeMs).toBe("number");
  });

  test("2. 2回目呼び出し（mtime 不変）: 同じオブジェクト参照が返る（キャッシュヒット）", async () => {
    // Arrange
    const file = path.join(tmpDir, "cached-agent.md");
    writeFileSync(file, buildValidMd("cached-agent"), "utf-8");

    // 初回ロード（キャッシュに登録される）
    const def1 = await loadAgentDefinition(file);
    expect(def1.displayName).toBe("テストエージェント");

    // Act: mtime を変えずに（ファイルも変えずに）2 回目呼び出し
    const def2 = await loadAgentDefinition(file);

    // Assert: 同じオブジェクト参照（キャッシュヒット）
    expect(def2).toBe(def1);
    expect(def2.displayName).toBe("テストエージェント");
  });

  test("3. 2回目呼び出し（mtime 変更）: 新しい内容でキャッシュが更新される", async () => {
    // Arrange
    const file = path.join(tmpDir, "updated-agent.md");
    writeFileSync(file, buildValidMd("updated-agent"), "utf-8");

    // 初回ロード
    const def1 = await loadAgentDefinition(file);
    expect(def1.displayName).toBe("テストエージェント");

    // 新しいコンテンツに書き換えて mtime を未来に設定（キャッシュミスを強制）
    const newContent = [
      "---",
      "name: updated-agent",
      "displayName: 更新済みエージェント",
      "description: テスト用エージェントの説明。",
      "role: specialist",
      "---",
      "\n更新後のシステムプロンプト\n",
    ].join("\n");
    writeFileSync(file, newContent, "utf-8");
    setMtime(file, new Date(Date.now() + 5000));

    // Act: mtime が変わっているので再読み込みが発生する
    const def2 = await loadAgentDefinition(file);

    // Assert: 新しい displayName が反映されている
    expect(def2.displayName).toBe("更新済みエージェント");
    // キャッシュが更新されているので def1 とは別オブジェクト
    expect(def2).not.toBe(def1);
    // mtimeMs が更新されている
    expect(def2.mtimeMs).toBeGreaterThan(def1.mtimeMs);
  });

  test("4. 別ファイルの呼び出し: キャッシュは filePath ごとに独立している", async () => {
    // Arrange
    const fileA = path.join(tmpDir, "agent-a.md");
    const fileB = path.join(tmpDir, "agent-b.md");
    writeFileSync(fileA, buildValidMd("agent-a"), "utf-8");
    writeFileSync(fileB, buildValidMd("agent-b"), "utf-8");

    // Act
    const defA = await loadAgentDefinition(fileA);
    const defB = await loadAgentDefinition(fileB);

    // Assert: それぞれ別々のエントリとしてキャッシュされる
    expect(defA.name).toBe("agent-a");
    expect(defB.name).toBe("agent-b");
    expect(getAgentCacheStats().size).toBe(2);

    // 各ファイルの 2 回目呼び出しはキャッシュから同じオブジェクト参照が返る
    const defA2 = await loadAgentDefinition(fileA);
    const defB2 = await loadAgentDefinition(fileB);
    expect(defA2).toBe(defA);
    expect(defB2).toBe(defB);
  });

  test("5. clearAgentCache() 後: キャッシュがクリアされ、次回呼び出しで再読み込みされる", async () => {
    // Arrange
    const file = path.join(tmpDir, "clear-test.md");
    writeFileSync(file, buildValidMd("clear-test"), "utf-8");

    // 初回ロードしてキャッシュに登録
    await loadAgentDefinition(file);
    expect(getAgentCacheStats().size).toBe(1);

    // Act: キャッシュをクリア
    clearAgentCache();

    // Assert: キャッシュが空になる
    expect(getAgentCacheStats().size).toBe(0);

    // 次回呼び出しで再読み込みが発生し、キャッシュが再登録される
    const def2 = await loadAgentDefinition(file);
    expect(getAgentCacheStats().size).toBe(1);
    // 再ロードしても同じコンテンツなので name は同じ
    expect(def2.name).toBe("clear-test");
  });

  // -------------------------------------------------------------------------
  // getAgentCacheStats のテスト
  // -------------------------------------------------------------------------

  test("6a. getAgentCacheStats(): 初期状態でキャッシュサイズは 0", () => {
    // beforeEach で clearAgentCache() が呼ばれているため 0
    expect(getAgentCacheStats().size).toBe(0);
  });

  test("6b. getAgentCacheStats(): ファイルをロードするたびにキャッシュサイズが増える", async () => {
    // Arrange
    const file1 = path.join(tmpDir, "stat-agent-1.md");
    const file2 = path.join(tmpDir, "stat-agent-2.md");
    writeFileSync(file1, buildValidMd("stat-agent-1"), "utf-8");
    writeFileSync(file2, buildValidMd("stat-agent-2"), "utf-8");

    // Act & Assert
    expect(getAgentCacheStats().size).toBe(0);

    await loadAgentDefinition(file1);
    expect(getAgentCacheStats().size).toBe(1);

    await loadAgentDefinition(file2);
    expect(getAgentCacheStats().size).toBe(2);

    // 同じファイルを再ロードしてもサイズは増えない
    await loadAgentDefinition(file1);
    expect(getAgentCacheStats().size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 異常系
  // -------------------------------------------------------------------------

  test("7. 存在しないファイルを指定した場合: エラーが throw され、メッセージに filePath が含まれる", async () => {
    // Arrange
    const nonExistent = path.join(tmpDir, "non-existent-agent.md");

    // Act & Assert
    await expect(loadAgentDefinition(nonExistent)).rejects.toThrow(nonExistent);
  });

  test("8a. 不正な Markdown（frontmatter なし）: parseAgentDefinition のエラーがそのまま throw される", async () => {
    // Arrange: フロントマターブロックなし（必須フィールドが存在しない）
    const file = path.join(tmpDir, "no-frontmatter.md");
    writeFileSync(
      file,
      "あなたは専門家です。フロントマターはありません。",
      "utf-8"
    );

    // Act & Assert: parseAgentDefinition が throw するエラーがそのまま伝播する
    await expect(loadAgentDefinition(file)).rejects.toThrow();
  });

  test("8b. 不正な Markdown（必須フィールド欠落）: parseAgentDefinition のエラーがそのまま throw される", async () => {
    // Arrange: name フィールドが欠落している
    const file = path.join(tmpDir, "missing-name.md");
    writeFileSync(
      file,
      [
        "---",
        "displayName: テストエージェント",
        "description: 説明。",
        "---",
        "\n本文\n",
      ].join("\n"),
      "utf-8"
    );

    // Act & Assert
    await expect(loadAgentDefinition(file)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 境界値・補足
  // -------------------------------------------------------------------------

  test("optional フィールド（temperature, maxTokens, tools）を含む .md が正しくパースされる", async () => {
    // Arrange
    const file = path.join(tmpDir, "full-agent.md");
    writeFileSync(
      file,
      [
        "---",
        "name: full-agent",
        "displayName: フルエージェント",
        "description: すべてのオプションを持つエージェント。",
        "role: specialist",
        "model: claude-haiku-4-5",
        "tools:",
        "  - fetch_webpage",
        "  - query_search_console",
        "temperature: 0.4",
        "maxTokens: 1024",
        "---",
        "\nシステムプロンプト本文\n",
      ].join("\n"),
      "utf-8"
    );

    // Act
    const def = await loadAgentDefinition(file);

    // Assert
    expect(def.name).toBe("full-agent");
    expect(def.model).toBe("claude-haiku-4-5");
    expect(def.tools).toEqual(["fetch_webpage", "query_search_console"]);
    expect(def.temperature).toBe(0.4);
    expect(def.maxTokens).toBe(1024);
    expect(def.systemPrompt).toContain("システムプロンプト本文");
  });

  // -------------------------------------------------------------------------
  // include 統合テスト
  // -------------------------------------------------------------------------

  test("13. include 付き .md を loadAgentDefinition で読むと expandIncludes が呼ばれ systemPrompt が展開される", async () => {
    // Arrange:
    // loader.ts の expandIncludes はデフォルト promptsDir（process.cwd()/prompts）を参照する。
    // そのため、実際の prompts/shared/ 配下に一時テスト用ファイルを作成し、
    // テスト後に削除することで実ファイルベースの統合テストを行う。

    const { mkdirSync: mkdirSyncNode, rmSync: rmSyncNode } = await import("fs");

    // process.cwd() はプロジェクトルートを指す
    const promptsSharedDir = path.join(process.cwd(), "prompts", "shared");
    mkdirSyncNode(promptsSharedDir, { recursive: true });

    const testSharedFile = path.join(promptsSharedDir, "__test-loader-include.md");
    const sharedContent = "統合テスト用共有コンテンツ";

    try {
      writeFileSync(testSharedFile, sharedContent, "utf-8");

      const agentFile = path.join(tmpDir, "include-integration-agent.md");
      writeFileSync(
        agentFile,
        [
          "---",
          "name: include-integration-agent",
          "displayName: include統合テストエージェント",
          "description: include 統合テスト用エージェント。",
          "role: specialist",
          "include:",
          "  - shared/__test-loader-include.md",
          "---",
          "",
          "本来のシステムプロンプト本文",
        ].join("\n"),
        "utf-8"
      );

      // Act
      const def = await loadAgentDefinition(agentFile);

      // Assert: shared ファイルの内容が systemPrompt に prepend されている
      expect(def.systemPrompt).toContain(sharedContent);
      expect(def.systemPrompt).toContain("本来のシステムプロンプト本文");
      // 結合形式の区切り "---" も含まれている
      expect(def.systemPrompt).toContain("---");
    } finally {
      rmSyncNode(testSharedFile, { force: true });
    }
  });

  test("14. include 付き .md の 2 回目呼び出しはキャッシュヒット（agent ファイル mtime 不変 → shared 変更も再読み込みされない）", async () => {
    // Arrange
    const { mkdirSync: mkdirSyncNode, rmSync: rmSyncNode } = await import("fs");

    const promptsSharedDir = path.join(process.cwd(), "prompts", "shared");
    mkdirSyncNode(promptsSharedDir, { recursive: true });

    const testSharedFile = path.join(promptsSharedDir, "__test-loader-cache.md");
    const initialSharedContent = "キャッシュテスト用初期コンテンツ";

    try {
      writeFileSync(testSharedFile, initialSharedContent, "utf-8");

      const agentFile = path.join(tmpDir, "cache-integration-agent.md");
      writeFileSync(
        agentFile,
        [
          "---",
          "name: cache-integration-agent",
          "displayName: キャッシュ統合テストエージェント",
          "description: キャッシュ動作確認用エージェント。",
          "role: specialist",
          "include:",
          "  - shared/__test-loader-cache.md",
          "---",
          "",
          "エージェント本文",
        ].join("\n"),
        "utf-8"
      );

      // Act: 初回ロード
      const def1 = await loadAgentDefinition(agentFile);
      expect(def1.systemPrompt).toContain(initialSharedContent);

      // shared ファイルを更新しても、agent ファイルの mtime は変わらないため
      // 2回目呼び出しではキャッシュヒット（再読み込みされない）
      const updatedSharedContent = "更新後のコンテンツ（キャッシュには反映されない）";
      writeFileSync(testSharedFile, updatedSharedContent, "utf-8");

      // Act: 2回目呼び出し（agent ファイルの mtime 変更なし → キャッシュヒット）
      const def2 = await loadAgentDefinition(agentFile);

      // Assert: 同じオブジェクト参照（キャッシュから返る）
      expect(def2).toBe(def1);
      // 更新された shared コンテンツは反映されない（agent ファイル mtime で管理される仕様）
      expect(def2.systemPrompt).not.toContain(updatedSharedContent);
      expect(def2.systemPrompt).toContain(initialSharedContent);
    } finally {
      rmSyncNode(testSharedFile, { force: true });
    }
  });
});
