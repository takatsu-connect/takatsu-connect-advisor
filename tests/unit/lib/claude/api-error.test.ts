/**
 * @jest-environment node
 *
 * src/lib/claude/api-error.ts の単体テスト
 *
 * テスト対象:
 *   - classifyApiError: エラー種別の分類
 *   - isRetryable: リトライ可否の判定
 *   - isAuthError: 認証エラーの判定
 *   - isPayloadTooLargeError: ペイロード超過エラーの判定
 *
 * モック戦略:
 *   - @anthropic-ai/sdk のエラークラスを直接 new してテストデータとして使用
 *   - retry.test.ts と同パターンのヘルパー関数でインスタンスを生成
 */

import {
  APIError,
  RateLimitError,
  AuthenticationError,
  PermissionDeniedError,
  BadRequestError,
  InternalServerError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";
import {
  classifyApiError,
  isRetryable,
  isAuthError,
  isPayloadTooLargeError,
} from "@/lib/claude/api-error";

// ---------------------------------------------------------------------------
// ヘルパー: APIError サブクラスのインスタンス生成
//
// APIError コンストラクタ: (status, error, message, headers)
// RateLimitError / AuthenticationError / BadRequestError / InternalServerError /
//   PermissionDeniedError は APIError を継承
// APIConnectionError / APIConnectionTimeoutError は独自コンストラクタ
// ---------------------------------------------------------------------------

function makeHeaders(): Headers {
  return new Headers();
}

function makeRateLimitError(): RateLimitError {
  return new RateLimitError(429, {}, "Rate limit exceeded", makeHeaders());
}

function makeAuthenticationError(): AuthenticationError {
  return new AuthenticationError(401, {}, "Unauthorized", makeHeaders());
}

function makePermissionDeniedError(): PermissionDeniedError {
  return new PermissionDeniedError(403, {}, "Forbidden", makeHeaders());
}

function makeBadRequestError(): BadRequestError {
  return new BadRequestError(400, {}, "Bad request", makeHeaders());
}

function makePayloadTooLargeError(): APIError {
  return new APIError(413, {}, "Payload too large", makeHeaders());
}

function makeInternalServerError(status = 500): InternalServerError {
  return new InternalServerError(status, {}, `Server error (${status})`, makeHeaders());
}

function makeAPIConnectionError(): APIConnectionError {
  return new APIConnectionError({ message: "Connection error" });
}

function makeAPIConnectionTimeoutError(): APIConnectionTimeoutError {
  return new APIConnectionTimeoutError({ message: "Timeout" });
}

// ---------------------------------------------------------------------------
// 1. classifyApiError
// ---------------------------------------------------------------------------

describe("classifyApiError", () => {
  test('1-1. RateLimitError (429) → "rate_limit"', () => {
    // Arrange
    const error = makeRateLimitError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("rate_limit");
  });

  test('1-2. AuthenticationError (401) → "auth"', () => {
    // Arrange
    const error = makeAuthenticationError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("auth");
  });

  test('1-3. PermissionDeniedError (403) → "permission"', () => {
    // Arrange
    const error = makePermissionDeniedError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("permission");
  });

  test('1-4. APIError (status=413) → "payload_too_large"', () => {
    // Arrange
    // 413 は APIError の status で分類される。APIError を直接 new する（BadRequestErrorは status=400 固定のため）。
    const error = makePayloadTooLargeError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("payload_too_large");
  });

  test('1-5. BadRequestError (400) → "bad_request"', () => {
    // Arrange
    const error = makeBadRequestError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("bad_request");
  });

  test('1-6. InternalServerError (500) → "server_error"', () => {
    // Arrange
    const error = makeInternalServerError(500);

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("server_error");
  });

  test.each([502, 503, 504])(
    '1-7. InternalServerError (status=%i) → "server_error"',
    (status) => {
      // Arrange
      const error = makeInternalServerError(status);

      // Act
      const kind = classifyApiError(error);

      // Assert
      expect(kind).toBe("server_error");
    },
  );

  test('1-8. APIConnectionError → "connection"', () => {
    // Arrange
    const error = makeAPIConnectionError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("connection");
  });

  test('1-9. APIConnectionTimeoutError → "timeout"', () => {
    // Arrange
    // APIConnectionTimeoutError は APIConnectionError のサブクラスだが、
    // classifyApiError では先に APIConnectionTimeoutError を判定する分岐がある。
    const error = makeAPIConnectionTimeoutError();

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("timeout");
  });

  test('1-10. 非 APIError (new Error) → "unknown"', () => {
    // Arrange
    const error = new Error("unexpected error");

    // Act
    const kind = classifyApiError(error);

    // Assert
    expect(kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 2. isRetryable
// ---------------------------------------------------------------------------

describe("isRetryable", () => {
  test.each([
    ["RateLimitError (429)", makeRateLimitError()],
    ["InternalServerError (500)", makeInternalServerError(500)],
    ["InternalServerError (502)", makeInternalServerError(502)],
    ["InternalServerError (503)", makeInternalServerError(503)],
    ["InternalServerError (504)", makeInternalServerError(504)],
    ["APIConnectionError", makeAPIConnectionError()],
    ["APIConnectionTimeoutError", makeAPIConnectionTimeoutError()],
  ] as const)(
    "2-1. %s → true (リトライ対象)",
    (_label, error) => {
      // Act
      const result = isRetryable(error);

      // Assert
      expect(result).toBe(true);
    },
  );

  test.each([
    ["AuthenticationError (401)", makeAuthenticationError()],
    ["PermissionDeniedError (403)", makePermissionDeniedError()],
    ["BadRequestError (413)", makePayloadTooLargeError()],
    ["BadRequestError (400)", makeBadRequestError()],
    ["非 APIError (Error)", new Error("generic")],
  ] as const)(
    "2-2. %s → false (リトライ不可)",
    (_label, error) => {
      // Act
      const result = isRetryable(error);

      // Assert
      expect(result).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. isAuthError
// ---------------------------------------------------------------------------

describe("isAuthError", () => {
  test("3-1. AuthenticationError (401) → true", () => {
    // Arrange
    const error = makeAuthenticationError();

    // Act
    const result = isAuthError(error);

    // Assert
    expect(result).toBe(true);
  });

  test("3-2. PermissionDeniedError (403) → true", () => {
    // Arrange
    const error = makePermissionDeniedError();

    // Act
    const result = isAuthError(error);

    // Assert
    expect(result).toBe(true);
  });

  test.each([
    ["RateLimitError (429)", makeRateLimitError()],
    ["InternalServerError (500)", makeInternalServerError(500)],
    ["非 APIError (Error)", new Error("other")],
  ] as const)(
    "3-3. %s → false",
    (_label, error) => {
      // Act
      const result = isAuthError(error);

      // Assert
      expect(result).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. isPayloadTooLargeError
// ---------------------------------------------------------------------------

describe("isPayloadTooLargeError", () => {
  test("4-1. BadRequestError (status=413) → true", () => {
    // Arrange
    const error = makePayloadTooLargeError();

    // Act
    const result = isPayloadTooLargeError(error);

    // Assert
    expect(result).toBe(true);
  });

  test.each([
    ["BadRequestError (400)", makeBadRequestError()],
    ["AuthenticationError (401)", makeAuthenticationError()],
    ["RateLimitError (429)", makeRateLimitError()],
  ] as const)(
    "4-2. %s → false",
    (_label, error) => {
      // Act
      const result = isPayloadTooLargeError(error);

      // Assert
      expect(result).toBe(false);
    },
  );
});
