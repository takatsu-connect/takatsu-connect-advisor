/**
 * @jest-environment jsdom
 *
 * UserContext.tsx の単体テスト（React Testing Library）。
 *
 * テスト対象:
 * - UserContextProvider: value を children に提供するプロバイダー
 * - useUser: UserContext からユーザー情報を取得するフック
 *
 * テスト戦略:
 * - UserContextProvider で囲んだコンポーネント内で useUser() を呼ぶと
 *   渡した user 情報が取得できることを検証する。
 * - UserContextProvider の外で useUser() を呼ぶと Error が throw されることを検証する。
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { UserContextProvider, useUser } from "@/contexts/UserContext";
import type { UserInfo } from "@/contexts/UserContext";

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("UserContext", () => {
  // -------------------------------------------------------------------------
  // 1. UserContextProvider
  // -------------------------------------------------------------------------
  describe("UserContextProvider", () => {
    it("value で渡した user 情報を children に提供する", () => {
      const testUser: UserInfo = { id: "user-id-123", email: "test@example.com" };

      // useUser を呼ぶ Consumer コンポーネント
      function Consumer() {
        const user = useUser();
        return (
          <div>
            <span data-testid="user-id">{user.id}</span>
            <span data-testid="user-email">{user.email}</span>
          </div>
        );
      }

      render(
        <UserContextProvider value={testUser}>
          <Consumer />
        </UserContextProvider>
      );

      expect(screen.getByTestId("user-id")).toHaveTextContent("user-id-123");
      expect(screen.getByTestId("user-email")).toHaveTextContent("test@example.com");
    });

    it("複数の children が渡されても正常にレンダリングされる", () => {
      const testUser: UserInfo = { id: "user-id-456", email: "another@example.com" };

      function Consumer() {
        const user = useUser();
        return <span data-testid="email">{user.email}</span>;
      }

      render(
        <UserContextProvider value={testUser}>
          <div data-testid="wrapper">
            <Consumer />
            <p>追加の children</p>
          </div>
        </UserContextProvider>
      );

      expect(screen.getByTestId("email")).toHaveTextContent("another@example.com");
      expect(screen.getByText("追加の children")).toBeInTheDocument();
    });

    it("email が空文字列でも正常に提供される", () => {
      const testUser: UserInfo = { id: "user-id-789", email: "" };

      function Consumer() {
        const user = useUser();
        return <span data-testid="user-id">{user.id}</span>;
      }

      render(
        <UserContextProvider value={testUser}>
          <Consumer />
        </UserContextProvider>
      );

      expect(screen.getByTestId("user-id")).toHaveTextContent("user-id-789");
    });
  });

  // -------------------------------------------------------------------------
  // 2. useUser — Provider 内での正常系
  // -------------------------------------------------------------------------
  describe("useUser（Provider 内）", () => {
    it("UserContextProvider の value として渡した id が取得できる", () => {
      const testUser: UserInfo = { id: "hook-user-id", email: "hook@example.com" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UserContextProvider value={testUser}>{children}</UserContextProvider>
      );

      const { result } = renderHook(() => useUser(), { wrapper });

      expect(result.current.id).toBe("hook-user-id");
    });

    it("UserContextProvider の value として渡した email が取得できる", () => {
      const testUser: UserInfo = { id: "hook-user-id", email: "hook@example.com" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UserContextProvider value={testUser}>{children}</UserContextProvider>
      );

      const { result } = renderHook(() => useUser(), { wrapper });

      expect(result.current.email).toBe("hook@example.com");
    });

    it("返り値の型が UserInfo の形状を持つ", () => {
      const testUser: UserInfo = { id: "shape-check-id", email: "shape@example.com" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <UserContextProvider value={testUser}>{children}</UserContextProvider>
      );

      const { result } = renderHook(() => useUser(), { wrapper });

      expect(result.current).toEqual({ id: "shape-check-id", email: "shape@example.com" });
    });
  });

  // -------------------------------------------------------------------------
  // 3. useUser — Provider 外での異常系（Error throw）
  // -------------------------------------------------------------------------
  describe("useUser（Provider 外）", () => {
    // React の Error Boundary がコンソールにエラーを出力するのを抑制
    beforeEach(() => {
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("UserContextProvider の外で呼ぶと Error が throw される", () => {
      expect(() => {
        renderHook(() => useUser());
      }).toThrow("useUser は UserContextProvider の内部でのみ使用できます。");
    });

    it("throw される Error のメッセージが正しい", () => {
      let caughtError: Error | null = null;

      try {
        renderHook(() => useUser());
      } catch (e) {
        caughtError = e as Error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError?.message).toBe("useUser は UserContextProvider の内部でのみ使用できます。");
    });

    it("throw される Error は Error インスタンスである", () => {
      expect(() => {
        renderHook(() => useUser());
      }).toThrow(Error);
    });
  });
});
