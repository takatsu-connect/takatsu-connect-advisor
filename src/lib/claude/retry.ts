import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "@anthropic-ai/sdk";

export type RetryConfig = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffBase: number;
  jitterFactor: number;
};

export const RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffBase: 2,
  jitterFactor: 0.25,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
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

function getRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIError)) {
    return null;
  }
  if (error.status !== 429) {
    return null;
  }
  const headers = error.headers;
  if (!headers) {
    return null;
  }
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }
  const seconds = parseFloat(retryAfter);
  if (isNaN(seconds)) {
    return null;
  }
  return seconds * 1000;
}

function calcDelayMs(
  attempt: number,
  config: RetryConfig,
  error: unknown,
): number {
  const baseDelay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffBase, attempt),
    config.maxDelayMs,
  );
  const jitter = Math.random() * config.jitterFactor * baseDelay;
  const backoffDelay = Math.min(baseDelay + jitter, config.maxDelayMs);

  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.max(backoffDelay, retryAfterMs);
  }
  return backoffDelay;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const resolvedConfig = { ...RETRY_CONFIG, ...config };
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }
      if (attempt + 1 >= resolvedConfig.maxAttempts) {
        throw error;
      }
      const delayMs = calcDelayMs(attempt, resolvedConfig, error);
      await sleep(delayMs);
      attempt++;
    }
  }
}
