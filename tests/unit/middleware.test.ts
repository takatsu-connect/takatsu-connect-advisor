/**
 * @jest-environment node
 *
 * src/middleware.ts の単体テスト（モックベース）。
 *
 * Edge Runtime 上の実際の動作検証は別タスク vru.5 の E2E テストで補完する。
 * ここでは @supabase/ssr をモックし、ルーティングロジックを検証する。
 */

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// @supabase/ssr モック
// createServerClient の戻り値として使う auth.getUser のモック関数を
// テストケースごとに差し替えられるよう変数で保持する。
// ---------------------------------------------------------------------------

const mockGetUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

// ---------------------------------------------------------------------------
// テスト用ヘルパー
// ---------------------------------------------------------------------------

/** テスト用の NextRequest を生成する */
function makeRequest(pathname: string, baseUrl = "http://localhost:3000") {
  return new NextRequest(new URL(pathname, baseUrl));
}

/**
 * レスポンスがリダイレクトかどうか確認し、リダイレクト先 pathname を返す。
 * NextResponse.redirect は status 307 を返す。
 */
function getRedirectPathname(res: NextResponse): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).pathname;
}

// ---------------------------------------------------------------------------
// isProtectedPath の直接テスト
// ---------------------------------------------------------------------------

describe("isProtectedPath", () => {
  let isProtectedPath: (pathname: string) => boolean;

  beforeAll(async () => {
    jest.resetModules();
    const mod = await import("@/middleware");
    isProtectedPath = mod.isProtectedPath;
  });

  it.each([
    ["/chat", true],
    ["/chat/new", true],
    ["/chat/session/abc-123", true],
    ["/api/chat", true],
    ["/api/chat/foo", true],
    ["/api/sessions", true],
    ["/api/sessions/abc", true],
  ])("isProtectedPath('%s') === %s", (pathname, expected) => {
    expect(isProtectedPath(pathname)).toBe(expected);
  });

  it.each([
    ["/login", false],
    ["/", false],
    ["/api/auth/signout", false],
    ["/api/other", false],
    ["/about", false],
  ])("isProtectedPath('%s') === %s", (pathname, expected) => {
    expect(isProtectedPath(pathname)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// middleware 関数のテスト
// ---------------------------------------------------------------------------

describe("middleware", () => {
  let middleware: (req: NextRequest) => Promise<NextResponse>;

  beforeAll(async () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
    const mod = await import("@/middleware");
    middleware = mod.middleware;
  });

  beforeEach(() => {
    mockGetUser.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 未ログイン + 保護パス → /login へリダイレクト
  // -------------------------------------------------------------------------
  describe("未ログイン + 保護パス", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    });

    it.each(["/chat", "/chat/new", "/api/chat", "/api/chat/foo", "/api/sessions", "/api/sessions/abc"])(
      "%s → /login にリダイレクトされること",
      async (pathname) => {
        const req = makeRequest(pathname);
        const res = await middleware(req);

        expect(res.status).toBe(307);
        expect(getRedirectPathname(res)).toBe("/login");
      }
    );
  });

  // -------------------------------------------------------------------------
  // 2. 未ログイン + 非保護パス（/login）→ リダイレクトせず response を返す
  // -------------------------------------------------------------------------
  describe("未ログイン + 非保護パス", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    });

    it("/login → リダイレクトせず supabaseMiddleware の response を返すこと", async () => {
      const req = makeRequest("/login");
      const res = await middleware(req);

      // リダイレクト (3xx) ではなく 200 が返ること
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. ログイン済み + /login → /chat へリダイレクト
  // -------------------------------------------------------------------------
  describe("ログイン済み + /login", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });
    });

    it("/login → /chat にリダイレクトされること", async () => {
      const req = makeRequest("/login");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");
    });
  });

  // -------------------------------------------------------------------------
  // 4. ログイン済み + 保護パス → リダイレクトせず response を返す
  // -------------------------------------------------------------------------
  describe("ログイン済み + 保護パス", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });
    });

    it.each(["/chat", "/chat/new", "/api/chat", "/api/sessions"])(
      "%s → リダイレクトせず response を返すこと",
      async (pathname) => {
        const req = makeRequest(pathname);
        const res = await middleware(req);

        expect(res.headers.get("location")).toBeNull();
      }
    );
  });

  // -------------------------------------------------------------------------
  // 5. getUser が throw → console.error が呼ばれ /login へリダイレクト
  // -------------------------------------------------------------------------
  describe("getUser が例外を throw", () => {
    it("console.error が呼ばれ /login にリダイレクトされること", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      mockGetUser.mockRejectedValue(new Error("network error"));

      const req = makeRequest("/chat");
      const res = await middleware(req);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[middleware] supabase auth error",
        expect.any(Error)
      );
      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/login");

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // 6. リダイレクト時の Cookie 転写
  //    supabaseMiddleware の response に Cookie が設定されている場合、
  //    リダイレクトレスポンスにも同じ Cookie が転写されること。
  // -------------------------------------------------------------------------
  describe("リダイレクト時の Cookie 転写", () => {
    it("未ログイン保護パスへのリダイレクト時に supabase Cookie が転写されること", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // supabaseMiddleware が response に Cookie を書き込む動作を再現するため、
      // createServerClient のモックで setAll が呼ばれたときに response に Cookie をセットする。
      // @supabase/ssr の createServerClient モックを上書きして Cookie 書き込みを模倣する。
      const { createServerClient } = jest.requireMock("@supabase/ssr") as {
        createServerClient: jest.Mock;
      };

      createServerClient.mockImplementationOnce(
        (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options?: object }>) => void } }) => {
          // コンストラクト時に Cookie をセット（トークンリフレッシュを模倣）
          options.cookies.setAll([
            { name: "sb-access-token", value: "refreshed-token-abc", options: { path: "/", httpOnly: true } },
            { name: "sb-refresh-token", value: "refresh-token-xyz", options: { path: "/", httpOnly: true } },
          ]);
          return { auth: { getUser: mockGetUser } };
        }
      );

      const req = makeRequest("/chat");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/login");

      // リダイレクトレスポンスに Cookie が転写されていること
      const setCookieHeader = res.headers.get("set-cookie");
      expect(setCookieHeader).not.toBeNull();
      expect(setCookieHeader).toContain("sb-access-token=refreshed-token-abc");
      expect(setCookieHeader).toContain("sb-refresh-token=refresh-token-xyz");
    });

    it("ログイン済みで /login → /chat リダイレクト時に supabase Cookie が転写されること", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });

      const { createServerClient } = jest.requireMock("@supabase/ssr") as {
        createServerClient: jest.Mock;
      };

      createServerClient.mockImplementationOnce(
        (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options?: object }>) => void } }) => {
          options.cookies.setAll([
            { name: "sb-access-token", value: "new-access-token", options: { path: "/" } },
          ]);
          return { auth: { getUser: mockGetUser } };
        }
      );

      const req = makeRequest("/login");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/chat");

      const setCookieHeader = res.headers.get("set-cookie");
      expect(setCookieHeader).not.toBeNull();
      expect(setCookieHeader).toContain("sb-access-token=new-access-token");
    });

    it("getUser throw 時のリダイレクトでも Cookie が転写されること", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      mockGetUser.mockRejectedValue(new Error("auth error"));

      const { createServerClient } = jest.requireMock("@supabase/ssr") as {
        createServerClient: jest.Mock;
      };

      createServerClient.mockImplementationOnce(
        (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options?: object }>) => void } }) => {
          options.cookies.setAll([
            { name: "sb-access-token", value: "partial-token", options: { path: "/" } },
          ]);
          return { auth: { getUser: mockGetUser } };
        }
      );

      const req = makeRequest("/chat");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(getRedirectPathname(res)).toBe("/login");

      const setCookieHeader = res.headers.get("set-cookie");
      expect(setCookieHeader).not.toBeNull();
      expect(setCookieHeader).toContain("sb-access-token=partial-token");

      jest.restoreAllMocks();
    });
  });
});
