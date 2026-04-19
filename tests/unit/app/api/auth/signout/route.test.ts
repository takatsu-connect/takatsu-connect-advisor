/**
 * @jest-environment node
 *
 * src/app/api/auth/signout/route.ts の単体テスト（モックベース）。
 *
 * POST ハンドラのルーティングロジックと認証チェックを検証する。
 * @/lib/db/supabase-server をモックし、auth.getUser / auth.signOut の
 * 戻り値をテストケースごとに制御する。
 */

import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// @/lib/db/supabase-server モック
// supabaseServer() の戻り値として使う getUser / signOut のモック関数を
// テストケースごとに差し替えられるよう変数で保持する。
// ---------------------------------------------------------------------------

const mockGetUser = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@/lib/db/supabase-server", () => ({
  supabaseServer: jest.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

// ---------------------------------------------------------------------------
// テスト用ヘルパー
// ---------------------------------------------------------------------------

/** テスト用の NextRequest (POST) を生成する */
function makePostRequest(baseUrl = "http://localhost:3000") {
  return new NextRequest(new URL("/api/auth/signout", baseUrl), {
    method: "POST",
  });
}

/**
 * レスポンスのリダイレクト先 pathname を返す。
 */
function getRedirectPathname(res: Response): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).pathname;
}

// ---------------------------------------------------------------------------
// POST /api/auth/signout のテスト
// ---------------------------------------------------------------------------

describe("POST /api/auth/signout", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    jest.resetModules();
    const mod = await import("@/app/api/auth/signout/route");
    POST = mod.POST;
  });

  beforeEach(() => {
    mockGetUser.mockReset();
    mockSignOut.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 未認証（getUser が user: null を返す）→ 401、signOut は呼ばれない
  // -------------------------------------------------------------------------
  describe("未認証: getUser が user: null を返す", () => {
    it("401 Unauthorized を返し、signOut が呼ばれないこと", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const req = makePostRequest();
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body).toEqual({ error: "unauthorized" });
      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. getUser がエラーを返す → 401、signOut は呼ばれない
  // -------------------------------------------------------------------------
  describe("getUser がエラーを返す", () => {
    it("401 Unauthorized を返し、signOut が呼ばれないこと", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error("auth service unavailable"),
      });

      const req = makePostRequest();
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body).toEqual({ error: "unauthorized" });
      expect(mockSignOut).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. 認証済み & signOut 成功 → signOut が1回呼ばれ、303 で /login へリダイレクト
  // -------------------------------------------------------------------------
  describe("認証済み & signOut 成功", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });
      mockSignOut.mockResolvedValue({ error: null });
    });

    it("signOut が1回呼ばれること", async () => {
      const req = makePostRequest();
      await POST(req);

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it("303 ステータスで /login へリダイレクトされること", async () => {
      const req = makePostRequest();
      const res = await POST(req);

      expect(res.status).toBe(303);
      expect(getRedirectPathname(res)).toBe("/login");
    });
  });

  // -------------------------------------------------------------------------
  // 4. 認証済み & signOut が error を返す → 303 で /login へリダイレクト（UX優先）
  //    console.error が呼ばれること
  // -------------------------------------------------------------------------
  describe("認証済み & signOut がエラーを返す", () => {
    it("303 ステータスで /login へリダイレクトされ、console.error が呼ばれること", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });
      mockSignOut.mockResolvedValue({
        error: new Error("signOut service error"),
      });

      const req = makePostRequest();
      const res = await POST(req);

      expect(res.status).toBe(303);
      expect(getRedirectPathname(res)).toBe("/login");
      expect(consoleSpy).toHaveBeenCalledWith(
        "[auth/signout] signOut failed:",
        "signOut service error"
      );

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // 5. 認証済み & signOut が予期しない例外を throw → 303 で /login へリダイレクト
  //    console.error が呼ばれること
  // -------------------------------------------------------------------------
  describe("認証済み & signOut が予期しない例外を throw", () => {
    it("303 ステータスで /login へリダイレクトされ、console.error が呼ばれること", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });
      mockSignOut.mockRejectedValue(new Error("unexpected network failure"));

      const req = makePostRequest();
      const res = await POST(req);

      expect(res.status).toBe(303);
      expect(getRedirectPathname(res)).toBe("/login");
      expect(consoleSpy).toHaveBeenCalledWith(
        "[auth/signout] unexpected error:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // 6. GET メソッド未定義の確認
  //    route.ts は POST のみ export し、GET は export しないこと
  // -------------------------------------------------------------------------
  describe("エクスポート確認", () => {
    it("POST がエクスポートされていること", async () => {
      const mod = await import("@/app/api/auth/signout/route");
      expect(typeof mod.POST).toBe("function");
    });

    it("GET がエクスポートされていないこと", async () => {
      const mod = await import("@/app/api/auth/signout/route") as Record<string, unknown>;
      expect(mod.GET).toBeUndefined();
    });

    it("runtime が 'nodejs' に設定されていること", async () => {
      const mod = await import("@/app/api/auth/signout/route");
      expect(mod.runtime).toBe("nodejs");
    });
  });
});
