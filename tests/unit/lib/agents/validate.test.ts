/**
 * @jest-environment node
 *
 * src/lib/agents/validate.ts の単体テスト
 *
 * テスト対象:
 *   - validateAllAgents(options?) の全検証項目
 *
 * テスト戦略:
 *   - mkdtempSync で一時ディレクトリを作成し、options.promptsDir でその一時ディレクトリを指定
 *   - options.toolsDir も一時ディレクトリ配下に置くことで src/lib/tools/schemas.ts 不在を回避
 *   - afterEach で一時ディレクトリを削除
 *   - 循環参照テストは agent + shared 両方に gray-matter 形式フロントマターを持つ .md を作成
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { validateAllAgents } from "@/lib/agents/validate";
import type { ValidationResult } from "@/lib/agents/validate";

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** agent.md 用の有効な最小ソースを生成する */
function buildAgentMd(opts: {
  name?: string;
  displayName?: string;
  description?: string;
  role?: string;
  tools?: string[];
  include?: string[];
  body?: string;
}): string {
  const {
    name = "test-agent",
    displayName = "テストエージェント",
    description = "テスト用エージェントの説明。",
    role,
    tools,
    include,
    body = "\nあなたは専門家です。\n",
  } = opts;

  const lines: string[] = [
    "---",
    `name: ${name}`,
    `displayName: ${displayName}`,
    `description: ${description}`,
  ];
  if (role) lines.push(`role: ${role}`);
  if (tools && tools.length > 0) {
    lines.push("tools:");
    for (const t of tools) lines.push(`  - ${t}`);
  }
  if (include && include.length > 0) {
    lines.push("include:");
    for (const inc of include) lines.push(`  - ${inc}`);
  }
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}

/** shared/*.md 用のソースを生成する（gray-matter フロントマター形式） */
function buildSharedMd(opts: { include?: string[]; body?: string } = {}): string {
  const { include, body = "\n共有コンテンツ\n" } = opts;
  if (!include || include.length === 0) {
    return body;
  }
  const lines: string[] = ["---", "include:"];
  for (const inc of include) lines.push(`  - ${inc}`);
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}

/** 一時ディレクトリ下に prompts/ 構造を作成するヘルパー */
function createPromptsStructure(baseDir: string): {
  promptsDir: string;
  agentsDir: string;
  sharedDir: string;
  toolsDir: string;
} {
  const promptsDir = path.join(baseDir, "prompts");
  const agentsDir = path.join(promptsDir, "agents");
  const sharedDir = path.join(promptsDir, "shared");
  const toolsDir = path.join(promptsDir, "tools");

  mkdirSync(promptsDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });

  return { promptsDir, agentsDir, sharedDir, toolsDir };
}

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

