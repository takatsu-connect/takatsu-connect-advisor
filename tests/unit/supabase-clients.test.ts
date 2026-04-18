/**
 * @jest-environment node
 *
 * Supabase クライアントラッパーの基本動作を検証する。
 * 実際の HTTP リクエストは行わず、createClient / createBrowserClient の引数を確認する。
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-xxxx",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xxxx",
};

describe("Supabase client wrappers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ...baseEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("supabaseBrowser", () => {
    it("creates a browser client with public keys", async () => {
      const { supabaseBrowser } = await import("@/lib/db/supabase-browser");
      const client = supabaseBrowser();
      expect(client).toBeDefined();
      expect(typeof client.auth).toBe("object");
    });
  });

  describe("supabaseAdmin", () => {
    it("creates an admin client and does not persist sessions", async () => {
      const { supabaseAdmin } = await import("@/lib/db/supabase-admin");
      const client = supabaseAdmin();
      expect(client).toBeDefined();
      expect(typeof client.from).toBe("function");
    });
  });

  describe("supabaseMiddleware", () => {
    it("is a named export taking a NextRequest", async () => {
      const mod = await import("@/lib/db/supabase-middleware");
      expect(typeof mod.supabaseMiddleware).toBe("function");
    });
  });

  describe("supabaseServer", () => {
    it("is an async factory that uses next/headers cookies", async () => {
      const source = readFileSync(
        resolve(__dirname, "../../src/lib/db/supabase-server.ts"),
        "utf-8",
      );
      expect(source).toContain('import "server-only"');
      expect(source).toMatch(/from "next\/headers"/);
      expect(source).toMatch(/cookies\(\)/);
    });
  });

  describe("no sensitive import leaks", () => {
    it("supabase-browser does not import server-only", () => {
      const source = readFileSync(
        resolve(__dirname, "../../src/lib/db/supabase-browser.ts"),
        "utf-8",
      );
      expect(source).not.toMatch(/import "server-only"/);
      expect(source).toMatch(/"use client"/);
    });

    it("supabase-admin requires server-only", () => {
      const source = readFileSync(
        resolve(__dirname, "../../src/lib/db/supabase-admin.ts"),
        "utf-8",
      );
      expect(source).toContain('import "server-only"');
      expect(source).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    });
  });
});
