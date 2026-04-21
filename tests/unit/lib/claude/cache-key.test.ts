/**
 * @jest-environment node
 *
 * src/lib/claude/cache-key.ts の単体テスト
 *
 * テスト対象:
 *   - cacheKey(input: CacheKeyInput): string — SHA-256 hex (64 文字) を返す
 *   - stableStringify によるキー順序非依存シリアライズ
 *   - removeCacheControl による cache_control 除外
 */

import { cacheKey } from "@/lib/claude/cache-key";
import type { CacheKeyInput } from "@/lib/claude/cache-key";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 基本的な有効入力を返す */
function baseInput(): CacheKeyInput {
  return {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Hello" }],
  };
}

// ---------------------------------------------------------------------------
// describe: 正常系
// ---------------------------------------------------------------------------

describe("cacheKey - 正常系", () => {
  test("1. 基本: 有効な CacheKeyInput を渡すと 64 文字の hex が返る", () => {
    // Arrange
    const input = baseInput();

    // Act
    const result = cacheKey(input);

    // Assert
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test("2. 同一入力 → 同一ハッシュ: 2 回呼んで同じ結果", () => {
    // Arrange
    const input = baseInput();

    // Act
    const first = cacheKey(input);
    const second = cacheKey(input);

    // Assert
    expect(first).toBe(second);
  });

  test("3. キー順序非依存: model/messages/system の順序が違っても同じハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      system: "You are a helpful assistant.",
    };
    const inputB: CacheKeyInput = {
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
      model: "claude-sonnet-4-6",
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).toBe(hashB);
  });

  test("4. messages 内のオブジェクト: messages 要素のキー順序が違っても同じハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    };
    // role と content の順序を入れ替えたオブジェクト
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [
        { content: "Hello", role: "user" } as { role: "user" | "assistant"; content: unknown },
      ],
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).toBe(hashB);
  });

  test("5. tools 配列: 同じ内容の tools でキー順序に依存しないハッシュ", () => {
    // Arrange
    const toolA = {
      name: "search",
      description: "Search the web",
      input_schema: { type: "object" },
    };
    const toolB = {
      description: "Search the web",
      name: "search",
      input_schema: { type: "object" },
    };

    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [toolA],
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [toolB],
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).toBe(hashB);
  });

  test("6. 配列の順序は保持: messages が [A, B] と [B, A] は別ハッシュ", () => {
    // Arrange
    const msgA = { role: "user" as const, content: "First" };
    const msgB = { role: "assistant" as const, content: "Second" };

    const inputAB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [msgA, msgB],
    };
    const inputBA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [msgB, msgA],
    };

    // Act
    const hashAB = cacheKey(inputAB);
    const hashBA = cacheKey(inputBA);

    // Assert
    expect(hashAB).not.toBe(hashBA);
  });

  test("7. undefined フィールド除外: system: undefined と system なしは同じハッシュ", () => {
    // Arrange
    const inputWithUndefined: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      system: undefined,
    };
    const inputWithout: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    };

    // Act
    const hashWithUndefined = cacheKey(inputWithUndefined);
    const hashWithout = cacheKey(inputWithout);

    // Assert
    expect(hashWithUndefined).toBe(hashWithout);
  });

  test("8. null は保持: null と undefined は別扱い（null はハッシュ入力に入る）", () => {
    // Arrange
    const inputWithNull: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: null }],
    };
    const inputWithUndefined: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: undefined }],
    };

    // Act
    const hashNull = cacheKey(inputWithNull);
    const hashUndefined = cacheKey(inputWithUndefined);

    // Assert
    expect(hashNull).not.toBe(hashUndefined);
  });
});

// ---------------------------------------------------------------------------
// describe: 異なる入力 → 異なるハッシュ
// ---------------------------------------------------------------------------

describe("cacheKey - 異なる入力 → 異なるハッシュ", () => {
  test("9. model 違い: model 文字列 1 文字違い → 異なるハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).not.toBe(hashB);
  });

  test("10. messages 内容違い: content が違う → 異なるハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hi" }],
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).not.toBe(hashB);
  });

  test("11. temperature 違い: 0.5 と 0.6 → 異なるハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.6,
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).not.toBe(hashB);
  });

  test("12. max_tokens 違い: 1000 と 2000 → 異なるハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1000,
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 2000,
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).not.toBe(hashB);
  });

  test("13. tools 違い: tools の要素数/内容が違う → 異なるハッシュ", () => {
    // Arrange
    const inputA: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ name: "search", description: "Search the web" }],
    };
    const inputB: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        { name: "search", description: "Search the web" },
        { name: "calculator", description: "Perform calculations" },
      ],
    };

    // Act
    const hashA = cacheKey(inputA);
    const hashB = cacheKey(inputB);

    // Assert
    expect(hashA).not.toBe(hashB);
  });
});

// ---------------------------------------------------------------------------
// describe: cache_control 除外
// ---------------------------------------------------------------------------

describe("cacheKey - cache_control 除外", () => {
  test("14. system 内の cache_control 除外: cache_control の有無でハッシュが変わらない", () => {
    // Arrange
    const inputWithout: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      system: [{ type: "text", text: "You are a helpful assistant." }],
    };
    const inputWith: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      system: [
        {
          type: "text",
          text: "You are a helpful assistant.",
          cache_control: { type: "ephemeral" },
        },
      ],
    };

    // Act
    const hashWithout = cacheKey(inputWithout);
    const hashWith = cacheKey(inputWith);

    // Assert
    expect(hashWithout).toBe(hashWith);
  });

  test("15. tools 内の cache_control 除外: cache_control の有無でハッシュが変わらない", () => {
    // Arrange
    const inputWithout: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ name: "search", description: "Search the web" }],
    };
    const inputWith: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "search",
          description: "Search the web",
          cache_control: { type: "ephemeral" },
        },
      ],
    };

    // Act
    const hashWithout = cacheKey(inputWithout);
    const hashWith = cacheKey(inputWith);

    // Assert
    expect(hashWithout).toBe(hashWith);
  });

  test("16. 深くネストした cache_control も除外: 任意の階層の cache_control が無視される", () => {
    // Arrange
    const inputWithout: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    };
    const inputWith: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };

    // Act
    const hashWithout = cacheKey(inputWithout);
    const hashWith = cacheKey(inputWith);

    // Assert
    expect(hashWithout).toBe(hashWith);
  });
});

// ---------------------------------------------------------------------------
// describe: 境界値
// ---------------------------------------------------------------------------

describe("cacheKey - 境界値", () => {
  test("17. 空 messages 配列: messages: [] で有効なハッシュが返る", () => {
    // Arrange
    const input: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages: [],
    };

    // Act
    const result = cacheKey(input);

    // Assert
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test("18. 空 string: model: '' で有効なハッシュが返る", () => {
    // Arrange
    const input: CacheKeyInput = {
      model: "",
      messages: [{ role: "user", content: "Hello" }],
    };

    // Act
    const result = cacheKey(input);

    // Assert
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test("19. 大きな messages: 数十要素でも正常動作する", () => {
    // Arrange
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message number ${i}: ${"a".repeat(100)}`,
    }));
    const input: CacheKeyInput = {
      model: "claude-sonnet-4-6",
      messages,
    };

    // Act
    const result = cacheKey(input);

    // Assert
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
