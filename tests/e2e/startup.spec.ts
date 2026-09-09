import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function startGame(page: Page): Promise<void> {
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
}

async function playerPosition(page: Page): Promise<{ x: number; y: number }> {
  const transform = await page.locator("g.player").getAttribute("transform");
  const match = transform?.match(/translate\(([-\d.]+),([-\d.]+)\)/);
  if (!match) throw new Error(`Unexpected player transform: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test("starts a crawl and renders a playable floor", async ({ page }) => {
  await startGame(page);
  await expect(page.locator("#gameViewport")).toHaveCSS("cursor", "crosshair");
});

test("moves continuously with WASD and arrow keys", async ({ page }) => {
  await startGame(page);

  const start = await playerPosition(page);
  await page.keyboard.down("d");
  await page.waitForTimeout(120);
  const first = await playerPosition(page);
  await page.waitForTimeout(120);
  const second = await playerPosition(page);
  await page.keyboard.up("d");

  expect(first.x).toBeGreaterThan(start.x + 5);
  expect(second.x).toBeGreaterThan(first.x + 5);

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(120);
  await page.keyboard.up("ArrowLeft");
  const afterArrow = await playerPosition(page);
  expect(afterArrow.x).toBeLessThan(second.x - 5);
});

test("aims with the cursor and repeatedly fires while moving backward", async ({ page }) => {
  await startGame(page);

  const viewport = page.locator("#gameViewport");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Game viewport has no bounds");
  const aimX = bounds.x + bounds.width * 0.78;
  const aimY = bounds.y + bounds.height * 0.3;
  await page.mouse.move(aimX, aimY);
  await expect(page.locator("g.player .avatar")).toHaveAttribute("href", /assets\/player_frames\/east\//);

  await page.keyboard.press("Space");
  await expect(page.locator("#statShots")).toHaveText("0");

  const start = await playerPosition(page);
  await page.keyboard.down("a");
  await page.mouse.down();
  await expect.poll(async () => Number(await page.locator("#statShots").textContent())).toBeGreaterThanOrEqual(2);

  const moving = await playerPosition(page);
  expect(moving.x).toBeLessThan(start.x - 20);
  await expect(page.locator("g.player .avatar")).toHaveAttribute("href", /assets\/player_frames\/east\//);

  const bullet = page.locator("circle.bullet").last();
  await expect(bullet).toBeAttached();
  const bulletX = Number(await bullet.getAttribute("cx"));
  const bulletY = Number(await bullet.getAttribute("cy"));
  expect(bulletX).toBeGreaterThan(moving.x);
  expect(bulletY).toBeLessThan(moving.y);

  await page.mouse.up();
  await page.keyboard.up("a");
  const shotsAfterRelease = await page.locator("#statShots").textContent();
  await page.waitForTimeout(300);
  await expect(page.locator("#statShots")).toHaveText(shotsAfterRelease ?? "");
});

test("does not pan or zoom the game viewport", async ({ page }) => {
  await startGame(page);

  const viewport = page.locator("#gameViewport");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Game viewport has no bounds");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const rootLayer = page.locator("#map > g");
  const initialTransform = await rootLayer.getAttribute("transform");

  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -500);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centerX + 80, centerY + 50);
  await page.mouse.up({ button: "middle" });

  await expect(rootLayer).toHaveAttribute("transform", initialTransform ?? "");
});

test("spawns multiple enemies once another room is revealed", async ({ page }) => {
  await startGame(page);

  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await page.locator("g.monster").count())).toBeGreaterThanOrEqual(2);
  await page.keyboard.up("ArrowUp");
});
