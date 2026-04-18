import { test, expect } from "@playwright/test";

test.describe("smoke test - app boots", () => {
  test("home page renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Takatsu Connect Advisor/i })).toBeVisible();
  });
});
