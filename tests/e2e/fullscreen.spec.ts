import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function isDocumentFullscreen(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => document.fullscreenElement === document.documentElement);
}

test("enters fullscreen when the game starts on mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#welcomeScreen")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("#welcomeUrlInput")).toBeVisible();

  await expect.poll(() => isDocumentFullscreen(page), { timeout: 5_000 }).toBe(false);

  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "text/html",
    body: fixture,
  }));
  await page.route("**/api/fetch?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fixture,
  }));

  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();

  await expect(page.locator("#gameCanvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => isDocumentFullscreen(page), { timeout: 5_000 }).toBe(true);
});
