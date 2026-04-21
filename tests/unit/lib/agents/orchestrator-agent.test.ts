/**
 * @jest-environment node
 *
 * orchestrator エージェント定義の統合テスト
 *
 * テスト対象:
 *   - prompts/agents/orchestrator.md の存在・内容検証
 *   - prompts/shared/orchestrator-guidelines.md の存在・内容検証
 *   - loadAgentDefinition() による AgentDefinition の各フィールド検証
 *   - include 展開後の systemPrompt 内容検証
 *   - validateAllAgents() による実プロジェクトへの結合テスト
 *
 * モック戦略:
 *   - server-only: node 環境でインポートエラーになるためスタブ化
 *   - 実ファイルを参照（prompts/ 配下）
 */

// ---------------------------------------------------------------------------
// モック定義（import より前に定義する必要がある）
// ---------------------------------------------------------------------------

// server-only は node 環境でインポートエラーになるためスタブ化
jest.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

import { access } from "node:fs/promises";
import path from "node:path";
import { loadAgentDefinition, clearAgentCache } from "@/lib/agents/loader";
import { validateAllAgents } from "@/lib/agents/validate";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
const ORCHESTRATOR_MD_PATH = path.join(PROJECT_ROOT, "prompts", "agents", "orchestrator.md");
const ORCHESTRATOR_GUIDELINES_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "shared",
  "orchestrator-guidelines.md",
);

// ---------------------------------------------------------------------------
// Section 1: ファイル存在確認
// ---------------------------------------------------------------------------

describe("orchestrator ファイル存在確認", () => {
  test("1-1. prompts/agents/orchestrator.md が存在する", async () => {
    // Act & Assert
    await expect(access(ORCHESTRATOR_MD_PATH)).resolves.toBeUndefined();
  });

  test("1-2. prompts/shared/orchestrator-guidelines.md が存在する", async () => {
    // Act & Assert
    await expect(access(ORCHESTRATOR_GUIDELINES_PATH)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 2: loadAgentDefinition() によるフロントマターフィールド検証
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - orchestrator.md フィールド検証", () => {
  let definition: Awaited<ReturnType<typeof loadAgentDefinition>>;

  beforeAll(async () => {
    clearAgentCache();
    definition = await loadAgentDefinition(ORCHESTRATOR_MD_PATH);
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("2-1. name === 'orchestrator'", () => {
    // Assert
    expect(definition.name).toBe("orchestrator");
  });

  test("2-2. displayName === '統合回答者'", () => {
    // Assert
    expect(definition.displayName).toBe("統合回答者");
  });

  test("2-3. role === 'orchestrator'", () => {
    // Assert
    expect(definition.role).toBe("orchestrator");
  });

  test("2-4. tools が空配列", () => {
    // Assert
    expect(definition.tools).toEqual([]);
  });

  test("2-5. temperature === 0.7", () => {
    // Assert
    expect(definition.temperature).toBe(0.7);
  });

  test("2-6. maxTokens === 2048", () => {
    // Assert
    expect(definition.maxTokens).toBe(2048);
  });

  test("2-7. model === 'claude-sonnet-4-6'", () => {
    // Assert
    expect(definition.model).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// Section 3: include 配列検証
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - include 配列検証", () => {
  let definition: Awaited<ReturnType<typeof loadAgentDefinition>>;

  beforeAll(async () => {
    clearAgentCache();
    definition = await loadAgentDefinition(ORCHESTRATOR_MD_PATH);
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("3-1. include に 4 ファイルすべてが含まれる", () => {
    // Arrange
    const expectedIncludes = [
      "shared/takatsu-connect.md",
      "shared/machino-kikakushitsu.md",
      "shared/style-guide.md",
      "shared/orchestrator-guidelines.md",
    ];

    // Assert
    for (const file of expectedIncludes) {
      expect(definition.include).toContain(file);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4: systemPrompt 内容確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - systemPrompt 内容確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(ORCHESTRATOR_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("4-1. systemPrompt に '統合' または '専門家' が含まれる（役割説明）", () => {
    // Assert
    const hasRoleDescription = systemPrompt.includes("統合") || systemPrompt.includes("専門家");
    expect(hasRoleDescription).toBe(true);
  });

  test("4-2. systemPrompt に '要確認' が含まれる（未検証情報マーク）", () => {
    // Assert
    expect(systemPrompt).toContain("要確認");
  });

  test("4-3. systemPrompt に '行動原則' が含まれる（行動原則の明記）", () => {
    // Assert
    expect(systemPrompt).toContain("行動原則");
  });

  test("4-4. systemPrompt に '無視' または '上書き' が含まれる（インジェクション対策）", () => {
    // Assert
    const hasInjectionGuard = systemPrompt.includes("無視") || systemPrompt.includes("上書き");
    expect(hasInjectionGuard).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5: include 展開確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - include 展開確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(ORCHESTRATOR_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("5-1. include 展開後の systemPrompt に orchestrator-guidelines.md の内容（'統合回答ガイドライン' または '矛盾の解消'）が含まれる", () => {
    // Assert
    const hasGuidelinesContent =
      systemPrompt.includes("統合回答ガイドライン") || systemPrompt.includes("矛盾の解消");
    expect(hasGuidelinesContent).toBe(true);
  });

  test("5-2. include 展開後の systemPrompt に style-guide.md の内容（'ですます調'）が含まれる", () => {
    // Assert
    expect(systemPrompt).toContain("ですます調");
  });
});

// ---------------------------------------------------------------------------
// Section 6: validateAllAgents() 結合テスト（実プロジェクトの prompts/）
// ---------------------------------------------------------------------------

describe("validateAllAgents() - 実プロジェクト結合テスト", () => {
  let result: Awaited<ReturnType<typeof validateAllAgents>>;

  beforeAll(async () => {
    result = await validateAllAgents();
  });

  test("6-1. errors が 0 件", () => {
    // Assert
    expect(result.errors).toHaveLength(0);
  });

  test("6-2. role: orchestrator のエージェントが正しく検出される", async () => {
    // validateAllAgents は ValidationResult のみを返すため、
    // 実際のエージェントリストは loadAgentDefinition で直接確認する。
    // エラーがゼロ件の状態で orchestrator.md が読み込み可能であることを検証する。
    clearAgentCache();
    const orchestratorDef = await loadAgentDefinition(ORCHESTRATOR_MD_PATH);
    expect(orchestratorDef.role).toBe("orchestrator");
    clearAgentCache();
  });
});
