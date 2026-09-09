import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("starts a crawl and renders a playable floor", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("**/api/fetch?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fixture,
  }));
  await page.goto("/");

  await expect(page.locator("#welcomeScreen")).toBeVisible();
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();

  await expect(page.locator("#gameUi")).toBeVisible();
  await expect(page.locator("g.room")).toHaveCount(6);
  await expect(page.locator("#statRooms")).toContainText("1 / 100");
  await page.keyboard.press("Space");
  await expect(page.locator("#statShots")).toHaveText("1");
});
