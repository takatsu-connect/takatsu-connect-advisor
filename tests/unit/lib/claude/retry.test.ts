/**
 * @jest-environment node
 *
 * src/lib/claude/retry.ts の単体テスト
 *
 * テスト対象:
 *   - withRetry: リトライラッパー関数
 *   - RETRY_CONFIG: デフォルト設定値
 *
 * モック戦略:
 *   - jest.useFakeTimers(): sleep() が内部で使う setTimeout を即座に解決させる
 *   - @anthropic-ai/sdk のエラークラスを直接 new してテストデータとして使用
 *   - fn は jest.fn() で作成し、呼出回数と戻り値を制御する
 *
 * fakeTimers の利用方法:
 *   - beforeEach で jest.useFakeTimers() を有効化
 *   - afterEach で jest.useRealTimers() に戻す
 *   - withRetry() の Promise を開始した後、jest.runAllTimersAsync() で
 *     内部の sleep (setTimeout) をすべて即時解決させる
 *   - これにより指数バックオフの実時間待機なしにテストが完了する
 */

import {
  RateLimitError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  APIConnectionError,
  APIConnectionTimeoutError,
  PermissionDeniedError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { withRetry, RETRY_CONFIG } from "@/lib/claude/retry";

// ---------------------------------------------------------------------------
// ヘルパー: APIError サブクラスのインスタンス生成
//
// APIError コンストラクタ: (status, error, message, headers)
// RateLimitError / AuthenticationError / BadRequestError は APIError<N, Headers> を継承
// InternalServerError は APIError<number, Headers> を継承
// APIConnectionError は { message, cause } を受け取る独自コンストラクタ
// ---------------------------------------------------------------------------

function makeHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers();
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      h.set(k, v);
    }
  }
  return h;
}

function makeRateLimitError(retryAfter?: string): RateLimitError {
  const headers = retryAfter ? makeHeaders({ "retry-after": retryAfter }) : makeHeaders();
  return new RateLimitError(429, {}, "Rate limit exceeded", headers);
}

function makeAuthenticationError(): AuthenticationError {
  return new AuthenticationError(401, {}, "Unauthorized", makeHeaders());
}

function makeBadRequestError(): BadRequestError {
  return new BadRequestError(400, {}, "Bad request", makeHeaders());
}

function makeInternalServerError(): InternalServerError {
  return new InternalServerError(500, {}, "Internal server error", makeHeaders());
}

function makeAPIConnectionError(): APIConnectionError {
  return new APIConnectionError({ message: "Connection error" });
}

function makeAPIConnectionTimeoutError(): APIConnectionTimeoutError {
  return new APIConnectionTimeoutError({ message: "Timeout" });
}

function makeInternalServerErrorWithStatus(status: number): InternalServerError {
  return new InternalServerError(status, {}, `Server error ${status}`, makeHeaders());
}

function makePermissionDeniedError(): PermissionDeniedError {
  return new PermissionDeniedError(403, {}, "Forbidden", makeHeaders());
}

function makeAPIUserAbortError(): APIUserAbortError {
  return new APIUserAbortError({ message: "Aborted" });
}

// ---------------------------------------------------------------------------
// 共通セットアップ
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. 正常系
// ---------------------------------------------------------------------------