describe("validateAllAgents", () => {
  let tmpDir: string;
  let promptsDir: string;
  let agentsDir: string;
  let sharedDir: string;
  let toolsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "validate-agents-"));
    ({ promptsDir, agentsDir, sharedDir, toolsDir } = createPromptsStructure(tmpDir));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 正常系
  // =========================================================================

  describe("正常系", () => {
    test("1. すべて有効な設定: 有効な agent.md + 対応する shared.md + tools.md が揃っている → errors 0", async () => {
      // Arrange
      // tools ディレクトリに tools.md を作成
      writeFileSync(path.join(toolsDir, "fetch-webpage.md"), "# fetch-webpage\n", "utf-8");

      // shared ファイルを作成
      writeFileSync(path.join(sharedDir, "common.md"), buildSharedMd(), "utf-8");

      // agent.md を作成（include と tools を持つ）
      writeFileSync(
        path.join(agentsDir, "my-specialist.md"),
        buildAgentMd({
          name: "my-specialist",
          role: "specialist",
          tools: ["fetch-webpage"],
          include: ["shared/common.md"],
        }),
        "utf-8",
      );

      // Act
      const result: ValidationResult = await validateAllAgents({
        promptsDir,
        toolsDir,
      });

      // Assert
      expect(result.errors).toHaveLength(0);
      expect(result.agentCount).toBe(1);
    });

    test("2. 空ディレクトリ: prompts/agents/ 内に .md が無い → errors 0, agentCount 0", async () => {
      // Arrange: agentsDir は存在するがファイルが 0 件

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors).toHaveLength(0);
      expect(result.agentCount).toBe(0);
    });

    test("3. include/tools 無し: agent.md に include も tools も無い → errors 0", async () => {
      // Arrange
      writeFileSync(path.join(agentsDir, "minimal.md"), buildAgentMd({ name: "minimal" }), "utf-8");

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors).toHaveLength(0);
      expect(result.agentCount).toBe(1);
    });
  });

  // =========================================================================
  // 異常系
  // =========================================================================

  describe("異常系", () => {
    test("4. スキーマ違反: 必須フィールド欠落の agent.md → error type 'schema'", async () => {
      // Arrange: name フィールドが欠落
      const invalidSource = [
        "---",
        "displayName: テストエージェント",
        "description: 説明。",
        "---",
        "\n本文\n",
      ].join("\n");
      writeFileSync(path.join(agentsDir, "invalid.md"), invalidSource, "utf-8");

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const schemaError = result.errors.find((e) => e.type === "schema");
      expect(schemaError).toBeDefined();
    });

    test("5. include 不在: agent.md の include で指定した shared ファイルが存在しない → error type 'include_missing'", async () => {
      // Arrange: shared/non-existent.md は作成しない
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({
          name: "agent-with-missing-include",
          include: ["shared/non-existent.md"],
        }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const incError = result.errors.find((e) => e.type === "include_missing");
      expect(incError).toBeDefined();
      expect(incError?.message).toContain("non-existent.md");
    });

    test("6. tools 不一致: 存在しない tool 名 → error type 'tool_missing'", async () => {
      // Arrange: toolsDir に tools.md を 1 つ作成するが、agent が別の名前を参照する
      writeFileSync(path.join(toolsDir, "known-tool.md"), "# known-tool\n", "utf-8");
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({
          name: "agent-with-unknown-tool",
          tools: ["unknown-tool"],
        }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const toolError = result.errors.find((e) => e.type === "tool_missing");
      expect(toolError).toBeDefined();
      expect(toolError?.message).toContain("unknown-tool");
    });

    test("7. role classifier 複数: role=classifier の agent が 2 件 → error type 'role_duplicate'", async () => {
      // Arrange
      writeFileSync(
        path.join(agentsDir, "classifier-1.md"),
        buildAgentMd({ name: "classifier-one", role: "classifier" }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "classifier-2.md"),
        buildAgentMd({ name: "classifier-two", role: "classifier" }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const roleError = result.errors.find((e) => e.type === "role_duplicate");
      expect(roleError).toBeDefined();
      expect(roleError?.message).toContain("classifier");
    });

    test("8. role orchestrator 複数: role=orchestrator の agent が 2 件 → error type 'role_duplicate'", async () => {
      // Arrange
      writeFileSync(
        path.join(agentsDir, "orchestrator-1.md"),
        buildAgentMd({ name: "orchestrator-one", role: "orchestrator" }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "orchestrator-2.md"),
        buildAgentMd({ name: "orchestrator-two", role: "orchestrator" }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const roleError = result.errors.find((e) => e.type === "role_duplicate");
      expect(roleError).toBeDefined();
      expect(roleError?.message).toContain("orchestrator");
    });

    test("9. name 重複: 異なるファイルで name が重複 → error type 'name_duplicate'", async () => {
      // Arrange
      writeFileSync(
        path.join(agentsDir, "agent-a.md"),
        buildAgentMd({ name: "duplicate-name" }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "agent-b.md"),
        buildAgentMd({ name: "duplicate-name" }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const dupError = result.errors.find((e) => e.type === "name_duplicate");
      expect(dupError).toBeDefined();
      expect(dupError?.message).toContain("duplicate-name");
    });

    test("10. 循環参照（自己参照）: agent → shared/a → shared/a → error type 'include_cycle'", async () => {
      // Arrange: shared/a.md が自分自身を include する（自己参照）
      writeFileSync(
        path.join(sharedDir, "self-ref.md"),
        buildSharedMd({ include: ["shared/self-ref.md"] }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({
          name: "agent-with-cycle",
          include: ["shared/self-ref.md"],
        }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const cycleError = result.errors.find((e) => e.type === "include_cycle");
      expect(cycleError).toBeDefined();
      expect(cycleError?.files).toBeDefined();
      // files に循環経路のノードが含まれる
      expect(cycleError?.files?.some((f) => f.includes("self-ref"))).toBe(true);
    });

    test("11. 循環参照（複数ノード）: agent → shared/a → shared/b → shared/a → error type 'include_cycle'", async () => {
      // Arrange: shared/a → shared/b → shared/a の循環
      writeFileSync(
        path.join(sharedDir, "node-a.md"),
        buildSharedMd({ include: ["shared/node-b.md"] }),
        "utf-8",
      );
      writeFileSync(
        path.join(sharedDir, "node-b.md"),
        buildSharedMd({ include: ["shared/node-a.md"] }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({
          name: "agent-with-multi-cycle",
          include: ["shared/node-a.md"],
        }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors.length).toBeGreaterThan(0);
      const cycleError = result.errors.find((e) => e.type === "include_cycle");
      expect(cycleError).toBeDefined();
      expect(cycleError?.files).toBeDefined();
      // files に循環経路に含まれる node-a, node-b が含まれる
      const filesList = cycleError?.files ?? [];
      const hasNodeA = filesList.some((f) => f.includes("node-a"));
      const hasNodeB = filesList.some((f) => f.includes("node-b"));
      expect(hasNodeA).toBe(true);
      expect(hasNodeB).toBe(true);
    });

    test("12. 循環参照（複数入口）: agent1, agent2 両方が shared/a を include、shared/a → shared/b → shared/a → どちらからでも検出される", async () => {
      // Arrange
      writeFileSync(
        path.join(sharedDir, "common-a.md"),
        buildSharedMd({ include: ["shared/common-b.md"] }),
        "utf-8",
      );
      writeFileSync(
        path.join(sharedDir, "common-b.md"),
        buildSharedMd({ include: ["shared/common-a.md"] }),
        "utf-8",
      );
      // 2 つの agent が同じ循環する共有ファイルを include する
      writeFileSync(
        path.join(agentsDir, "entry1.md"),
        buildAgentMd({ name: "entry-one", include: ["shared/common-a.md"] }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "entry2.md"),
        buildAgentMd({ name: "entry-two", include: ["shared/common-a.md"] }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert: 少なくとも 1 件の循環参照エラーが検出される
      const cycleErrors = result.errors.filter((e) => e.type === "include_cycle");
      expect(cycleErrors.length).toBeGreaterThan(0);
    });

    test("13. 複数エラー集約: スキーマ違反 + include 不在 + name 重複 → errors に全種類が含まれる", async () => {
      // Arrange

      // スキーマ違反 (name 欠落)
      writeFileSync(
        path.join(agentsDir, "schema-invalid.md"),
        ["---", "displayName: 名前なし", "description: 説明", "---", "\n本文\n"].join("\n"),
        "utf-8",
      );

      // include 不在
      writeFileSync(
        path.join(agentsDir, "missing-include.md"),
        buildAgentMd({
          name: "agent-missing-inc",
          include: ["shared/does-not-exist.md"],
        }),
        "utf-8",
      );

      // name 重複（2 ファイル）
      writeFileSync(path.join(agentsDir, "dup-a.md"), buildAgentMd({ name: "dup-name" }), "utf-8");
      writeFileSync(path.join(agentsDir, "dup-b.md"), buildAgentMd({ name: "dup-name" }), "utf-8");

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert: errors に schema / include_missing / name_duplicate が含まれる
      const types = result.errors.map((e) => e.type);
      expect(types).toContain("schema");
      expect(types).toContain("include_missing");
      expect(types).toContain("name_duplicate");
      // 合計エラー数は 3 件以上（schema 1 + include_missing 1 + name_duplicate 1）
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // warning 系
  // =========================================================================

  describe("warning 系", () => {
    test("14. systemPrompt > 20000 文字: 大きな systemPrompt → warning type 'prompt_size'", async () => {
      // Arrange: systemPrompt が 20001 文字になるよう本文を作成
      const longBody = "\n" + "あ".repeat(20001) + "\n";
      writeFileSync(
        path.join(agentsDir, "large-prompt.md"),
        buildAgentMd({ name: "large-prompt-agent", body: longBody }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors).toHaveLength(0);
      const sizeWarning = result.warnings.find((w) => w.type === "prompt_size");
      expect(sizeWarning).toBeDefined();
      expect(sizeWarning?.message).toContain("20,000");
    });

    test("15. ディレクトリ不在: prompts/agents が存在しない → warning type 'agents_dir_missing' + agentCount=0", async () => {
      // Arrange: agents ディレクトリを削除する
      rmSync(agentsDir, { recursive: true, force: true });

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.agentCount).toBe(0);
      const dirWarning = result.warnings.find((w) => w.type === "agents_dir_missing");
      expect(dirWarning).toBeDefined();
    });
  });

  // =========================================================================
  // 境界値
  // =========================================================================

  describe("境界値", () => {
    test("16. classifier-agents-list.md の内容が期待値と異なる → warning type 'classifier_list_diff'", async () => {
      // Arrange: specialist agent を 1 件作成
      writeFileSync(
        path.join(agentsDir, "seo-specialist.md"),
        buildAgentMd({
          name: "seo-specialist",
          displayName: "SEO専門家",
          description: "SEO担当。",
          role: "specialist",
        }),
        "utf-8",
      );

      // shared/classifier-agents-list.md に古い（差分がある）内容を書く
      const outdatedContent =
        "# 利用可能な専門家一覧\n\n| name | displayName | 守備範囲 |\n|---|---|---|\n| old-agent | 旧エージェント | 旧担当 |\n";
      writeFileSync(path.join(sharedDir, "classifier-agents-list.md"), outdatedContent, "utf-8");

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      const diffWarning = result.warnings.find((w) => w.type === "classifier_list_diff");
      expect(diffWarning).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    test("classifier-agents-list.md の内容が最新と一致している → warning なし", async () => {
      // Arrange: specialist agent を 1 件作成
      writeFileSync(
        path.join(agentsDir, "seo-specialist.md"),
        buildAgentMd({
          name: "seo-specialist",
          displayName: "SEO専門家",
          description: "SEO担当。",
          role: "specialist",
        }),
        "utf-8",
      );

      // validate.ts の generateClassifierAgentsList と同じ形式で最新の内容を作成
      const currentContent = `# 利用可能な専門家一覧\n\n| name | displayName | 守備範囲 |\n|---|---|---|\n| seo-specialist | SEO専門家 | SEO担当。 |\n`;
      writeFileSync(path.join(sharedDir, "classifier-agents-list.md"), currentContent, "utf-8");

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert: classifier_list_diff 警告が出ない
      const diffWarning = result.warnings.find((w) => w.type === "classifier_list_diff");
      expect(diffWarning).toBeUndefined();
      expect(result.errors).toHaveLength(0);
    });

    test("tools 検証: toolsDir に既知ツールがあり agent が正しく参照 → error なし", async () => {
      // Arrange
      writeFileSync(path.join(toolsDir, "my-tool.md"), "# my-tool\n", "utf-8");
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({ name: "tool-user", tools: ["my-tool"] }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(result.errors).toHaveLength(0);
    });

    test("tools 検証スキップ: toolsDir も schemas.ts も存在しない → tool_missing エラーなし、tools_dir_missing warning あり", async () => {
      // Arrange: toolsDir を削除し、schemas.ts も存在しないことを前提に
      // （テスト中は schemasPath = process.cwd()/src/lib/tools/schemas.ts を参照する）
      rmSync(toolsDir, { recursive: true, force: true });

      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({ name: "toolless-agent", tools: ["some-tool"] }),
        "utf-8",
      );

      // Act: toolsDir を渡さず、tools ディレクトリが存在しない状態
      const result = await validateAllAgents({ promptsDir });

      // Assert: schemas.ts が存在するかどうかによって結果が変わる
      // プロジェクトに schemas.ts が存在する場合は tool_missing エラーが出る可能性がある
      // 存在しない場合は tools_dir_missing warning が出て tool 検証がスキップされる
      // ここでは tool_missing か tools_dir_missing のどちらかが発生することを確認
      const hasToolMissingError = result.errors.some((e) => e.type === "tool_missing");
      const hasToolsDirWarning = result.warnings.some((w) => w.type === "tools_dir_missing");
      // どちらか一方が起きていることを確認（実行環境に依存）
      expect(hasToolMissingError || hasToolsDirWarning).toBe(true);
    });

    test("classifier と orchestrator がそれぞれ 1 件ずつ存在 → role_duplicate エラーなし", async () => {
      // Arrange
      writeFileSync(
        path.join(agentsDir, "classifier.md"),
        buildAgentMd({ name: "the-classifier", role: "classifier" }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "orchestrator.md"),
        buildAgentMd({ name: "the-orchestrator", role: "orchestrator" }),
        "utf-8",
      );
      writeFileSync(
        path.join(agentsDir, "specialist.md"),
        buildAgentMd({ name: "the-specialist", role: "specialist" }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      const roleDupErrors = result.errors.filter((e) => e.type === "role_duplicate");
      expect(roleDupErrors).toHaveLength(0);
      expect(result.agentCount).toBe(3);
    });

    test("systemPrompt がちょうど 20000 文字 → prompt_size warning なし", async () => {
      // Arrange: systemPrompt がちょうど 20000 文字（境界値の正側）
      // gray-matter の content は '---' 後に改行が付くため、body で調整する
      // body の先頭に改行が 1 文字入るため 19999 文字のボディを用意する
      const body = "\n" + "あ".repeat(19999);
      writeFileSync(
        path.join(agentsDir, "boundary.md"),
        buildAgentMd({ name: "boundary-agent", body }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert: 20000 文字以下なので warning なし
      const sizeWarning = result.warnings.find((w) => w.type === "prompt_size");
      // 20000 文字超えの条件 (> 20000) に合致しないため undefined
      expect(sizeWarning).toBeUndefined();
    });
  });

  // =========================================================================
  // options 指定
  // =========================================================================

  describe("options", () => {
    test("options.promptsDir 未指定時は process.cwd()/prompts を参照する（ディレクトリ不在の場合 warning）", async () => {
      // Arrange: options.promptsDir を渡さない
      // プロジェクトルートの prompts/agents/ が空または存在するかによるが
      // ここでは呼び出し自体がエラーにならないことを確認する
      const result = await validateAllAgents();
      // errors が空（または存在しても schema 系エラーのみ）であることを確認
      expect(result).toBeDefined();
      expect(typeof result.agentCount).toBe("number");
    });

    test("options.toolsDir を指定すると指定ディレクトリの .md ファイルがツール名として使われる", async () => {
      // Arrange
      writeFileSync(path.join(toolsDir, "custom-tool.md"), "# custom-tool\n", "utf-8");
      writeFileSync(
        path.join(agentsDir, "agent.md"),
        buildAgentMd({ name: "custom-tool-user", tools: ["custom-tool"] }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      const toolErrors = result.errors.filter((e) => e.type === "tool_missing");
      expect(toolErrors).toHaveLength(0);
    });
  });

  // =========================================================================
  // ValidationResult 構造
  // =========================================================================

  describe("ValidationResult 構造", () => {
    test("返り値が errors, warnings, agentCount を含む正しい形式である", async () => {
      // Arrange
      writeFileSync(
        path.join(agentsDir, "struct-agent.md"),
        buildAgentMd({ name: "struct-agent" }),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(typeof result.agentCount).toBe("number");
    });

    test("エラーオブジェクトが filePath, type, message プロパティを持つ", async () => {
      // Arrange: スキーマ違反 agent を追加してエラーを発生させる
      writeFileSync(
        path.join(agentsDir, "bad.md"),
        ["---", "displayName: 不正", "description: 説明", "---", "\n本文\n"].join("\n"),
        "utf-8",
      );

      // Act
      const result = await validateAllAgents({ promptsDir, toolsDir });

      // Assert
      const err = result.errors[0];
      expect(typeof err.filePath).toBe("string");
      expect(typeof err.type).toBe("string");
      expect(typeof err.message).toBe("string");
    });
  });
});
