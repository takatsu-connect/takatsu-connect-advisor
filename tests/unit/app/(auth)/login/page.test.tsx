/**
 * @jest-environment jsdom
 *
 * login/page.tsx の単体テスト（Server Component）。
 *
 * login/page.tsx は同期 Server Component（async でない）なので、
 * React Testing Library の render で直接テストできる。
 *
 * モック戦略:
 * - LoginForm / GoogleLoginButton: 実際のコンポーネントは別テストで検証済みのため、
 *   軽量なモックコンポーネントに差し替えてページ構造だけを検証する。
 * - metadata エクスポート: モジュールの名前付きエクスポートとして直接確認する。
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// モック定義（子コンポーネントはスタブ化）
// ---------------------------------------------------------------------------

jest.mock("@/components/auth/LoginForm", () => ({
  LoginForm: () => <div data-testid="login-form" />,
}));

jest.mock("@/components/auth/GoogleLoginButton", () => ({
  GoogleLoginButton: () => <div data-testid="google-login-button" />,
}));

// ---------------------------------------------------------------------------
// テスト対象のインポート
// ---------------------------------------------------------------------------

import LoginPage, { metadata } from "@/app/(auth)/login/page";

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  // -------------------------------------------------------------------------
  // 1. LoginForm と GoogleLoginButton が存在する
  // -------------------------------------------------------------------------
  describe("コンポーネント配置", () => {
    it("LoginForm が表示される", () => {
      render(<LoginPage />);
      expect(screen.getByTestId("login-form")).toBeInTheDocument();
    });

    it("GoogleLoginButton が表示される", () => {
      render(<LoginPage />);
      expect(screen.getByTestId("google-login-button")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 2. メタデータ（metadata エクスポート）
  // -------------------------------------------------------------------------
  describe("メタデータ", () => {
    it("metadata.title が設定されている", () => {
      expect(metadata).toBeDefined();
      expect(metadata.title).toBeTruthy();
    });

    it("metadata.title に 'ログイン' が含まれる", () => {
      const title = metadata.title as string;
      expect(title).toContain("ログイン");
    });

    it("metadata.description が設定されている", () => {
      expect(metadata.description).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 3. 招待制の説明文
  // -------------------------------------------------------------------------
  describe("招待制の説明文", () => {
    it("招待制を示す説明文が表示される", () => {
      render(<LoginPage />);
      expect(screen.getByText(/招待/)).toBeInTheDocument();
    });

    it("運営メンバー専用であることを示すテキストが表示される", () => {
      render(<LoginPage />);
      expect(screen.getByText(/運営メンバー/)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. ページ構造
  // -------------------------------------------------------------------------
  describe("ページ構造", () => {
    it("main 要素が存在する", () => {
      render(<LoginPage />);
      expect(screen.getByRole("main")).toBeInTheDocument();
    });

    it("見出し（h1）が表示される", () => {
      render(<LoginPage />);
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
  });
});