describe("withRetry - 正常系", () => {
  test("1-1. 初回成功時はリトライなし・そのまま値を返す", async () => {
    // Arrange
    const fn = jest.fn().mockResolvedValue("ok");

    // Act
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Assert
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("1-2. 2回目に成功した場合、最終的に値を返し fn は2回呼ばれる", async () => {
    // Arrange: 1回目は RateLimitError、2回目は成功
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError())
      .mockResolvedValueOnce("success-on-retry");

    // Act
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Assert
    expect(result).toBe("success-on-retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. リトライ可能エラー
// ---------------------------------------------------------------------------

describe("withRetry - リトライ可能エラー", () => {
  test("2-1. RateLimitError (429) で maxAttempts まで再試行し、全失敗で最後のエラーを throw", async () => {
    // Arrange: 全試行で RateLimitError
    const error = makeRateLimitError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert: rejects の検証と runAllTimersAsync を並行実行することで
    // unhandled rejection (PromiseRejectionHandledWarning) を回避する
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
  });

  test("2-2. InternalServerError (500) でリトライされる（maxAttempts 回呼ばれる）", async () => {
    // Arrange
    const error = makeInternalServerError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
  });

  test("2-3. APIConnectionError でリトライされる（maxAttempts 回呼ばれる）", async () => {
    // Arrange
    const error = makeAPIConnectionError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
  });

  test("2-4. APIConnectionTimeoutError でリトライされる（APIConnectionError とは別の instanceof 分岐）", async () => {
    // Arrange
    // APIConnectionTimeoutError は APIConnectionError のサブクラスだが、
    // isRetryable() では APIConnectionTimeoutError を先に判定する別分岐がある。
    // そのパスを通してリトライが有効であることを検証する。
    const error = makeAPIConnectionTimeoutError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
  });

  test.each([502, 503, 504])(
    "2-5. InternalServerError (status=%i) でリトライされる（maxAttempts 回呼ばれる）",
    async (status) => {
      // Arrange
      const error = makeInternalServerErrorWithStatus(status);
      const fn = jest.fn().mockRejectedValue(error);

      // Act & Assert
      const promise = withRetry(fn);
      await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
      expect(fn).toHaveBeenCalledTimes(RETRY_CONFIG.maxAttempts);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. リトライ不可エラー
// ---------------------------------------------------------------------------

describe("withRetry - リトライ不可エラー", () => {
  test("3-1. AuthenticationError (401) で即座に再throw、fn は1回のみ呼ばれる", async () => {
    // Arrange
    const error = makeAuthenticationError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("3-2. BadRequestError (400) で即座に再throw、fn は1回のみ呼ばれる", async () => {
    // Arrange
    const error = makeBadRequestError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("3-3. PermissionDeniedError (403) で即座に再throw、fn は1回のみ呼ばれる", async () => {
    // Arrange
    const error = makePermissionDeniedError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("3-4. 非 APIError (Error) で即座に再throw、リトライされない", async () => {
    // Arrange
    // APIError のサブクラスでない通常の Error は isRetryable() で false を返す
    const error = new Error("network");
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("3-5. APIError (status=undefined) で即座に再throw、リトライされない", async () => {
    // Arrange
    // APIUserAbortError は APIError<undefined, undefined, undefined> を継承しており
    // status が undefined になる。isRetryable() の "status === undefined → false" 分岐を検証する。
    // （APIConnectionError/APIConnectionTimeoutError ではないため、その分岐には入らない）
    const error = makeAPIUserAbortError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn);
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Retry-After ヘッダ
// ---------------------------------------------------------------------------

describe("withRetry - Retry-After ヘッダ", () => {
  test("4-1. 429 + retry-after: 5 がある場合、delay が 5000ms 以上になる", async () => {
    // Arrange: 1回目は retry-after: 5 付きの RateLimitError、2回目は成功
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError("5"))
      .mockResolvedValueOnce("recovered");

    // タイマー実行前に setTimeout の呼び出し引数を検証するため
    // jest.spyOn で setTimeout を監視する
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");

    // Act
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Assert: 結果が正しく返る
    expect(result).toBe("recovered");

    // Assert: setTimeout に渡された delay が 5000ms 以上であることを確認
    // sleep(ms) → setTimeout(resolve, ms) の形で呼ばれる
    const delays = setTimeoutSpy.mock.calls.map((args) => args[1] as number);
    const maxDelay = Math.max(...delays);
    expect(maxDelay).toBeGreaterThanOrEqual(5000);

    setTimeoutSpy.mockRestore();
  });

  test("4-2. 429 + retry-after なしの場合、delay は指数バックオフのみ（5000ms 未満になり得る）", async () => {
    // Arrange: retry-after なしの RateLimitError、2回目は成功
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError())
      .mockResolvedValueOnce("recovered-no-retry-after");

    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");

    // Act
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Assert: 正常に解決する
    expect(result).toBe("recovered-no-retry-after");
    // setTimeout が呼ばれていること（delay は指数バックオフ値）
    expect(setTimeoutSpy).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. config override
// ---------------------------------------------------------------------------

describe("withRetry - config override", () => {
  test("5-1. config: { maxAttempts: 1 } を渡すと1回しか試行せずエラーを throw する", async () => {
    // Arrange
    const error = makeRateLimitError();
    const fn = jest.fn().mockRejectedValue(error);

    // Act & Assert
    const promise = withRetry(fn, { maxAttempts: 1 });
    await Promise.all([expect(promise).rejects.toThrow(error), jest.runAllTimersAsync()]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
