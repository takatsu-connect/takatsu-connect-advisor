/**
 * @jest-environment node
 *
 * src/lib/claude/types.ts の型レベルテスト
 *
 * テスト対象:
 *   - ClaudeUsage: トークン使用量型
 *   - ClaudeMessage: メッセージ型
 *   - ClaudeContentBlock: discriminated union（ClaudeTextBlock / ClaudeToolUseBlock / ClaudeToolResultBlock）
 *   - ClaudeStopReason: 停止理由リテラル型
 *   - CachedChatResult: キャッシュ格納値型
 *
 * 実装方針:
 *   TypeScript の型検査はコンパイル時に行われる。
 *   各テストでは「型に適合するオブジェクトを構築できること」を示し、
 *   `expect(obj).toBeDefined()` 等の軽い runtime assertion でコンパイル通過を保証する。
 *   型エラー（不正な値）の検証はコンパイラが担うため、実行時には書かない。
 */

import type {
  ClaudeUsage,
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeTextBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  ClaudeStopReason,
  CachedChatResult,
} from "@/lib/claude/types";

// ---------------------------------------------------------------------------
// 1. ClaudeUsage 型適合
// ---------------------------------------------------------------------------

describe("ClaudeUsage", () => {
  test("1-1. 必須フィールド（input_tokens, output_tokens）のみで型適合する", () => {
    // Arrange & Act
    const usage: ClaudeUsage = {
      input_tokens: 100,
      output_tokens: 50,
    };

    // Assert
    expect(usage).toBeDefined();
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
  });

  test("1-2. cache_* optional フィールドを付与しても型適合する", () => {
    // Arrange & Act
    const usage: ClaudeUsage = {
      input_tokens: 200,
      output_tokens: 80,
      cache_creation_input_tokens: 150,
      cache_read_input_tokens: 120,
    };

    // Assert
    expect(usage).toBeDefined();
    expect(usage.cache_creation_input_tokens).toBe(150);
    expect(usage.cache_read_input_tokens).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// 2. ClaudeMessage 型適合
// ---------------------------------------------------------------------------

describe("ClaudeMessage", () => {
  test("2-1. role: 'user' + content: string が型適合する", () => {
    // Arrange & Act
    const message: ClaudeMessage = {
      role: "user",
      content: "こんにちは",
    };

    // Assert
    expect(message).toBeDefined();
    expect(message.role).toBe("user");
    expect(typeof message.content).toBe("string");
  });

  test("2-2. role: 'assistant' + content: ClaudeContentBlock[] が型適合する", () => {
    // Arrange
    const blocks: ClaudeContentBlock[] = [{ type: "text", text: "回答テキスト" }];

    // Act
    const message: ClaudeMessage = {
      role: "assistant",
      content: blocks,
    };

    // Assert
    expect(message).toBeDefined();
    expect(message.role).toBe("assistant");
    expect(Array.isArray(message.content)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. ClaudeContentBlock discriminated union
// ---------------------------------------------------------------------------

describe("ClaudeContentBlock discriminated union", () => {
  test("3-1. { type: 'text', text } が ClaudeTextBlock として型適合する", () => {
    // Arrange & Act
    const block: ClaudeTextBlock = {
      type: "text",
      text: "hello",
    };

    // Assert
    expect(block).toBeDefined();
    expect(block.type).toBe("text");
    expect(block.text).toBe("hello");
  });

  test("3-2. { type: 'tool_use', id, name, input } が ClaudeToolUseBlock として型適合する", () => {
    // Arrange & Act
    const block: ClaudeToolUseBlock = {
      type: "tool_use",
      id: "tool_abc123",
      name: "search_web",
      input: { query: "Next.js caching" },
    };

    // Assert
    expect(block).toBeDefined();
    expect(block.type).toBe("tool_use");
    expect(block.id).toBe("tool_abc123");
    expect(block.name).toBe("search_web");
    expect(block.input).toEqual({ query: "Next.js caching" });
  });

  test("3-3. { type: 'tool_result', tool_use_id, content, is_error? } が ClaudeToolResultBlock として型適合する", () => {
    // Arrange & Act: is_error なし
    const blockWithoutError: ClaudeToolResultBlock = {
      type: "tool_result",
      tool_use_id: "tool_abc123",
      content: "検索結果テキスト",
    };

    // is_error あり
    const blockWithError: ClaudeToolResultBlock = {
      type: "tool_result",
      tool_use_id: "tool_abc123",
      content: "エラーが発生しました",
      is_error: true,
    };

    // Assert
    expect(blockWithoutError).toBeDefined();
    expect(blockWithoutError.type).toBe("tool_result");
    expect(blockWithoutError.is_error).toBeUndefined();

    expect(blockWithError).toBeDefined();
    expect(blockWithError.is_error).toBe(true);
  });

  test("3-4. switch による type narrowing が正しく機能する", () => {
    // Arrange
    const blocks: ClaudeContentBlock[] = [
      { type: "text", text: "テキスト" },
      { type: "tool_use", id: "id1", name: "fn", input: {} },
      { type: "tool_result", tool_use_id: "id1", content: "result" },
    ];

    const results: string[] = [];

    // Act: switch で narrowing し、各ブランチの固有プロパティにアクセスする
    for (const block of blocks) {
      switch (block.type) {
        case "text":
          // ClaudeTextBlock に narrowed: block.text にアクセス可能
          results.push(`text:${block.text}`);
          break;
        case "tool_use":
          // ClaudeToolUseBlock に narrowed: block.name にアクセス可能
          results.push(`tool_use:${block.name}`);
          break;
        case "tool_result":
          // ClaudeToolResultBlock に narrowed: block.tool_use_id にアクセス可能
          results.push(`tool_result:${block.tool_use_id}`);
          break;
      }
    }

    // Assert
    expect(results).toEqual(["text:テキスト", "tool_use:fn", "tool_result:id1"]);
  });
});

// ---------------------------------------------------------------------------
// 4. ClaudeStopReason リテラル型
// ---------------------------------------------------------------------------

describe("ClaudeStopReason", () => {
  test("4-1. 定義された4つのリテラル値がすべて型適合する", () => {
    // Arrange & Act
    const reasons: ClaudeStopReason[] = ["end_turn", "tool_use", "max_tokens", "stop_sequence"];

    // Assert: 4つすべてが存在し、適切な文字列であること
    expect(reasons).toHaveLength(4);
    expect(reasons).toContain("end_turn");
    expect(reasons).toContain("tool_use");
    expect(reasons).toContain("max_tokens");
    expect(reasons).toContain("stop_sequence");
  });
});

// ---------------------------------------------------------------------------
// 5. CachedChatResult 構造
// ---------------------------------------------------------------------------

describe("CachedChatResult", () => {
  test("5-1. { text, usage, stopReason } の構造が型適合し、usage が ClaudeUsage 型として入る", () => {
    // Arrange
    const usage: ClaudeUsage = {
      input_tokens: 300,
      output_tokens: 120,
      cache_read_input_tokens: 200,
    };

    // Act
    const result: CachedChatResult = {
      text: "キャッシュされた回答テキスト",
      usage,
      stopReason: "end_turn",
    };

    // Assert
    expect(result).toBeDefined();
    expect(result.text).toBe("キャッシュされた回答テキスト");
    expect(result.usage).toBe(usage);
    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.cache_read_input_tokens).toBe(200);
    expect(result.stopReason).toBe("end_turn");
  });
});
