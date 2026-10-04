import { expect, test } from "@playwright/test";
import type Phaser from "phaser";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { REGULAR_MONSTER_DEFINITIONS } from "../../src/client/domain/specs";
import type { Decoration, Monster } from "../../src/client/types";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires VITE_ART_DEBUG=true");
test.setTimeout(90_000);

type TestWindow = Window & {
  __webcrawlScene: Phaser.Scene;
  __webcrawlTest: {
    setPlayerInvulnerable: (enabled: boolean) => void;
    teleportPlayerTo: (x: number, y: number) => void;
    primeMinibossSceneryBlock: () => { monster: Monster; blocker: Decoration } | null;
    primeDoorwayCrowd: () => Monster[];
  };
  __minibossBlock?: { monster: Monster; blocker: Decoration; start: { x: number; y: number } };
  __regularRecovery?: Monster;
  __doorCrowd?: { monsters: Monster[]; searches: number };
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

test("a regular monster caches an unreachable doorway and resumes pursuit when the player returns", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "none"), LIGHT_DETAIL_STORAGE_KEY);
  await page.goto("/");
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-active-monsters", "0", { timeout: 30_000 });
  const { layout } = artDebugLevel();
  const gallery = layout.nodes[0]!;
  const adjoiningRoom = layout.nodes[1]!;
  await page.evaluate(({ definition, gallery, adjoiningRoom }) => {
    const target = window as unknown as TestWindow;
    const api = target.__webcrawlTest;
    api.setPlayerInvulnerable(true);
    const scenario = api.primeMinibossSceneryBlock();
    if (!scenario) throw new Error("Navigation actor unavailable");
    const monster = scenario.monster;
    // Enlarge the geometry to make the doorway reliably impassable while
    // explicitly exercising the ordinary-monster AI, not the miniboss branch.
    Object.assign(monster, definition, {
      miniboss: false, size: definition.size * 3, spriteSize: definition.spriteSize * 3,
      y: gallery.height / 2 - 300,
    });
    monster.x = gallery.width / 2 - monster.size * monster.footprintRadii.x - 80;
    target.__regularRecovery = monster;
    api.teleportPlayerTo(adjoiningRoom.x, adjoiningRoom.y + 100);
    target.__webcrawlScene.cameras.main.stopFollow().centerOn(monster.x, monster.y);
  }, { definition: REGULAR_MONSTER_DEFINITIONS["melee-heavy"], gallery, adjoiningRoom });
  await expect(game).toHaveAttribute("data-player-x", String(adjoiningRoom.x));
  await expect.poll(() => page.evaluate(() => {
    const monster = (window as unknown as TestWindow).__regularRecovery!;
    return Number.isFinite(monster.lastPathSearchAt) && Boolean(monster.path?.length);
  })).toBe(true);
  const firstSearch = await page.evaluate(() => (window as unknown as TestWindow).__regularRecovery!.lastPathSearchAt);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__regularRecovery!.lastPathSearchAt)).toBe(firstSearch);
  const start = await page.evaluate(() => {
    const target = window as unknown as TestWindow;
    const monster = target.__regularRecovery!;
    const start = { x: monster.x, y: monster.y };
    target.__webcrawlTest.teleportPlayerTo(start.x - 280, start.y);
    target.__webcrawlScene.cameras.main.stopFollow().centerOn(start.x, start.y);
    return start;
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as TestWindow).__regularRecovery!.x
  ), { timeout: 10_000 }).toBeLessThan(start.x - 25);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__regularRecovery!.lastPathSearchAt)).toBeGreaterThan(firstSearch!);
});

for (const destinationRoom of [1, 2]) test(`a 24-monster shared-path crowd clears the doorway toward room ${destinationRoom}`, async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "none"), LIGHT_DETAIL_STORAGE_KEY);
  await page.goto("/");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-monsters", "0", { timeout: 30_000 });
  const { layout } = artDebugLevel();
  const gallery = layout.nodes[0]!;
  const destinationRooms = layout.nodes.slice(1, destinationRoom + 1);
  await page.evaluate(({ gallery, destinationRooms }) => {
    const target = window as unknown as TestWindow;
    const api = target.__webcrawlTest;
    api.setPlayerInvulnerable(true);
    const monsters = api.primeDoorwayCrowd();
    if (monsters.length !== 24) throw new Error("Expected 24 doorway crowd monsters");
    // The gallery contains explosive props. Keep incidental combat damage from
    // turning this navigation assertion into a count of surviving monsters.
    for (const monster of monsters) monster.hp = monster.maxHp = 1000;
    target.__doorCrowd = { monsters, searches: 0 };
    const searches = new Map<Monster, number>();
    target.__webcrawlScene.events.on("postupdate", () => {
      for (const monster of monsters) {
        if (!Number.isFinite(monster.lastPathSearchAt) || searches.get(monster) === monster.lastPathSearchAt) continue;
        searches.set(monster, monster.lastPathSearchAt!);
        target.__doorCrowd!.searches++;
      }
    });
    for (const room of destinationRooms) api.teleportPlayerTo(room.x + 100, room.y);
    target.__webcrawlScene.cameras.main.stopFollow().centerOn(gallery.width / 2, 0);
  }, { gallery, destinationRooms });
  try {
    await expect.poll(() => page.evaluate(doorX =>
      (window as unknown as TestWindow).__doorCrowd!.monsters.filter(monster => monster.x > doorX + 35).length,
    gallery.width / 2), { timeout: 60_000 }).toBeGreaterThanOrEqual(destinationRoom === 1 ? 12 : 24);
  } catch (error) {
    const state = await page.evaluate(() => {
      const { monsters, searches } = (window as unknown as TestWindow).__doorCrowd!;
      return { searches, monsters: monsters.map(monster => ({
        x: monster.x, y: monster.y, pathIndex: monster.pathIndex, partial: monster.pathPartial,
        waypoint: monster.path?.[monster.pathIndex ?? 0], lastSearch: monster.lastPathSearchAt,
        escape: monster.escapeDirection, escapeUntil: monster.escapeUntil,
        dead: monster.dead, hp: monster.hp, moving: monster.moving,
      })) };
    });
    throw new Error(`Doorway crowd stalled: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.waitForTimeout(1200);
  const counts = await page.evaluate(() => {
    const { monsters, searches } = (window as unknown as TestWindow).__doorCrowd!;
    return { searches, routed: monsters.filter(monster => monster.path?.length).length };
  });
  expect(counts.routed).toBe(24);
  expect(counts.searches).toBeLessThanOrEqual(12);
});
