/**
 * @jest-environment node
 *
 * src/lib/claude/client.ts の単体テスト
 *
 * テスト対象:
 *   - anthropic シングルトン: Anthropic SDK インスタンスの初期化
 *
 * モック戦略:
 *   - "server-only": 空オブジェクトでスタブ化（Next.js server-only import ガード回避）
 *   - "@anthropic-ai/sdk": Anthropic コンストラクタをモック化（実際のAPI呼び出しを防止）
 *   - "@/lib/env": getEnv() をモック化して ANTHROPIC_API_KEY の制御を可能にする
 */

// server-only モジュールのスタブ化（既存パターンに倣う）
jest.mock("server-only", () => ({}));

// Anthropic SDK のモック（コンストラクタ呼び出しを追跡する）
const mockAnthropicInstance = {};
const MockAnthropicConstructor = jest.fn(() => mockAnthropicInstance);
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: MockAnthropicConstructor,
}));

// getEnv のモック
const mockGetEnv = jest.fn();
jest.mock("@/lib/env", () => ({
  getEnv: mockGetEnv,
}));

// ---------------------------------------------------------------------------
// describe: コンストラクタ呼び出し検証
// ---------------------------------------------------------------------------

describe("anthropic - コンストラクタ呼び出し検証", () => {
  beforeEach(() => {
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    mockGetEnv.mockReturnValue({
      ANTHROPIC_API_KEY: "test-api-key-12345",
    });
  });

  test("1. モジュールロード時に Anthropic コンストラクタが 1 回だけ呼ばれる（シングルトン保証）", async () => {
    // Arrange: モジュールをリセットして再ロードする
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    mockGetEnv.mockReturnValue({ ANTHROPIC_API_KEY: "test-api-key-12345" });

    // モックを再設定（resetModules 後にモックを再適用する）
    jest.mock("server-only", () => ({}));
    jest.mock("@anthropic-ai/sdk", () => ({
      __esModule: true,
      default: MockAnthropicConstructor,
    }));
    jest.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

    // Act: モジュールを動的ロード
    await import("@/lib/claude/client");

    // Assert: コンストラクタは 1 回のみ
    expect(MockAnthropicConstructor).toHaveBeenCalledTimes(1);
  });

  test("2. コンストラクタに { apiKey: env.ANTHROPIC_API_KEY } が渡される", async () => {
    // Arrange
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    const expectedApiKey = "test-api-key-abcdef";
    mockGetEnv.mockReturnValue({ ANTHROPIC_API_KEY: expectedApiKey });

    jest.mock("server-only", () => ({}));
    jest.mock("@anthropic-ai/sdk", () => ({
      __esModule: true,
      default: MockAnthropicConstructor,
    }));
    jest.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

    // Act
    await import("@/lib/claude/client");

    // Assert: 渡された引数オブジェクトを確認
    expect(MockAnthropicConstructor).toHaveBeenCalledWith({
      apiKey: expectedApiKey,
    });
  });
});

// ---------------------------------------------------------------------------
// describe: APIキー取得源の検証
// ---------------------------------------------------------------------------

describe("anthropic - APIキー取得源の検証", () => {
  test("3. getEnv() が返す ANTHROPIC_API_KEY の値がコンストラクタに反映される", async () => {
    // Arrange
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    const specificKey = "sk-ant-specific-key-xyz";
    mockGetEnv.mockReturnValue({ ANTHROPIC_API_KEY: specificKey });

    jest.mock("server-only", () => ({}));
    jest.mock("@anthropic-ai/sdk", () => ({
      __esModule: true,
      default: MockAnthropicConstructor,
    }));
    jest.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

    // Act
    await import("@/lib/claude/client");

    // Assert: 指定したキーがそのままコンストラクタに渡される
    const callArg = (MockAnthropicConstructor.mock.calls as unknown as Array<[{ apiKey: string }]>)[0][0];
    expect(callArg.apiKey).toBe(specificKey);
  });
});

// ---------------------------------------------------------------------------
// describe: export の型検証
// ---------------------------------------------------------------------------

describe("anthropic - export の型検証", () => {
  test("4. import { anthropic } が行え、anthropic が truthy である", async () => {
    // Arrange
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    mockGetEnv.mockReturnValue({ ANTHROPIC_API_KEY: "test-api-key-for-export" });

    jest.mock("server-only", () => ({}));
    jest.mock("@anthropic-ai/sdk", () => ({
      __esModule: true,
      default: MockAnthropicConstructor,
    }));
    jest.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

    // Act
    const { anthropic } = await import("@/lib/claude/client");

    // Assert
    expect(anthropic).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// describe: 環境変数エラーの波及
// ---------------------------------------------------------------------------

describe("anthropic - 環境変数エラーの波及", () => {
  test("5. getEnv() が throw した場合、client.ts のロードも throw する", async () => {
    // Arrange: getEnv が例外を投げるよう設定
    jest.resetModules();
    MockAnthropicConstructor.mockClear();
    const envError = new Error("Invalid environment variables:\n  - ANTHROPIC_API_KEY: Required");
    mockGetEnv.mockImplementation(() => {
      throw envError;
    });

    jest.mock("server-only", () => ({}));
    jest.mock("@anthropic-ai/sdk", () => ({
      __esModule: true,
      default: MockAnthropicConstructor,
    }));
    jest.mock("@/lib/env", () => ({ getEnv: mockGetEnv }));

    // Act & Assert: モジュールロード時に同じエラーが伝播する
    await expect(import("@/lib/claude/client")).rejects.toThrow(
      "Invalid environment variables:"
    );
  });
});
