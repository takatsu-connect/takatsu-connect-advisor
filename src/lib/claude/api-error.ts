import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";

export type ApiErrorKind =
  | "rate_limit"
  | "auth"
  | "permission"
  | "payload_too_large"
  | "bad_request"
  | "server_error"
  | "connection"
  | "timeout"
  | "unknown";

export function classifyApiError(error: unknown): ApiErrorKind {
  if (error instanceof APIConnectionTimeoutError) {
    return "timeout";
  }
  if (error instanceof APIConnectionError) {
    return "connection";
  }
  if (error instanceof APIError) {
    const status = error.status;
    if (status === 400) {
      return "bad_request";
    }
    if (status === 401) {
      return "auth";
    }
    if (status === 403) {
      return "permission";
    }
    if (status === 413) {
      return "payload_too_large";
    }
    if (status === 429) {
      return "rate_limit";
    }
    if (
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return "server_error";
    }
    return "unknown";
  }
  return "unknown";
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof APIConnectionTimeoutError) {
    return true;
  }
  if (error instanceof APIConnectionError) {
    return true;
  }
  if (error instanceof APIError) {
    const status = error.status;
    if (status === undefined) {
      return false;
    }
    if (status === 429) {
      return true;
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    return false;
  }
  return false;
}

export function isAuthError(error: unknown): boolean {
  const kind = classifyApiError(error);
  return kind === "auth" || kind === "permission";
}

export function isPayloadTooLargeError(error: unknown): boolean {
  return classifyApiError(error) === "payload_too_large";
}
