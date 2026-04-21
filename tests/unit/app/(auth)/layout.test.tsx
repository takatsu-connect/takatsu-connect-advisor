/**
 * @jest-environment node
 *
 * (auth)/layout.tsx の単体テスト（async Server Component）。
 *
 * モック戦略:
 * - @/lib/db/supabase-server: supabaseServer() を jest.mock でモック。
 *   auth.getUser の戻り値をテストケースごとに差し替える。
 * - next/navigation の redirect: jest.mock でモック。
 *   Next.js の redirect() は内部的に NEXT_REDIRECT error を throw するが、
 *   モック化することで throw を抑制しつつ呼び出しを検証する。
 * - server-only: Server Component がインポートする "server-only" モジュールをスタブ化。
 * - next/headers: cookies() を返すモック。supabase-server の内部で使用される。
 *
 * Server Component テスト戦略:
 * AuthLayout は async function を default export するため、
 * await AuthLayout({ children: ... }) として直接呼び出してレンダリングする。
 * React Testing Library の render は node 環境では使用しないため、
 * JSX 文字列の検証を行う場合は renderToStaticMarkup を使用する。
 * ただし redirect のテストはレンダリング前に throw/呼び出しが発生するため、
 * await の例外またはモック呼び出しの有無で検証する。
 */

// ---------------------------------------------------------------------------
// モック定義
// ---------------------------------------------------------------------------

const mockRedirect = jest.fn();

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

const mockGetUser = jest.fn();

jest.mock("@/lib/db/supabase-server", () => ({
  supabaseServer: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
      },
    }),
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
    }),
  ),
}));

// ---------------------------------------------------------------------------
// テスト対象のインポート
// ---------------------------------------------------------------------------

import AuthLayout from "@/app/(auth)/layout";
import React from "react";

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("AuthLayout", () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockGetUser.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 未ログイン時: children がレンダリングされる
  // -------------------------------------------------------------------------
  describe("未ログイン時", () => {
    it("children がレンダリングされる（redirect が呼ばれない）", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const children = React.createElement("div", { "data-testid": "child-content" }, "children");
      // redirect がモックされているため throw しない
      // AuthLayout は JSX Element を返す
      const result = await AuthLayout({ children });

      // redirect が呼ばれていないことを確認
      expect(mockRedirect).not.toHaveBeenCalled();
      // 戻り値が存在すること（children を含む JSX）
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 2. ログイン済み: redirect("/chat") が呼ばれる
  // -------------------------------------------------------------------------
  describe("ログイン済み", () => {
    it("redirect('/chat') が呼ばれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      await AuthLayout({ children });

      expect(mockRedirect).toHaveBeenCalledWith("/chat");
    });

    it("redirect('/chat') は1回だけ呼ばれる", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-id-123", email: "test@example.com" } },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      await AuthLayout({ children });

      expect(mockRedirect).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. getUser が null user を返す場合（ログアウト状態）
  // -------------------------------------------------------------------------
  describe("getUser が null を返す場合", () => {
    it("user が null のとき redirect が呼ばれない", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const children = React.createElement("div", null, "children");
      await AuthLayout({ children });

      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. getUser がエラーを返す場合（認証エラー）
  // -------------------------------------------------------------------------
  describe("getUser がエラーを返す場合", () => {
    it("error が存在し user が null のとき redirect が呼ばれない", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Auth error" },
      });

      const children = React.createElement("div", null, "children");
      await AuthLayout({ children });

      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
