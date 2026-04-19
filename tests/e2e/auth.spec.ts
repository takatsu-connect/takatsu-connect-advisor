import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasSupabase = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

const TEST_EMAIL = process.env.E2E_TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_TEST_USER_PASSWORD;
const hasCredentials = !!TEST_EMAIL && !!TEST_PASSWORD;

test.describe("認証フロー", () => {
  test.skip(
    !hasSupabase,
    "Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) are not set - skipping all E2E auth tests",
  );
  test.describe("未認証状態", () => {
    // ブラウザコンテキストをクリーンに保つ（既存ストレージ状態をリセット）
    test.use({ storageState: { cookies: [], origins: [] } });

    test("保護されたページ /chat にアクセスすると /login にリダイレクトされる", async ({
      page,
    }) => {
      await page.goto("/chat");

      // middleware が /login にリダイレクトすることを検証
      await expect(page).toHaveURL(/\/login/);
    });

    test("/login を直接開くとログインフォームが表示される", async ({ page }) => {
      await page.goto("/login");

      // URL が /login であることを確認
      await expect(page).toHaveURL(/\/login/);

      // メールアドレス入力フィールドが表示される
      await expect(page.locator("#email")).toBeVisible();

      // パスワード入力フィールドが表示される
      await expect(page.locator("#password")).toBeVisible();

      // ログインボタンが表示される
      await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();

      // Google ログインボタンが表示される
      await expect(page.getByRole("button", { name: /Googleでログイン/i })).toBeVisible();
    });

    test("未認証時に /login にアクセスしてもリダイレクトループが発生しない", async ({
      page,
    }) => {
      // ナビゲーション履歴を収集してループを検知する
      const visitedUrls: string[] = [];

      page.on("response", (response) => {
        // リダイレクトレスポンス (3xx) を記録
        if (response.status() >= 300 && response.status() < 400) {
          visitedUrls.push(response.url());
        }
      });

      await page.goto("/login");

      // /login で安定して停止していること
      await expect(page).toHaveURL(/\/login/);

      // リダイレクトが繰り返されていないこと（3回以上のリダイレクトはループと判定）
      expect(visitedUrls.length).toBeLessThan(3);

      // フォームが正常に表示されること（ループしていれば表示されない）
      await expect(page.locator("#email")).toBeVisible();
    });
  });

  test.describe("メール+PW ログイン", () => {
    test.skip(!hasCredentials, "E2E_TEST_USER_EMAIL/PASSWORD env vars not set");
    test.use({ storageState: { cookies: [], origins: [] } });

    test("正しい資格情報でログインすると /chat に遷移する", async ({ page }) => {
      await page.goto("/login");

      // メールアドレスを入力
      await page.locator("#email").fill(TEST_EMAIL as string);

      // パスワードを入力
      await page.locator("#password").fill(TEST_PASSWORD as string);

      // ログインボタンをクリック
      await page.getByRole("button", { name: "ログイン" }).click();

      // /chat へ遷移することを検証（Supabase の認証処理を待つため timeout を延長）
      await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
    });
  });

  test.describe("ログアウト", () => {
    test.skip(!hasCredentials, "E2E_TEST_USER_EMAIL/PASSWORD env vars not set");
    test.use({ storageState: { cookies: [], origins: [] } });

    test("ログイン後にサインアウトすると /login に遷移する", async ({ page }) => {
      // 先にメール+PW でログインする
      await page.goto("/login");
      await page.locator("#email").fill(TEST_EMAIL as string);
      await page.locator("#password").fill(TEST_PASSWORD as string);
      await page.getByRole("button", { name: "ログイン" }).click();

      // /chat への遷移を待つ
      await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });

      // POST /api/auth/signout を直接叩いてサインアウトする
      // （UI にサインアウトボタンが未実装のため API を直接呼び出す）
      const response = await page.request.post("/api/auth/signout");

      // 303 または最終的なリダイレクト先が /login であることを確認
      // page.request.post はリダイレクトをフォローするため、最終レスポンスの URL を検証
      expect(response.url()).toMatch(/\/login/);

      // ページを /chat に移動してアクセスが拒否され /login にリダイレクトされることも検証
      await page.goto("/chat");
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
