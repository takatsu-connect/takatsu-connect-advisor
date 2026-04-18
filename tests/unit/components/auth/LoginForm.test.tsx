/**
 * @jest-environment jsdom
 *
 * LoginForm コンポーネントの単体テスト。
 *
 * モック戦略:
 * - @/lib/db/supabase-browser: supabaseBrowser() を jest.mock でモック。
 *   signInWithPassword の戻り値をテストケースごとに差し替える。
 * - next/navigation: useRouter を jest.mock でモック。
 *   router.push の呼び出しを検証する。
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// モック定義
// ---------------------------------------------------------------------------

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
}));

const mockSignInWithPassword = jest.fn();

jest.mock("@/lib/db/supabase-browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  }),
}));

// CSS Modules のモック（jsdom では CSS を解析できないため）
jest.mock("./LoginForm.module.css", () => ({}), { virtual: true });

// ---------------------------------------------------------------------------
// テスト対象のインポート（モック設定後に import）
// ---------------------------------------------------------------------------

import { LoginForm } from "@/components/auth/LoginForm";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function renderLoginForm() {
  return render(<LoginForm />);
}

// ---------------------------------------------------------------------------
// テストスイート
// ---------------------------------------------------------------------------

describe("LoginForm", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSignInWithPassword.mockReset();
  });

  // -------------------------------------------------------------------------
  // 1. 初期レンダリング
  // -------------------------------------------------------------------------
  describe("初期レンダリング", () => {
    it("Email フィールド、Password フィールド、submit ボタン、各 label が表示される", () => {
      renderLoginForm();

      expect(screen.getByLabelText("メールアドレス")).toBeInTheDocument();
      expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument();
      expect(screen.getByText("メールアドレス")).toBeInTheDocument();
      expect(screen.getByText("パスワード")).toBeInTheDocument();
    });

    it("初期状態ではエラーメッセージが表示されない", () => {
      renderLoginForm();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("初期状態では入力フィールドが disabled でない", () => {
      renderLoginForm();
      expect(screen.getByLabelText("メールアドレス")).not.toBeDisabled();
      expect(screen.getByLabelText("パスワード")).not.toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. バリデーション
  // -------------------------------------------------------------------------
  describe("バリデーション", () => {
    it("Email 未入力で submit → 'メールアドレスを入力してください。' が表示される", async () => {
      const user = userEvent.setup();
      renderLoginForm();

      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "メールアドレスを入力してください。"
      );
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it("不正 Email 形式で submit → '有効なメールアドレスを入力してください。' が表示される", async () => {
      const user = userEvent.setup();
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "invalid-email");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "有効なメールアドレスを入力してください。"
      );
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it("Password 未入力で submit → 'パスワードを入力してください。' が表示される", async () => {
      const user = userEvent.setup();
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "パスワードを入力してください。"
      );
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. 成功シナリオ
  // -------------------------------------------------------------------------
  describe("成功シナリオ", () => {
    it("Email/PW 入力 → submit → signInWithPassword が呼ばれ router.push('/chat') される", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({ error: null });
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "password123");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith({
          email: "test@example.com",
          password: "password123",
        });
        expect(mockPush).toHaveBeenCalledWith("/chat");
      });
    });

    it("Email の前後スペースはトリムされて signInWithPassword に渡される", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({ error: null });
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "  test@example.com  ");
      await user.type(screen.getByLabelText("パスワード"), "password123");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith({
          email: "test@example.com",
          password: "password123",
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // 4. 認証エラー: Invalid login credentials
  // -------------------------------------------------------------------------
  describe("認証エラー: Invalid login credentials", () => {
    it("'メールアドレスまたはパスワードが正しくありません。' が表示される", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        error: { message: "Invalid login credentials" },
      });
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "wrongpassword");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "メールアドレスまたはパスワードが正しくありません。"
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. 認証エラー: Email not confirmed
  // -------------------------------------------------------------------------
  describe("認証エラー: Email not confirmed", () => {
    it("招待メール確認メッセージが表示される", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        error: { message: "Email not confirmed" },
      });
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "password123");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "メールアドレスの確認が完了していません。招待メールをご確認ください。"
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. 認証エラー（その他）
  // -------------------------------------------------------------------------
  describe("認証エラー（その他）", () => {
    it("汎用エラーメッセージが表示される", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockResolvedValue({
        error: { message: "Some other error" },
      });
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "password123");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ログインに失敗しました。しばらく経ってから再度お試しください。"
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 7. ネットワークエラー（throw）
  // -------------------------------------------------------------------------
  describe("ネットワークエラー（throw）", () => {
    it("汎用エラーメッセージが表示され、isLoading が false に戻る", async () => {
      const user = userEvent.setup();
      mockSignInWithPassword.mockRejectedValue(new Error("Network error"));
      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "password123");
      await user.click(screen.getByRole("button", { name: "ログイン" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ログインに失敗しました。しばらく経ってから再度お試しください。"
      );
      // isLoading が false に戻りボタンが再度有効になっていること
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "ログイン" })).not.toBeDisabled();
      });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 8. ローディング中
  // -------------------------------------------------------------------------
  describe("ローディング中", () => {
    it("submit 中はボタンが disabled で 'ログイン中...' と表示され、入力フィールドも disabled", async () => {
      const user = userEvent.setup();

      // 解決を手動でコントロールする Promise を使い、ローディング状態を保持
      let resolveSignIn!: (value: { error: null }) => void;
      const pendingPromise = new Promise<{ error: null }>((resolve) => {
        resolveSignIn = resolve;
      });
      mockSignInWithPassword.mockReturnValue(pendingPromise);

      renderLoginForm();

      await user.type(screen.getByLabelText("メールアドレス"), "test@example.com");
      await user.type(screen.getByLabelText("パスワード"), "password123");

      // submit をトリガーしてローディング状態に入る
      const submitButton = screen.getByRole("button", { name: "ログイン" });
      await user.click(submitButton);

      // ローディング中の状態を検証
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "ログイン中..." })).toBeDisabled();
        expect(screen.getByLabelText("メールアドレス")).toBeDisabled();
        expect(screen.getByLabelText("パスワード")).toBeDisabled();
      });

      // Promise を解決してクリーンアップ
      resolveSignIn({ error: null });
    });
  });

  // -------------------------------------------------------------------------
  // 9. アクセシビリティ
  // -------------------------------------------------------------------------
  describe("アクセシビリティ", () => {
    it("エラーは role='alert' で表示される", async () => {
      const user = userEvent.setup();
      renderLoginForm();

      await user.click(screen.getByRole("button", { name: "ログイン" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toBeInTheDocument();
    });

    it("label の htmlFor と input の id が正しく関連付けられている", () => {
      renderLoginForm();

      // getByLabelText は htmlFor/id の関連付けが正しくないと要素を取得できない
      expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("id", "email");
      expect(screen.getByLabelText("パスワード")).toHaveAttribute("id", "password");
    });
  });
});
