/**
 * @jest-environment node
 *
 * classifier エージェント定義の統合テスト
 *
 * テスト対象:
 *   - prompts/agents/classifier.md の存在・内容検証
 *   - prompts/shared/classifier-agents-list.md の存在・内容検証
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
const CLASSIFIER_MD_PATH = path.join(PROJECT_ROOT, "prompts", "agents", "classifier.md");
const CLASSIFIER_AGENTS_LIST_PATH = path.join(
  PROJECT_ROOT,
  "prompts",
  "shared",
  "classifier-agents-list.md",
);

// ---------------------------------------------------------------------------
// Section 1: ファイル存在確認
// ---------------------------------------------------------------------------

describe("classifier ファイル存在確認", () => {
  test("1-1. prompts/agents/classifier.md が存在する", async () => {
    // Act & Assert
    await expect(access(CLASSIFIER_MD_PATH)).resolves.toBeUndefined();
  });

  test("1-2. prompts/shared/classifier-agents-list.md が存在する", async () => {
    // Act & Assert
    await expect(access(CLASSIFIER_AGENTS_LIST_PATH)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 2: loadAgentDefinition() によるフロントマターフィールド検証
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - classifier.md フィールド検証", () => {
  let definition: Awaited<ReturnType<typeof loadAgentDefinition>>;

  beforeAll(async () => {
    clearAgentCache();
    definition = await loadAgentDefinition(CLASSIFIER_MD_PATH);
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("2-1. name === 'classifier'", () => {
    // Assert
    expect(definition.name).toBe("classifier");
  });

  test("2-2. displayName === '分類器'", () => {
    // Assert
    expect(definition.displayName).toBe("分類器");
  });

  test("2-3. role === 'classifier'", () => {
    // Assert
    expect(definition.role).toBe("classifier");
  });

  test("2-4. tools が空配列", () => {
    // Assert
    expect(definition.tools).toEqual([]);
  });

  test("2-5. temperature === 0.2", () => {
    // Assert
    expect(definition.temperature).toBe(0.2);
  });

  test("2-6. maxTokens === 256", () => {
    // Assert
    expect(definition.maxTokens).toBe(256);
  });

  test("2-7. include に 'shared/classifier-agents-list.md' が含まれる", () => {
    // Assert
    expect(definition.include).toContain("shared/classifier-agents-list.md");
  });
});

// ---------------------------------------------------------------------------
// Section 3: systemPrompt 内容確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - systemPrompt 内容確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(CLASSIFIER_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("3-1. systemPrompt に '専門家' または '振り分け' が含まれる（役割説明）", () => {
    // Assert
    const hasRoleDescription = systemPrompt.includes("専門家") || systemPrompt.includes("振り分け");
    expect(hasRoleDescription).toBe(true);
  });

  test("3-2. systemPrompt に 'JSON' または '{' が含まれる（出力形式指示）", () => {
    // Assert
    const hasOutputFormat = systemPrompt.includes("JSON") || systemPrompt.includes("{");
    expect(hasOutputFormat).toBe(true);
  });

  test("3-3. systemPrompt に 'specialists' が含まれる（出力JSONキー名）", () => {
    // Assert
    expect(systemPrompt).toContain("specialists");
  });

  test("3-4. systemPrompt に 'reasoning' が含まれる（出力JSONキー名）", () => {
    // Assert
    expect(systemPrompt).toContain("reasoning");
  });
});

// ---------------------------------------------------------------------------
// Section 4: include 展開確認
// ---------------------------------------------------------------------------

describe("loadAgentDefinition() - include 展開確認", () => {
  let systemPrompt: string;

  beforeAll(async () => {
    clearAgentCache();
    const definition = await loadAgentDefinition(CLASSIFIER_MD_PATH);
    systemPrompt = definition.systemPrompt;
  });

  afterAll(() => {
    clearAgentCache();
  });

  test("4-1. include 展開後の systemPrompt に classifier-agents-list.md の内容（専門家一覧テーブル）が含まれる", () => {
    // classifier-agents-list.md には「利用可能な専門家一覧」というマークダウン見出しが含まれる
    const hasAgentsList = systemPrompt.includes("利用可能な専門家一覧");
    expect(hasAgentsList).toBe(true);
  });

  test("4-2. include 展開後の systemPrompt に 'seo-specialist' 等の専門家名が含まれる", () => {
    // classifier-agents-list.md に定義されている専門家名がプロンプトに展開されている
    const hasSpecialistName = systemPrompt.includes("seo-specialist");
    expect(hasSpecialistName).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5: validateAllAgents() 結合テスト（実プロジェクトの prompts/）
// ---------------------------------------------------------------------------

describe("validateAllAgents() - 実プロジェクト結合テスト", () => {
  let result: Awaited<ReturnType<typeof validateAllAgents>>;

  beforeAll(async () => {
    result = await validateAllAgents();
  });

  test("5-1. errors が 0 件", () => {
    // Assert
    expect(result.errors).toHaveLength(0);
  });

  test("5-2. agentCount が 1 以上（classifier が検出される）", () => {
    // Assert
    expect(result.agentCount).toBeGreaterThanOrEqual(1);
  });

  test("5-3. role: classifier のエージェントが正しく検出される", async () => {
    // validateAllAgents は ValidationResult のみを返すため、
    // 実際のエージェントリストは loadAgentDefinition で直接確認する。
    // エラーがゼロ件かつ agentCount >= 1 の状態で classifier.md が読み込み可能であることを検証する。
    clearAgentCache();
    const classifierDef = await loadAgentDefinition(CLASSIFIER_MD_PATH);
    expect(classifierDef.role).toBe("classifier");
    clearAgentCache();
  });
});
