/**
 * src/lib/agents/parser.ts の単体テスト
 *
 * 目的:
 *   - parseAgentDefinition() が正しく AgentDefinition を返すことを検証する
 *   - 不正な入力に対して適切にエラーを throw することを確認する
 *   - 純粋関数のためモックは不要
 */

import { parseAgentDefinition } from "@/lib/agents/parser";
import type { AgentDefinition } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// テストヘルパー: 有効な最小フロントマターを持つ Markdown ソースを生成する
// ---------------------------------------------------------------------------

function buildSource(
  frontmatter: Record<string, unknown>,
  body = "\nあなたは専門家です。\n",
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push(body);
  return lines.join("\n");
}

/** 必須フィールドのみを持つ最小有効フロントマター */
const minimalFrontmatter = {
  name: "seo-specialist",
  displayName: "SEO専門家",
  description: "検索流入・キーワード分析・SEO施策を担当する。",
};

const defaultFilePath = "prompts/agents/seo-specialist.md";
const defaultMtimeMs = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// 正常系
// ---------------------------------------------------------------------------

describe("parseAgentDefinition - 正常系", () => {
  test("1. 必須フィールドのみで有効な Markdown を渡すと AgentDefinition が返る", () => {
    // Arrange
    const source = buildSource(minimalFrontmatter);

    // Act
    const def: AgentDefinition = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.name).toBe("seo-specialist");
    expect(def.displayName).toBe("SEO専門家");
    expect(def.description).toBe("検索流入・キーワード分析・SEO施策を担当する。");
    expect(def.role).toBe("specialist"); // デフォルト値
    expect(def.model).toBe(""); // 未指定時は空文字列
    expect(def.tools).toEqual([]); // デフォルト値
    expect(def.filePath).toBe(defaultFilePath);
    expect(def.mtimeMs).toBe(defaultMtimeMs);
  });

  test("2. optional フィールド（temperature, maxTokens, include）を含むと正しくマッピングされる", () => {
    // Arrange
    const source = buildSource({
      ...minimalFrontmatter,
      role: "specialist",
      model: "claude-haiku-4-5",
      tools: ["fetch_webpage", "query_search_console"],
      include: ["shared/takatsu-connect.md", "shared/guidelines.md"],
      temperature: 0.4,
      maxTokens: 1024,
    });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.model).toBe("claude-haiku-4-5");
    expect(def.tools).toEqual(["fetch_webpage", "query_search_console"]);
    expect(def.include).toEqual(["shared/takatsu-connect.md", "shared/guidelines.md"]);
    expect(def.temperature).toBe(0.4);
    expect(def.maxTokens).toBe(1024);
  });

  test("3. tools フィールドを省略したとき tools が空配列になる", () => {
    // Arrange
    const source = buildSource(minimalFrontmatter);

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.tools).toEqual([]);
  });

  test("4a. role=classifier のエージェントをパースできる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, role: "classifier" });

    // Act
    const def = parseAgentDefinition({
      filePath: "prompts/agents/classifier.md",
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.role).toBe("classifier");
  });

  test("4b. role=orchestrator のエージェントをパースできる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, role: "orchestrator" });

    // Act
    const def = parseAgentDefinition({
      filePath: "prompts/agents/orchestrator.md",
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.role).toBe("orchestrator");
  });

  test("4c. role=specialist のエージェントをパースできる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, role: "specialist" });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.role).toBe("specialist");
  });

  test("5. systemPrompt に gray-matter の content がそのまま入る（前後の空白・改行を含む本文）", () => {
    // Arrange: body に前後の空白行を含む本文を用意する
    const body = "\n\nあなたは地域メディアのSEO専門家です。\n\n詳細な分析を行ってください。\n";
    const lines = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "---",
      body,
    ].join("\n");

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source: lines,
      mtimeMs: defaultMtimeMs,
    });

    // Assert: gray-matter が返す content はフロントマター区切り行以降の文字列
    expect(def.systemPrompt).toContain("あなたは地域メディアのSEO専門家です。");
    expect(def.systemPrompt).toContain("詳細な分析を行ってください。");
  });

  test("6. filePath と mtimeMs がそのまま AgentDefinition に保持される", () => {
    // Arrange
    const filePath = "prompts/agents/custom/my-agent.md";
    const mtimeMs = 9_999_999_999_999;
    const source = buildSource(minimalFrontmatter);

    // Act
    const def = parseAgentDefinition({ filePath, source, mtimeMs });

    // Assert
    expect(def.filePath).toBe(filePath);
    expect(def.mtimeMs).toBe(mtimeMs);
  });
});

