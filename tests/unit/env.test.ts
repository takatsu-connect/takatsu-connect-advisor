/**
 * @jest-environment node
 */

const baseEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
  GA_PROPERTY_ID: "properties/123456789",
  GSC_SITE_URL: "sc-domain:example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

async function loadEnv() {
  jest.resetModules();
  const mod = await import("@/lib/env");
  mod.resetEnvCache();
  return mod;
}

describe("env validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("accepts valid environment with defaults", async () => {
    Object.assign(process.env, baseEnv);
    const { getEnv } = await loadEnv();
    const env = getEnv();
    expect(env.CLASSIFIER_MODEL).toBe("claude-haiku-4-5");
    expect(env.SPECIALIST_MODEL).toBe("claude-haiku-4-5");
    expect(env.ORCHESTRATOR_MODEL).toBe("claude-sonnet-4-6");
    expect(env.CONTEXT_MESSAGE_LIMIT).toBe(20);
    expect(env.SPECIALIST_TIMEOUT_MS).toBe(8000);
    expect(env.LOCAL_CACHE_TTL_SECS).toBe(30);
    expect(env.WORDPRESS_API_BASE).toBe("https://takatsu-connect.com/wp-json");
  });

  it("respects custom model overrides", async () => {
    Object.assign(process.env, baseEnv, {
      CLASSIFIER_MODEL: "claude-haiku-4-5-custom",
      ORCHESTRATOR_MODEL: "claude-opus-4-7",
    });
    const { getEnv } = await loadEnv();
    const env = getEnv();
    expect(env.CLASSIFIER_MODEL).toBe("claude-haiku-4-5-custom");
    expect(env.ORCHESTRATOR_MODEL).toBe("claude-opus-4-7");
  });

  it("coerces numeric env vars", async () => {
    Object.assign(process.env, baseEnv, {
      CONTEXT_MESSAGE_LIMIT: "50",
      SPECIALIST_TIMEOUT_MS: "10000",
    });
    const { getEnv } = await loadEnv();
    const env = getEnv();
    expect(env.CONTEXT_MESSAGE_LIMIT).toBe(50);
    expect(env.SPECIALIST_TIMEOUT_MS).toBe(10000);
  });

  it("throws if required env vars are missing", async () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...partial } = baseEnv;
    Object.assign(process.env, partial);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getEnv } = await loadEnv();
    expect(() => getEnv()).toThrow(/Invalid environment variables/);
  });

  it("throws if numeric env vars are non-positive", async () => {
    Object.assign(process.env, baseEnv, { CONTEXT_MESSAGE_LIMIT: "0" });
    const { getEnv } = await loadEnv();
    expect(() => getEnv()).toThrow(/Invalid environment variables/);
  });

  it("throws if public URL is malformed", async () => {
    Object.assign(process.env, baseEnv, {
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    });
    const { getEnv } = await loadEnv();
    expect(() => getEnv()).toThrow(/Invalid environment variables/);
  });
});
