/**
 * @jest-environment jsdom
 *
 * GoogleLoginButton コンポーネントの単体テスト。
 *
 * モック戦略:
 * - @/lib/db/supabase-browser: supabaseBrowser() を jest.mock でモック。
 *   signInWithOAuth の戻り値をテストケースごとに差し替える。
 * - window.location.origin: jsdom のデフォルト origin は 'http://localhost'。
 *   redirectTo の検証に使用する。
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// モック定義
// ---------------------------------------------------------------------------

const mockSignInWithOAuth = jest.fn();

jest.mock("@/lib/db/supabase-browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}));

// ---------------------------------------------------------------------------
// テスト対象のインポート（モック設定後に import）
// ---------------------------------------------------------------------------

import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function renderGoogleLoginButton() {
  return render(<GoogleLoginButton />);
}

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("GoogleLoginButton", () => {
  beforeEach(() => {
    mockSignInWithOAuth.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 初期レンダリング
  // -------------------------------------------------------------------------
  describe("初期レンダリング", () => {
    it("ボタンが表示される", () => {
      renderGoogleLoginButton();
      expect(screen.getByRole("button", { name: /Googleでログイン/i })).toBeInTheDocument();
    });

    it("Google アイコン（SVG）が表示される", () => {
      renderGoogleLoginButton();
      // SVG は aria-hidden なので DOM に存在することだけ確認する
      const button = screen.getByRole("button", { name: /Googleでログイン/i });
      const svg = button.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    it("初期状態ではエラーメッセージが表示されない", () => {
      renderGoogleLoginButton();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("初期状態ではボタンが disabled でない", () => {
      renderGoogleLoginButton();
      expect(screen.getByRole("button", { name: /Googleでログイン/i })).not.toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. クリック成功
  // -------------------------------------------------------------------------
  describe("クリック成功", () => {
    it("signInWithOAuth が provider: 'google' と正しい redirectTo で呼ばれる", async () => {
      const user = userEvent.setup();
      mockSignInWithOAuth.mockResolvedValue({ error: null });
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      await waitFor(() => {
        expect(mockSignInWithOAuth).toHaveBeenCalledWith({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=/chat`,
          },
        });
      });
    });

    it("redirectTo は window.location.origin を使用している", async () => {
      const user = userEvent.setup();
      mockSignInWithOAuth.mockResolvedValue({ error: null });
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      await waitFor(() => {
        const callArgs = mockSignInWithOAuth.mock.calls[0][0];
        expect(callArgs.options.redirectTo).toBe(
          "http://localhost/auth/callback?next=/chat"
        );
      });
    });

    it("成功時（OAuth リダイレクト待ち）はボタンが disabled のまま", async () => {
      const user = userEvent.setup();
      // 成功時は Google のページにリダイレクトされるため isLoading は true のまま
      let resolveOAuth!: (value: { error: null }) => void;
      const pendingPromise = new Promise<{ error: null }>((resolve) => {
        resolveOAuth = resolve;
      });
      mockSignInWithOAuth.mockReturnValue(pendingPromise);
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /リダイレクト中.../i })).toBeDisabled();
      });

      // クリーンアップ
      resolveOAuth({ error: null });
    });
  });

  // -------------------------------------------------------------------------
  // 3. クリックエラー（authError 返却）
  // -------------------------------------------------------------------------
  describe("クリックエラー（authError 返却）", () => {
    it("エラーメッセージが表示され isLoading が false に戻る", async () => {
      const user = userEvent.setup();
      mockSignInWithOAuth.mockResolvedValue({
        error: { message: "OAuth error" },
      });
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Googleログインに失敗しました。しばらく経ってから再度お試しください。"
      );
      // isLoading が false に戻りボタンが再度有効になっていること
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Googleでログイン/i })).not.toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 4. ネットワークエラー（throw）
  // -------------------------------------------------------------------------
  describe("ネットワークエラー（throw）", () => {
    it("エラーメッセージが表示され isLoading が false に戻る", async () => {
      const user = userEvent.setup();
      mockSignInWithOAuth.mockRejectedValue(new Error("Network error"));
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Googleログインに失敗しました。しばらく経ってから再度お試しください。"
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Googleでログイン/i })).not.toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. ローディング中
  // -------------------------------------------------------------------------
  describe("ローディング中", () => {
    it("クリック後はボタンが disabled で 'リダイレクト中...' と表示される", async () => {
      const user = userEvent.setup();

      let resolveOAuth!: (value: { error: null }) => void;
      const pendingPromise = new Promise<{ error: null }>((resolve) => {
        resolveOAuth = resolve;
      });
      mockSignInWithOAuth.mockReturnValue(pendingPromise);
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      await waitFor(() => {
        const btn = screen.getByRole("button", { name: /リダイレクト中.../i });
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute("aria-busy", "true");
      });

      // クリーンアップ
      resolveOAuth({ error: null });
    });

    it("ローディング中は Google アイコンが非表示になる", async () => {
      const user = userEvent.setup();

      let resolveOAuth!: (value: { error: null }) => void;
      const pendingPromise = new Promise<{ error: null }>((resolve) => {
        resolveOAuth = resolve;
      });
      mockSignInWithOAuth.mockReturnValue(pendingPromise);
      renderGoogleLoginButton();

      await user.click(screen.getByRole("button", { name: /Googleでログイン/i }));

      await waitFor(() => {
        const button = screen.getByRole("button", { name: /リダイレクト中.../i });
        const svg = button.querySelector("svg");
        // ローディング中は SVG が非表示（条件付きレンダリング）
        expect(svg).not.toBeInTheDocument();
      });

      // クリーンアップ
      resolveOAuth({ error: null });
    });
  });
});
