/**
 * @jest-environment node
 *
 * src/lib/claude/cache-control.ts の単体テスト
 *
 * テスト対象:
 *   - withCacheControl: 単一ブロックへの cache_control 付与
 *   - addCacheControlToLast: 配列末尾要素への cache_control 付与
 *   - systemWithCacheControl: system プロンプト向け cache_control 付与
 *   - withCacheControlOnLastContentBlock: message.content 末尾ブロックへの付与
 *   - addCacheControlToLastMessage: messages 配列末尾メッセージへの付与
 */

import {
  withCacheControl,
  addCacheControlToLast,
  systemWithCacheControl,
  withCacheControlOnLastContentBlock,
  addCacheControlToLastMessage,
} from "@/lib/claude/cache-control";
import type { TextBlockParam, MessageParam, ContentBlockParam } from "@/lib/claude/cache-control";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const EPHEMERAL = { type: "ephemeral" } as const;

// ---------------------------------------------------------------------------
// describe: withCacheControl
// ---------------------------------------------------------------------------

describe("withCacheControl", () => {
  test("1. 任意オブジェクトに cache_control: { type: 'ephemeral' } が付与される", () => {
    // Arrange
    const block = { type: "text" as const, text: "hello" };

    // Act
    const result = withCacheControl(block);

    // Assert
    expect(result).toEqual({ type: "text", text: "hello", cache_control: EPHEMERAL });
  });

  test("2. 元のオブジェクトが mutate されない（イミュータブル）", () => {
    // Arrange
    const block = { type: "text" as const, text: "hello" };
    const originalBlock = { ...block };

    // Act
    withCacheControl(block);

    // Assert
    expect(block).toEqual(originalBlock);
    expect((block as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("3. 既に cache_control を持つオブジェクトは ephemeral で上書きされる", () => {
    // Arrange
    const block = {
      type: "text" as const,
      text: "hello",
      cache_control: null as null | { type: "ephemeral" },
    };

    // Act
    const result = withCacheControl(block);

    // Assert
    expect(result.cache_control).toEqual(EPHEMERAL);
  });

  test("4. 元のプロパティはすべて保持される", () => {
    // Arrange
    const block = { type: "text" as const, text: "world", name: "extra" };

    // Act
    const result = withCacheControl(block);

    // Assert
    expect(result.type).toBe("text");
    expect(result.text).toBe("world");
    expect((result as Record<string, unknown>).name).toBe("extra");
    expect(result.cache_control).toEqual(EPHEMERAL);
  });

  test("35. 冪等性: 既に cache_control: { type: 'ephemeral' } を持つオブジェクトへの再適用で正しく動作する", () => {
    // Arrange
    const block = {
      type: "text" as const,
      text: "hello",
      cache_control: { type: "ephemeral" } as { type: "ephemeral" },
    };

    // Act
    const result = withCacheControl(block);

    // Assert
    expect(result.cache_control).toEqual(EPHEMERAL);
    expect(result.text).toBe("hello");
    expect((block as Record<string, unknown>).cache_control).toEqual(EPHEMERAL);
    // 元オブジェクトが mutate されていない（新しいオブジェクトが返る）
    expect(result).not.toBe(block);
  });
});

// ---------------------------------------------------------------------------
// describe: addCacheControlToLast
// ---------------------------------------------------------------------------

describe("addCacheControlToLast", () => {
  test("5. 配列末尾の要素にのみ cache_control が付与される", () => {
    // Arrange
    const blocks = [
      { type: "text" as const, text: "first" },
      { type: "text" as const, text: "second" },
      { type: "text" as const, text: "third" },
    ];

    // Act
    const result = addCacheControlToLast(blocks);

    // Assert
    expect(result[2]).toEqual({ type: "text", text: "third", cache_control: EPHEMERAL });
  });

  test("6. 末尾以外の要素には cache_control が付与されない", () => {
    // Arrange
    const blocks = [
      { type: "text" as const, text: "first" },
      { type: "text" as const, text: "second" },
      { type: "text" as const, text: "third" },
    ];

    // Act
    const result = addCacheControlToLast(blocks);

    // Assert
    expect((result[0] as Record<string, unknown>).cache_control).toBeUndefined();
    expect((result[1] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("7. 空配列は空配列を返す", () => {
    // Arrange
    const blocks: { type: "text"; text: string }[] = [];

    // Act
    const result = addCacheControlToLast(blocks);

    // Assert
    expect(result).toEqual([]);
  });

  test("8. 要素1つの配列でもその要素に cache_control が付与される", () => {
    // Arrange
    const blocks = [{ type: "text" as const, text: "only" }];

    // Act
    const result = addCacheControlToLast(blocks);

    // Assert
    expect(result).toEqual([{ type: "text", text: "only", cache_control: EPHEMERAL }]);
  });

  test("9. 元の配列が mutate されない", () => {
    // Arrange
    const blocks = [
      { type: "text" as const, text: "first" },
      { type: "text" as const, text: "second" },
    ];
    const originalLength = blocks.length;
    const originalSecond = { ...blocks[1] };

    // Act
    addCacheControlToLast(blocks);

    // Assert
    expect(blocks.length).toBe(originalLength);
    expect(blocks[1]).toEqual(originalSecond);
    expect((blocks[1] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("10. 元の要素オブジェクトが mutate されない", () => {
    // Arrange
    const lastBlock = { type: "text" as const, text: "last" };
    const blocks = [lastBlock];

    // Act
    addCacheControlToLast(blocks);

    // Assert
    expect((lastBlock as Record<string, unknown>).cache_control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: systemWithCacheControl
// ---------------------------------------------------------------------------

describe("systemWithCacheControl", () => {
  test("11. 文字列入力: TextBlockParam[] に変換され末尾に cache_control が付与される", () => {
    // Arrange
    const system = "あなたはSEO専門家です。";

    // Act
    const result = systemWithCacheControl(system);

    // Assert
    expect(result).toEqual([
      { type: "text", text: "あなたはSEO専門家です。", cache_control: EPHEMERAL },
    ]);
  });

  test("12. 空文字列入力: 空配列を返す", () => {
    // Arrange
    const system = "";

    // Act
    const result = systemWithCacheControl(system);

    // Assert
    expect(result).toEqual([]);
  });

  test("13. TextBlockParam[] 入力: 末尾要素にのみ cache_control が付与される", () => {
    // Arrange
    const system: TextBlockParam[] = [
      { type: "text", text: "共通知識ブロック" },
      { type: "text", text: "エージェント固有ブロック" },
    ];

    // Act
    const result = systemWithCacheControl(system);

    // Assert
    expect(result).toEqual([
      { type: "text", text: "共通知識ブロック" },
      { type: "text", text: "エージェント固有ブロック", cache_control: EPHEMERAL },
    ]);
  });

  test("14. TextBlockParam[] 入力: 末尾以外には cache_control が付与されない", () => {
    // Arrange
    const system: TextBlockParam[] = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];

    // Act
    const result = systemWithCacheControl(system);

    // Assert
    expect((result[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("15. 空の TextBlockParam[] 入力: 空配列を返す", () => {
    // Arrange
    const system: TextBlockParam[] = [];

    // Act
    const result = systemWithCacheControl(system);

    // Assert
    expect(result).toEqual([]);
  });

  test("16. 元の TextBlockParam[] が mutate されない", () => {
    // Arrange
    const system: TextBlockParam[] = [
      { type: "text", text: "first" },
      { type: "text", text: "last" },
    ];
    const originalLast = { ...system[1] };

    // Act
    systemWithCacheControl(system);

    // Assert
    expect(system[1]).toEqual(originalLast);
    expect((system[1] as Record<string, unknown>).cache_control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: withCacheControlOnLastContentBlock
// ---------------------------------------------------------------------------

describe("withCacheControlOnLastContentBlock", () => {
  test("17. content が string: TextBlockParam[] に変換した content を持つ MessageParam を返す", () => {
    // Arrange
    const message: MessageParam = { role: "user", content: "こんにちは" };

    // Act
    const result = withCacheControlOnLastContentBlock(message);

    // Assert
    expect(result).toEqual({
      role: "user",
      content: [{ type: "text", text: "こんにちは", cache_control: EPHEMERAL }],
    });
  });

  test("18. content が ContentBlockParam[]: 末尾要素に cache_control が付与された新しい content を持つ MessageParam を返す", () => {
    // Arrange
    const message: MessageParam = {
      role: "user",
      content: [
        { type: "text", text: "ブロック1" },
        { type: "text", text: "ブロック2" },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);

    // Assert
    expect(result).toEqual({
      role: "user",
      content: [
        { type: "text", text: "ブロック1" },
        { type: "text", text: "ブロック2", cache_control: EPHEMERAL },
      ],
    });
  });

  test("19. content が ContentBlockParam[]: 末尾以外には cache_control が付与されない", () => {
    // Arrange
    const message: MessageParam = {
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);
    const content = result.content as ContentBlockParam[];

    // Assert
    expect((content[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("20. content が空配列: 元の MessageParam がそのまま返る", () => {
    // Arrange
    const message: MessageParam = { role: "user", content: [] };

    // Act
    const result = withCacheControlOnLastContentBlock(message);

    // Assert
    expect(result).toBe(message);
  });

  test("31. content 末尾が tool_use ブロック: cache_control が付与される", () => {
    // Arrange
    const message: MessageParam = {
      role: "assistant",
      content: [
        { type: "text", text: "計算します" },
        { type: "tool_use", id: "toolu_1", name: "calc", input: { x: 1 } },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);
    const content = result.content as ContentBlockParam[];

    // Assert
    expect((content[1] as Record<string, unknown>).cache_control).toEqual(EPHEMERAL);
    expect((content[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("32. content 末尾が tool_result ブロック: cache_control が付与される", () => {
    // Arrange
    const message: MessageParam = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "42" }],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);
    const content = result.content as ContentBlockParam[];

    // Assert
    expect((content[0] as Record<string, unknown>).cache_control).toEqual(EPHEMERAL);
  });

  test("33. content 末尾が image ブロック: cache_control が付与される", () => {
    // Arrange
    const message: MessageParam = {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
        },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);
    const content = result.content as ContentBlockParam[];

    // Assert
    expect((content[0] as Record<string, unknown>).cache_control).toEqual(EPHEMERAL);
  });

  test("34. content が [text, thinking] 配列: thinking が末尾のため元の MessageParam がそのまま返る（同一参照）", () => {
    // Arrange
    const message: MessageParam = {
      role: "assistant",
      content: [
        { type: "text", text: "考え中" },
        { type: "thinking", thinking: "...", signature: "sig" },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);
    const content = result.content as ContentBlockParam[];

    // Assert
    expect(result).toBe(message);
    expect((content[0] as Record<string, unknown>).cache_control).toBeUndefined();
    expect((content[1] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("21. content 末尾が thinking 型: cache_control 非対応のため元の MessageParam が返る", () => {
    // Arrange
    const message: MessageParam = {
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "thinking", thinking: "let me think...", signature: "sig" },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);

    // Assert
    expect(result).toBe(message);
  });

  test("22. content 末尾が redacted_thinking 型: cache_control 非対応のため元の MessageParam が返る", () => {
    // Arrange
    const message: MessageParam = {
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "redacted_thinking", data: "redacted_data" },
      ],
    };

    // Act
    const result = withCacheControlOnLastContentBlock(message);

    // Assert
    expect(result).toBe(message);
  });

  test("23. 元の MessageParam が mutate されない", () => {
    // Arrange
    const originalContent: ContentBlockParam[] = [{ type: "text", text: "hello" }];
    const message: MessageParam = { role: "user", content: originalContent };

    // Act
    withCacheControlOnLastContentBlock(message);

    // Assert
    expect(message.content).toBe(originalContent);
    expect((originalContent[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  test("24. 元の content 配列が mutate されない", () => {
    // Arrange
    const originalBlock = { type: "text" as const, text: "last" };
    const message: MessageParam = {
      role: "user",
      content: [originalBlock],
    };

    // Act
    withCacheControlOnLastContentBlock(message);

    // Assert
    expect((originalBlock as Record<string, unknown>).cache_control).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: addCacheControlToLastMessage
// ---------------------------------------------------------------------------

describe("addCacheControlToLastMessage", () => {
  test("25. 配列末尾の message の content 末尾ブロックに cache_control が付与される", () => {
    // Arrange
    const messages: MessageParam[] = [
      { role: "user", content: "first message" },
      { role: "assistant", content: "second message" },
    ];

    // Act
    const result = addCacheControlToLastMessage(messages);

    // Assert
    expect(result[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "second message", cache_control: EPHEMERAL }],
    });
  });

  test("26. 末尾以外の message は変更されない", () => {
    // Arrange
    const firstMessage: MessageParam = { role: "user", content: "first" };
    const messages: MessageParam[] = [firstMessage, { role: "assistant", content: "second" }];

    // Act
    const result = addCacheControlToLastMessage(messages);

    // Assert
    expect(result[0]).toEqual({ role: "user", content: "first" });
  });

  test("27. 空配列は空配列を返す", () => {
    // Arrange
    const messages: MessageParam[] = [];

    // Act
    const result = addCacheControlToLastMessage(messages);

    // Assert
    expect(result).toEqual([]);
  });

  test("28. 元の配列が mutate されない", () => {
    // Arrange
    const messages: MessageParam[] = [{ role: "user", content: "hello" }];
    const originalContent = messages[0].content;

    // Act
    addCacheControlToLastMessage(messages);

    // Assert
    expect(messages[0].content).toBe(originalContent);
  });

  test("29. 元のメッセージオブジェクトが mutate されない", () => {
    // Arrange
    const lastMessage: MessageParam = { role: "user", content: "last" };
    const messages: MessageParam[] = [lastMessage];

    // Act
    addCacheControlToLastMessage(messages);

    // Assert
    expect(lastMessage.content).toBe("last");
  });

  test("30. ContentBlockParam[] content を持つ末尾メッセージ: 末尾ブロックに cache_control が付与される", () => {
    // Arrange
    const messages: MessageParam[] = [
      { role: "user", content: "earlier" },
      {
        role: "user",
        content: [
          { type: "text", text: "block1" },
          { type: "text", text: "block2" },
        ],
      },
    ];

    // Act
    const result = addCacheControlToLastMessage(messages);
    const lastContent = result[1].content as ContentBlockParam[];

    // Assert
    expect(lastContent[1]).toEqual({ type: "text", text: "block2", cache_control: EPHEMERAL });
    expect((lastContent[0] as Record<string, unknown>).cache_control).toBeUndefined();
  });
});
