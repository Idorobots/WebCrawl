import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

test("starts a crawl and renders a playable floor", async () => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  const electronApp = await electron.launch({
    args: [path.resolve("tests/e2e/electron-main.cjs")],
    env: {
      ...process.env,
      WEBCRAWL_TEST_URL: "http://127.0.0.1:3000",
    },
  });

  try {
    const page = await electronApp.firstWindow();
    await page.route("**/api/fetch?**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: fixture,
    }));

    await expect(page.locator("#welcomeScreen")).toBeVisible();
    await page.locator("#welcomeUrlInput").fill("https://example.com/start");
    await page.getByRole("button", { name: "BEGIN CRAWL" }).click();

    await expect(page.locator("#gameUi")).toBeVisible();
    await expect(page.locator("g.room")).toHaveCount(6);
    await expect(page.locator("#statRooms")).toContainText("1 / 100");
    await page.keyboard.press("Space");
    await expect(page.locator("#statShots")).toHaveText("1");
  } finally {
    await electronApp.close();
  }
});