// ---------------------------------------------------------------------------
// 異常系
// ---------------------------------------------------------------------------

describe("parseAgentDefinition - 異常系", () => {
  test("7. 必須フィールド name が欠落するとエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: name を含まないフロントマター
    const source = buildSource({
      displayName: "SEO専門家",
      description: "SEO担当",
    });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("7b. 必須フィールド displayName が欠落するとエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange
    const source = buildSource({
      name: "seo-specialist",
      description: "SEO担当",
    });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("7c. 必須フィールド description が欠落するとエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange
    const source = buildSource({
      name: "seo-specialist",
      displayName: "SEO専門家",
    });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test('8. role が union 外の値（"admin"）の場合にエラーが throw される', () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, role: "admin" });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test('9. temperature が number でない（文字列 "0.5"）場合にエラーが throw される', () => {
    // Arrange: YAML 内で引用符ありの文字列として渡す
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      'temperature: "0.5"',
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test("10. tools が string[] でない（文字列単体）場合にエラーが throw される", () => {
    // Arrange: tools を配列ではなくスカラー文字列にする
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "tools: fetch_webpage",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test("11. フロントマターブロックがない（--- で囲まれた YAML がない）場合にエラーが throw される", () => {
    // Arrange: 単なる本文のみ（name/displayName/description が存在しない）
    const source = "あなたは専門家です。フロントマターはありません。";

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("12. YAML 構文エラー（壊れた YAML）の場合にエラーが throw される", () => {
    // Arrange: gray-matter が例外を投げるような不正な YAML
    // インデントが不正で YAML パーサーがエラーを返すケース
    const source = [
      "---",
      "name: seo-specialist",
      "displayName: SEO専門家",
      "description: SEO担当",
      // コロンが入ったキーで YAML マッピングを壊す
      "invalid: key: with: colons: everywhere: :",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    // gray-matter が内部エラーを返す場合と zod バリデーションが通る場合があるため、
    // 少なくともエラー throw または正常系のどちらかを確認する。
    // ここでは壊れた YAML としてエラーになることを期待する。
    // gray-matter がエラーを throw しない場合、zod が型不一致で throw する。
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 境界値
// ---------------------------------------------------------------------------

describe("parseAgentDefinition - 境界値", () => {
  test("13. include が空配列のとき、AgentDefinition.include は undefined になる（実装の仕様）", () => {
    // Arrange: include を明示的に空配列で指定
    // 実装: fm.include.length > 0 のときのみ include プロパティをセットする（parser.ts:149）
    // そのため、include: [] のフロントマターを渡すと AgentDefinition.include は undefined になる
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "include: []",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert: 空配列の include は undefined として扱われる
    // これは意図的な実装: AgentDefinition.include は省略可能であり、
    // 空配列を持つよりも undefined の方が「include なし」を明確に表現できるため
    expect(def.include).toBeUndefined();
  });

  test("temperature の境界値 0 が受け入れられる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, temperature: 0 });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.temperature).toBe(0);
  });

  test("temperature の境界値 1 が受け入れられる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, temperature: 1 });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.temperature).toBe(1);
  });

  test("maxTokens に正の整数 1 が受け入れられる", () => {
    // Arrange
    const source = buildSource({ ...minimalFrontmatter, maxTokens: 1 });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.maxTokens).toBe(1);
  });

  test("name が小文字英数字とハイフンのみで構成される場合に受け入れられる", () => {
    // Arrange
    const source = buildSource({
      ...minimalFrontmatter,
      name: "my-agent-123",
    });

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.name).toBe("my-agent-123");
  });

  test("name に大文字が含まれる場合にエラーが throw される", () => {
    // Arrange
    const source = buildSource({
      ...minimalFrontmatter,
      name: "SeoSpecialist",
    });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test("tools フィールドを省略したとき AgentDefinition.tools は空配列になる（デフォルト値）", () => {
    // Arrange: tools を一切記述しない（buildSource で tools キーを渡さない）
    // YAML の `tools: []` は gray-matter が null と解釈するため、
    // 省略した場合の zod default([]) 適用を確認する
    const source = buildSource(minimalFrontmatter);

    // Act
    const def = parseAgentDefinition({
      filePath: defaultFilePath,
      source,
      mtimeMs: defaultMtimeMs,
    });

    // Assert
    expect(def.tools).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 追加: 異常系（境界値の異常側）
  // -------------------------------------------------------------------------

  test("temperature が範囲外（下側: -0.1）の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: temperature: -0.1 は z.number().min(0) 違反
    const source = buildSource({ ...minimalFrontmatter, temperature: -0.1 });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("temperature が範囲外（上側: 1.1）の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: temperature: 1.1 は z.number().max(1) 違反
    const source = buildSource({ ...minimalFrontmatter, temperature: 1.1 });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("maxTokens が 0 の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: maxTokens: 0 は z.number().int().positive() 違反（0 は positive でない）
    const source = buildSource({ ...minimalFrontmatter, maxTokens: 0 });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("maxTokens が負数（-1）の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: maxTokens: -1 は z.number().int().positive() 違反
    const source = buildSource({ ...minimalFrontmatter, maxTokens: -1 });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  test("maxTokens が非整数（1.5）の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: maxTokens: 1.5 は z.number().int() 違反
    const source = buildSource({ ...minimalFrontmatter, maxTokens: 1.5 });

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });

  // -------------------------------------------------------------------------
  // 追加: 型不一致
  // -------------------------------------------------------------------------

  test("tools 配列の中に string 以外（数値）が混在する場合にエラーが throw される", () => {
    // Arrange: YAML で tools の要素に数値を混在させる
    // z.array(z.string()) 違反
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "tools:",
      "  - 123",
      "  - fetch_webpage",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test("tools 配列の中に boolean が含まれる場合にエラーが throw される", () => {
    // Arrange: YAML で tools の要素に true（boolean）を指定する
    // z.array(z.string()) 違反
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "tools:",
      "  - true",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  test("model が string 以外（数値）の場合にエラーが throw される", () => {
    // Arrange: YAML で model に数値を直接設定する
    // z.string().optional() 違反（数値は string 型ではない）
    const source = [
      "---",
      `name: ${minimalFrontmatter.name}`,
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "model: 123",
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow();
  });

  // -------------------------------------------------------------------------
  // 追加: 境界値（name の空文字列）
  // -------------------------------------------------------------------------

  test("name が空文字列の場合にエラーが throw され、メッセージに filePath が含まれる", () => {
    // Arrange: name: "" は ^[a-z0-9-]+$ 違反（空文字列は正規表現にマッチしない）
    // YAML で name を空文字列として渡すために直接ソースを組み立てる
    const source = [
      "---",
      'name: ""',
      `displayName: ${minimalFrontmatter.displayName}`,
      `description: ${minimalFrontmatter.description}`,
      "---",
      "\n本文\n",
    ].join("\n");

    // Act & Assert
    expect(() =>
      parseAgentDefinition({
        filePath: defaultFilePath,
        source,
        mtimeMs: defaultMtimeMs,
      }),
    ).toThrow(defaultFilePath);
  });
});
