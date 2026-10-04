import { expect, test } from "@playwright/test";
import type Phaser from "phaser";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";
import type { Decoration, Monster } from "../../src/client/types";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires VITE_ART_DEBUG=true");
test.setTimeout(90_000);

type TestWindow = Window & {
  __webcrawlScene: Phaser.Scene;
  __webcrawlTest: {
    setPlayerInvulnerable: (enabled: boolean) => void;
    primeMinibossSceneryBlock: () => { monster: Monster; blocker: Decoration } | null;
  };
  __minibossBlock?: { monster: Monster; blocker: Decoration; start: { x: number; y: number } };
};

test("a trapped ranged miniboss breaks scenery and resumes pursuit", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "none"), LIGHT_DETAIL_STORAGE_KEY);
  await page.goto("/");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-monsters", "0", { timeout: 30_000 });
  await page.evaluate(() => {
    const target = window as unknown as TestWindow;
    target.__webcrawlTest.setPlayerInvulnerable(true);
    const scenario = target.__webcrawlTest.primeMinibossSceneryBlock();
    if (!scenario) throw new Error("Miniboss navigation scenario unavailable");
    target.__minibossBlock = { ...scenario, start: { x: scenario.monster.x, y: scenario.monster.y } };
    target.__webcrawlScene.cameras.main.stopFollow().centerOn(scenario.monster.x, scenario.monster.y);
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as TestWindow).__minibossBlock!.blocker.destroyed
  ), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const { monster, start } = (window as unknown as TestWindow).__minibossBlock!;
    return Math.hypot(monster.x - start.x, monster.y - start.y);
  }), { timeout: 10_000 }).toBeGreaterThan(5);
});
