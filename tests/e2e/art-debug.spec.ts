import { expect, test } from "@playwright/test";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { world } from "../../src/client/config";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires a build with VITE_ART_DEBUG=true");
test.describe.configure({ timeout: 90_000 });

test("boots directly into the playable, authored art floor without fetching a page", async ({ page }) => {
  const fetches: string[] = [];
  await page.route("**/api/fetch?**", route => {
    fetches.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  const host = page.locator("#gameCanvas");
  await expect(page.locator("#welcomeScreen")).toBeHidden();
  await expect(page.locator("#loadingScreen")).toBeHidden();
  await expect(page.locator("#gameUi")).toBeVisible();
  await expect(host.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(host).toHaveAttribute("data-rooms", "13", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-active-monsters", "0");
  expect(fetches).toEqual([]);

  const { layout } = artDebugLevel();
  const enemyRoom = layout.nodes[1]!;
  await page.evaluate(({ x, y }) => {
    (window as Window & { __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void } })
      .__webcrawlTest?.teleportPlayerTo(x, y);
  }, { x: enemyRoom.x, y: enemyRoom.y + world(150) });
  await expect(host).toHaveAttribute("data-active-monsters", "1");

  const bossRoom = layout.nodes[8]!;
  await page.evaluate(({ x, y }) => {
    (window as Window & { __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void } })
      .__webcrawlTest?.teleportPlayerTo(x, y);
  }, { x: bossRoom.x, y: bossRoom.y + world(180) });
  await expect(host).toHaveAttribute("data-active-bosses", "1");
  await expect(page.locator("#bossHud")).toBeVisible();
});
