/**
 * @jest-environment node
 *
 * data-analyst エージェント定義の統合テスト
 *
 * テスト対象:
 *   - prompts/agents/data-analyst.md の存在・内容検証
 *   - prompts/tools/query_google_analytics.md の存在確認
 *   - prompts/tools/query_search_console.md の存在確認
 *   - loadAgentDefinition() による AgentDefinition の各フィールド検証
 *   - include 配列検証
 *   - systemPrompt 内容確認
 *   - include 展開後の systemPrompt 内容検証
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

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
const DATA_ANALYST_MD_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "agents",
  "data-analyst.md"
);
const QUERY_GOOGLE_ANALYTICS_MD_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "tools",
  "query_google_analytics.md"
);
const QUERY_SEARCH_CONSOLE_MD_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "tools",
  "query_search_console.md"
);

// ---------------------------------------------------------------------------
// Section 1: ファイル存在確認
// ---------------------------------------------------------------------------

describe("data-analyst ファイル存在確認", () => {
  test("1-1. prompts/agents/data-analyst.md が存在する", async () => {
    // Act & Assert
    await expect(access(DATA_ANALYST_MD_PATH)).resolves.toBeUndefined();
  });

  test("1-2. prompts/tools/query_google_analytics.md が存在する", async () => {
    // Act & Assert
    await expect(
      access(QUERY_GOOGLE_ANALYTICS_MD_PATH)
    ).resolves.toBeUndefined();
  });

  test("1-3. prompts/tools/query_search_console.md が存在する", async () => {
    // Act & Assert
    await expect(
      access(QUERY_SEARCH_CONSOLE_MD_PATH)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 2: loadAgentDefinition() によるフロントマターフィールド検証
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - data-analyst.md フィールド検証", () => {
  let definition: Awaited<ReturnType<typeof loadAgentDefinition>>;

  beforeAll(async () => {
    clearAgentCache();
    definition = await loadAgentDefinition(DATA_ANALYST_MD_PATH);
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("2-1. name === 'data-analyst'", () => {
    // Assert
    expect(definition.name).toBe("data-analyst");
  });

  test("2-2. displayName === 'データアナリスト'", () => {
    // Assert
    expect(definition.displayName).toBe("データアナリスト");
  });

  test("2-3. role === 'specialist'", () => {
    // Assert
    expect(definition.role).toBe("specialist");
  });

  test("2-4. model === 'claude-haiku-4-5'", () => {
    // Assert
    expect(definition.model).toBe("claude-haiku-4-5");
  });

  test("2-5. tools に 'query_google_analytics' と 'query_search_console' がすべて含まれる", () => {
    // Assert
    expect(definition.tools).toContain("query_google_analytics");
    expect(definition.tools).toContain("query_search_console");
  });

  test("2-8. tools の件数が2件である（想定外のツール追加を検出）", () => {
    // Assert
    expect(definition.tools).toHaveLength(2);
  });

  test("2-6. temperature === 0.4", () => {
    // Assert
    expect(definition.temperature).toBe(0.4);
  });

  test("2-7. maxTokens === 1024", () => {
    // Assert
    expect(definition.maxTokens).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Section 3: include 配列検証
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - include 配列検証", () => {
  let definition: Awaited<ReturnType<typeof loadAgentDefinition>>;

  beforeAll(async () => {
    clearAgentCache();
    definition = await loadAgentDefinition(DATA_ANALYST_MD_PATH);
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("3-1. include に 'shared/takatsu-connect.md' と 'shared/style-guide.md' が含まれる", () => {
    // Arrange
    const expectedIncludes = [
      "shared/takatsu-connect.md",
      "shared/style-guide.md",
    ];

    // Assert
    for (const file of expectedIncludes) {
      expect(definition.include).toContain(file);
    }
  });

  test("3-2. include の件数が2件である（想定外のインクルード追加を検出）", () => {
    // Assert
    expect(definition.include).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Section 4: systemPrompt 内容確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - systemPrompt 内容確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(DATA_ANALYST_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("4-1. systemPrompt に 'データ' または '数値' が含まれる（役割説明）", () => {
    // Assert
    const hasRoleDescription =
      systemPrompt.includes("データ") || systemPrompt.includes("数値");
    expect(hasRoleDescription).toBe(true);
  });

  test("4-2. systemPrompt に 'query_google_analytics' が含まれる（ツール使用ガイド）", () => {
    // Assert
    expect(systemPrompt).toContain("query_google_analytics");
  });

  test("4-3. systemPrompt に '無視' または '上書き' が含まれる（インジェクション対策）", () => {
    // Assert
    const hasInjectionGuard =
      systemPrompt.includes("無視") || systemPrompt.includes("上書き");
    expect(hasInjectionGuard).toBe(true);
  });

  test("4-4. systemPrompt に 'query_search_console' が含まれる（ツール使用ガイド）", () => {
    // Assert
    expect(systemPrompt).toContain("query_search_console");
  });
});

// ---------------------------------------------------------------------------
// Section 5: include 展開確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - include 展開確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(DATA_ANALYST_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("5-1. include 展開後の systemPrompt に takatsu-connect.md の内容（'高津コネクト'）が含まれる", () => {
    // Assert
    expect(systemPrompt).toContain("高津コネクト");
  });

  test("5-2. include 展開後の systemPrompt に style-guide.md の内容（'ですます調'）が含まれる", () => {
    // Assert
    expect(systemPrompt).toContain("ですます調");
  });
});
