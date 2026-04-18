/**
 * @jest-environment node
 *
 * src/app/(auth)/auth/callback/route.ts の単体テスト（モックベース）。
 *
 * Google OAuth の Code Exchange ルートハンドラ (GET) を検証する。
 * sanitizeNextPath は非 export のため、GET ハンドラ経由で全分岐をカバーする（オプションB）。
 */

import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// @/lib/db/supabase-server モック
// supabaseServer() の戻り値として使う exchangeCodeForSession のモック関数を
// テストケースごとに差し替えられるよう変数で保持する。
// ---------------------------------------------------------------------------

const mockExchangeCodeForSession = jest.fn();

jest.mock("@/lib/db/supabase-server", () => ({
  supabaseServer: jest.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

// ---------------------------------------------------------------------------
// テスト用ヘルパー
// ---------------------------------------------------------------------------

/** テスト用の NextRequest を生成する */
function makeReq(qs: string) {
  return new NextRequest(`https://example.com/auth/callback?${qs}`);
}

/**
 * レスポンスのリダイレクト先 pathname を返す。
 * NextResponse.redirect は status 307 を返す。
 */
function getRedirectPathname(res: Response): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).pathname;
}

/**
 * レスポンスのリダイレクト先のクエリパラメータを返す。
 */
function getRedirectSearchParams(res: Response): URLSearchParams | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams;
}

// ---------------------------------------------------------------------------
// GET ハンドラのテスト
// ---------------------------------------------------------------------------

describe("GET /auth/callback", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    jest.resetModules();
    const mod = await import("@/app/(auth)/auth/callback/route");
    GET = mod.GET;
  });

  beforeEach(() => {
    mockExchangeCodeForSession.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. code なし → /login?error=missing_code へリダイレクト
  // -------------------------------------------------------------------------
  describe("code クエリパラメータが存在しない場合", () => {
    it("307 リダイレクト、Location が /login、error=missing_code であること", async () => {
      const req = makeReq("");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/login");
      expect(getRedirectSearchParams(res)?.get("error")).toBe("missing_code");
    });
  });

  // -------------------------------------------------------------------------
  // 2. code あり・exchangeCodeForSession 成功・next なし → /chat へリダイレクト
  // -------------------------------------------------------------------------
  describe("code あり・exchangeCodeForSession 成功", () => {
    beforeEach(() => {
      mockExchangeCodeForSession.mockResolvedValue({ error: null });
    });

    it("next なし → 307 リダイレクト、Location が /chat であること", async () => {
      const req = makeReq("code=valid-auth-code");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });

    // -----------------------------------------------------------------------
    // 3. next=/dashboard → /dashboard へリダイレクト
    // -----------------------------------------------------------------------
    it("next=/dashboard → 307 リダイレクト、Location が /dashboard であること", async () => {
      const req = makeReq("code=valid-auth-code&next=/dashboard");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/dashboard");
    });
  });

  // -------------------------------------------------------------------------
  // 4. code あり・exchangeCodeForSession 失敗（error 返却）
  //    → /login?error=exchange_failed へリダイレクト、console.error 呼ばれる
  // -------------------------------------------------------------------------
  describe("code あり・exchangeCodeForSession 失敗", () => {
    it("307 リダイレクト、Location が /login、error=exchange_failed、console.error が呼ばれること", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      mockExchangeCodeForSession.mockResolvedValue({
        error: { message: "invalid grant" },
      });

      const req = makeReq("code=bad-code");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/login");
      expect(getRedirectSearchParams(res)?.get("error")).toBe("exchange_failed");
      expect(consoleSpy).toHaveBeenCalledWith(
        "[auth/callback] exchangeCodeForSession failed:",
        "invalid grant"
      );

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeNextPath のオープンリダイレクト対策テスト
  // GET ハンドラ経由で全分岐をカバーする（オプションB）
  // -------------------------------------------------------------------------
  describe("sanitizeNextPath: オープンリダイレクト対策", () => {
    beforeEach(() => {
      mockExchangeCodeForSession.mockResolvedValue({ error: null });
    });

    // -----------------------------------------------------------------------
    // 5. next=//evil.com → プロトコル相対URLは拒否、/chat へフォールバック
    // -----------------------------------------------------------------------
    it("next=//evil.com → 307 リダイレクト、Location が /chat であること", async () => {
      const req = makeReq("code=valid-auth-code&next=//evil.com");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });

    // -----------------------------------------------------------------------
    // 6. next=/\\evil.com → バックスラッシュを含むパスは拒否、/chat へフォールバック
    // -----------------------------------------------------------------------
    it("next=/\\\\evil.com → 307 リダイレクト、Location が /chat であること", async () => {
      const req = makeReq("code=valid-auth-code&next=%2F%5Cevil.com");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });

    // -----------------------------------------------------------------------
    // 7. next=javascript:alert(1) → javascript: スキームは拒否、/chat へフォールバック
    // -----------------------------------------------------------------------
    it("next=javascript:alert(1) → 307 リダイレクト、Location が /chat であること", async () => {
      const req = makeReq("code=valid-auth-code&next=javascript%3Aalert(1)");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });

    // -----------------------------------------------------------------------
    // 8. next=Javascript:alert(1) → 大文字小文字不問で拒否、/chat へフォールバック
    // -----------------------------------------------------------------------
    it("next=Javascript:alert(1) → 307 リダイレクト、Location が /chat であること（大文字小文字不問）", async () => {
      const req = makeReq("code=valid-auth-code&next=Javascript%3Aalert(1)");
      const res = await GET(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });
  });
});
