/**
 * @jest-environment node
 *
 * (main)/layout.tsx の単体テスト（async Server Component）。
 *
 * モック戦略:
 * - @/lib/db/supabase-server: supabaseServer() を jest.mock でモック。
 *   auth.getUser の戻り値をテストケースごとに差し替える。
 * - next/navigation の redirect: jest.mock でモック。
 *   Next.js の redirect() は内部的に NEXT_REDIRECT error を throw するため、
 *   同様に throw するモックを使用。呼び出しの検証は mockRedirect で行う。
 * - server-only: Server Component がインポートする "server-only" モジュールをスタブ化。
 * - next/headers: cookies() を返すモック。supabase-server の内部で使用される。
 * - @/contexts/UserContext: UserContextProvider を jest.fn() でモックし、
 *   渡された props を jest.Mock の呼び出し引数から検証する。
 *
 * Server Component テスト戦略:
 * MainLayout は async function を default export するため、
 * await MainLayout({ children: ... }) として直接呼び出す。
 * 戻り値は React.createElement の結果（ReactElement）であり、
 * JSX のプロパティを直接検査して props を検証する。
 * redirect() が throw するため、未ログイン時のテストは try-catch で捕捉して検証する。
 */

// ---------------------------------------------------------------------------
// モック定義
// ---------------------------------------------------------------------------

// Next.js の redirect() は内部的に NEXT_REDIRECT エラーを throw する。
// テストでも同様の動作にするため、呼び出し時に throw させる。
class NextRedirectError extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT: ${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

/** NEXT_REDIRECT エラーかどうか判定する */
function isNextRedirectError(e: unknown): e is NextRedirectError {
  return e instanceof Error && e.message.startsWith("NEXT_REDIRECT:");
}

const mockRedirect = jest.fn();

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new NextRedirectError(args[0] as string);
  },
}));

const mockGetUser = jest.fn();

jest.mock("@/lib/db/supabase-server", () => ({
  supabaseServer: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
      },
    })
  ),
}));

// server-only モジュールは node 環境でインポートエラーになるためスタブ化
jest.mock("server-only", () => ({}));

// next/headers の cookies() をスタブ化（supabase-server が内部で使用）
jest.mock("next/headers", () => ({
  cookies: jest.fn(() =>
    Promise.resolve({
      getAll: () => [],
      set: jest.fn(),
    })
  ),
}));

// UserContextProvider を jest.fn() でモック。
// 戻り値は children をそのまま返す（node 環境でのレンダリングを模倣）。
const mockUserContextProvider = jest.fn(({ children }: { children: unknown }) => children);

jest.mock("@/contexts/UserContext", () => ({
  UserContextProvider: (props: { value: unknown; children: unknown }) =>
    mockUserContextProvider(props),
}));

// ---------------------------------------------------------------------------
// テスト対象のインポート
// ---------------------------------------------------------------------------

import MainLayout from "@/app/(main)/layout";
import React from "react";

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("MainLayout", () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockGetUser.mockReset();
    mockUserContextProvider.mockClear();
  });

  // -------------------------------------------------------------------------
  // 1. 未ログイン時: redirect('/login') が呼ばれる
  // -------------------------------------------------------------------------
  describe("未ログイン時（user が null）", () => {
    it("redirect('/login') が呼ばれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const children = React.createElement("div", { "data-testid": "child-content" }, "children");

      try {
        await MainLayout({ children });
      } catch (e) {
        if (!isNextRedirectError(e)) throw e;
      }

      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("redirect('/login') は1回だけ呼ばれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const children = React.createElement("div", null, "children");

      try {
        await MainLayout({ children });
      } catch (e) {
        if (!isNextRedirectError(e)) throw e;
      }

      expect(mockRedirect).toHaveBeenCalledTimes(1);
    });

    it("UserContextProvider が呼ばれない", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const children = React.createElement("div", null, "children");

      try {
        await MainLayout({ children });
      } catch (e) {
        if (!isNextRedirectError(e)) throw e;
      }

      // redirect が throw した後は JSX に到達しないため、
      // UserContextProvider は呼ばれないこと
      expect(mockUserContextProvider).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. ログイン済み時: UserContextProvider が user 情報を受け取って children をレンダリング
  // -------------------------------------------------------------------------
  describe("ログイン済み時", () => {
    const testUser = { id: "user-id-123", email: "test@example.com" };

    it("redirect が呼ばれない", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: testUser },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      await MainLayout({ children });

      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("戻り値の JSX の type が UserContextProvider のモックである", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: testUser },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      const result = await MainLayout({ children });

      // 戻り値は UserContextProvider をルートとする JSX 要素
      expect(result).not.toBeNull();
      expect((result as React.ReactElement).type).toBeDefined();
    });

    it("戻り値の JSX の props.value に user.id と user.email が含まれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: testUser },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      const result = await MainLayout({ children });

      // React.createElement の第2引数（props）を検査
      const element = result as React.ReactElement<{ value: { id: string; email: string } }>;
      expect(element.props.value).toEqual({
        id: "user-id-123",
        email: "test@example.com",
      });
    });

    it("email が undefined の場合は空文字列が props.value.email に設定される", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-456", email: undefined } },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      const result = await MainLayout({ children });

      const element = result as React.ReactElement<{ value: { id: string; email: string } }>;
      expect(element.props.value).toEqual({
        id: "user-id-456",
        email: "",
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. getUser がエラーを返した場合 → 未認証扱いで redirect('/login') が呼ばれる
  // -------------------------------------------------------------------------
  describe("getUser がエラーを返す場合（未認証扱い）", () => {
    it("error が存在し user が null のとき redirect('/login') が呼ばれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Auth error" },
      });

      const children = React.createElement("div", null, "children");

      try {
        await MainLayout({ children });
      } catch (e) {
        if (!isNextRedirectError(e)) throw e;
      }

      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("error が存在し user が null のとき UserContextProvider は呼ばれない", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: "JWT expired" },
      });

      const children = React.createElement("div", null, "children");

      try {
        await MainLayout({ children });
      } catch (e) {
        if (!isNextRedirectError(e)) throw e;
      }

      expect(mockUserContextProvider).not.toHaveBeenCalled();
    });
  });
});
