import { expect, test, type Page } from "@playwright/test";
import { POWERUP_DEFINITIONS, POWERUP_KINDS, type PlayerState } from "../../src/client/domain/powerups";
import type { LootItem, Point, PowerupKind } from "../../src/client/types";

test.setTimeout(90_000);

interface TestWindow extends Window {
  __webcrawlTest: {
    playerState(): PlayerState;
    playerHp(): number;
    damagePlayer(amount: number): void;
    spawnPowerup(kind: PowerupKind): LootItem;
    defeatAllMonsters(): void;
    teleportPlayerTo(x: number, y: number): void;
    loot(): Array<{ id: string; kind: string; powerup: PowerupKind | null; x: number; y: number }>;
    grantEnergy(count: number): void;
    grantCrystals(count: number): void;
    grantRam(count: number): void;
    useCrystal(): boolean;
    expireCrystalShield(): void;
    navigate(url: string): Promise<void>;
    goBack(): Promise<void>;
  };
  __webcrawlScene: import("phaser").Scene;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("#welcomeUrlInput")).toBeVisible();
}

async function startGame(page: Page, fixture = "<!doctype html><html><body><main>Power-up testing area</main><section>Second room</section></body></html>"): Promise<void> {
  await page.route("**/api/fetch?**", route => route.fulfill({ status: 200, contentType: "text/html", body: fixture }));
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: fixture,
  }));
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/powerups");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", /[1-9]/, { timeout: 30_000 });
}

async function pickup(page: Page, kind: PowerupKind): Promise<void> {
  await page.evaluate(kind => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const item = api.spawnPowerup(kind);
    api.teleportPlayerTo(item.x, item.y);
    api.teleportPlayerTo(item.x - 80, item.y);
  }, kind);
}

test("collects and stacks every power-up, preserves progression across floors, and resets on restart", async ({ page }) => {
  await startGame(page);
  const state = () => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState());
  expect(await state()).toMatchObject({ aimAid: 0, damageMultiplier: 1, powerups: {} });
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.damagePlayer(3));
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-hp", "7");
  for (const kind of POWERUP_KINDS) {
    await pickup(page, kind);
    await pickup(page, kind);
    if (kind === "health") expect(await state()).toMatchObject({ hp: 11, maxHp: 14 });
    if (kind === "energy") {
      expect((await state()).maxEnergy).toBe(14);
      await expect(page.locator("#gameCanvas")).toHaveAttribute("data-energy", "4");
    }
  }
  const collected = await state();
  expect(collected).toMatchObject({
    maxHp: 14, maxEnergy: 14, damageMultiplier: 1.2,
    walkSpeedMultiplier: 1.2, shotRateMultiplier: 1.2, criticalChance: 0.02,
    powerups: Object.fromEntries(POWERUP_KINDS.map(kind => [kind, 2])),
  });
  // Regeneration may already have ticked while slower browsers collect the remaining upgrades.
  expect(collected.hp).toBeGreaterThanOrEqual(11);
  expect(collected.hp).toBeLessThanOrEqual(collected.maxHp);
  expect(Number(await page.locator("#gameCanvas").getAttribute("data-energy"))).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-energy-loot", "0");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-medkits", "0");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-cores", "0");
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlScene.cache.audio.exists("sfx-pickup-powerup"))).toBe(true);

  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/next"));
  expect((await state()).powerups).toEqual(collected.powerups);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect((await state()).maxHp).toBe(14);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().some(item => item.id.includes("test-powerup")))).toBe(false);

  const shieldStatus = page.waitForEvent("console", {
    predicate: message => message.text().includes("Crystal shield active for 14 seconds."),
  });
  await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.grantEnergy(100);
    api.grantCrystals(1);
    api.useCrystal();
  });
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-energy", "14");
  expect((await shieldStatus).text()).toContain("14 seconds");
  await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.expireCrystalShield();
    api.damagePlayer(100);
  });
  await expect(page.locator("#deathModal")).toBeVisible();
  await expect(page.locator("#deathPowerupInventory img")).toHaveCount(POWERUP_KINDS.length);
  await expect(page.locator(".death-loot-row")).toHaveCount(2);
  await page.locator("#restartButton").click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  expect(await state()).toMatchObject({ hp: 10, maxHp: 10, maxEnergy: 10, powerups: {}, aimAid: 0 });
});

test("bosses drop two rare items and preserve uncollected rewards across floor revisits", async ({ page }) => {
  await startGame(page, "<!doctype html><html><body><main>Boss deck</main></body></html>");
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.defeatAllMonsters());
  const rareDrops = () => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot()
    .filter(item => item.id.includes("::boss-drop-") && (item.kind === "weapon" || item.kind === "powerup")));
  const initial = await rareDrops();
  expect(initial).toHaveLength(2);
  expect(initial.filter(item => item.kind === "weapon").length).toBeLessThanOrEqual(1);
  const powerup = initial.find(item => item.kind === "powerup" && item.id.endsWith("boss-drop-2"))!;
  expect(powerup.powerup).toBeTruthy();
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/next"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect(await rareDrops()).toEqual(initial);
  await page.evaluate((item: Point) => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const host = document.querySelector<HTMLElement>("#gameCanvas")!;
    const origin = { x: Number(host.dataset.playerX), y: Number(host.dataset.playerY) };
    api.teleportPlayerTo(item.x, item.y);
    api.teleportPlayerTo(origin.x, origin.y);
  }, powerup);
  const remaining = await rareDrops();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.id).not.toBe(powerup.id);
  expect(await page.evaluate(kind => (window as unknown as TestWindow).__webcrawlTest.playerState().powerups[kind!], powerup.powerup)).toBe(1);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/next"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect(await rareDrops()).toEqual(remaining);
});

test("renders each icon at crystal size with its matching aura and plays the pickup sample", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("webcrawl-light-detail", "high"));
  await startGame(page);
  await page.bringToFront();
  for (const kind of POWERUP_KINDS) {
    const item = await page.evaluate(kind => (window as unknown as TestWindow).__webcrawlTest.spawnPowerup(kind), kind);
    const rendered = await page.evaluate(({ id, asset }) => {
      const scene = (window as unknown as TestWindow).__webcrawlScene;
      const sprite = scene.children.list.flatMap(object => "list" in object
        ? (object as import("phaser").GameObjects.Container).list : [])
        .find(object => "texture" in object &&
          (object as import("phaser").GameObjects.Image).texture.key === `asset:${asset}`) as import("phaser").GameObjects.Image | undefined;
      // Phaser's renderer keeps pickup auras by ID; inspect the actual scene light color instead of its private map.
      const api = (window as unknown as TestWindow).__webcrawlTest;
      const loot = api.loot().find(item => item.id === id)!;
      const light = scene.lights.lights.find(light => light.x === loot.x && light.y === loot.y);
      return { width: sprite?.displayWidth, height: sprite?.displayHeight,
        color: light ? [light.color.r, light.color.g, light.color.b] : null };
    }, { id: item.id, asset: POWERUP_DEFINITIONS[kind].asset });
    expect(rendered.width).toBe(63);
    expect(rendered.height).toBe(63);
    const color = POWERUP_DEFINITIONS[kind].color;
    expect(rendered.color?.[0]).toBeCloseTo(((color >> 16) & 255) / 255);
    expect(rendered.color?.[1]).toBeCloseTo(((color >> 8) & 255) / 255);
    expect(rendered.color?.[2]).toBeCloseTo((color & 255) / 255);
    const soundPlayed = await page.evaluate((item: Point) => {
      const target = window as unknown as TestWindow;
      const sounds: string[] = [];
      const manager = target.__webcrawlScene.sound as import("phaser").Sound.BaseSoundManager;
      const original = manager.add;
      manager.add = function (key, ...args) { sounds.push(key); return original.call(this, key, ...args); };
      try {
        target.__webcrawlTest.teleportPlayerTo(item.x, item.y);
        target.__webcrawlTest.teleportPlayerTo(item.x - 80, item.y);
      } finally {
        manager.add = original;
      }
      return sounds.includes("sfx-pickup-powerup");
    }, item);
    expect(soundPlayed).toBe(true);
  }
});

test("regenerates stacked health and energy during active gameplay", async ({ page }) => {
  await startGame(page);
  await page.bringToFront();
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.damagePlayer(3));
  for (const kind of ["health_regen", "energy_regen"] as const) {
    await pickup(page, kind);
    await pickup(page, kind);
  }
  await expect.poll(async () => {
    const state = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState());
    return state.hp;
  }, { timeout: 25_000 }).toBeGreaterThan(7);
  const regenerated = await page.evaluate(() => ({
    hp: (window as unknown as TestWindow).__webcrawlTest.playerHp(),
    energy: Number(document.querySelector<HTMLElement>("#gameCanvas")!.dataset.energy),
  }));
  expect(regenerated.hp).toBeCloseTo(7.2);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-energy")), { timeout: 2_000 }).toBeCloseTo(0.2);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-energy-loot", "0");
  const paused = await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    return (window as unknown as TestWindow).__webcrawlTest.playerState();
  });
  // An intentional pause must leave regeneration clocks unchanged while real time passes.
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState())).toEqual(paused);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () =>
    (await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState())).regenElapsedMs.health_regen,
  ).toBeGreaterThan(paused.regenElapsedMs.health_regen);
});

for (const mobile of [false, true]) {
  test.describe(mobile ? "mobile power-ups" : "desktop power-ups", () => {
    test.use(mobile ? { viewport: { width: 390, height: 720 }, hasTouch: true, isMobile: true } : {});
    test("fits RAM, crystals and collected power-up icons in the loot panel", async ({ page }, testInfo) => {
      await startGame(page);
      const panel = page.locator(mobile ? ".loot-mini" : ".loot-status-card");
      const inventory = panel.locator(".powerup-inventory");
      await expect(inventory).toBeHidden();
      await page.evaluate(() => {
        const api = (window as unknown as TestWindow).__webcrawlTest;
        api.grantRam(202);
        api.grantCrystals(3);
      });
      await pickup(page, "health");
      const initialSize = (await inventory.locator("img").boundingBox())!.width;
      await pickup(page, "health");
      for (const kind of POWERUP_KINDS.filter(kind => kind !== "health")) await pickup(page, kind);
      await expect(inventory.locator("img")).toHaveCount(POWERUP_KINDS.length);
      await expect(inventory.locator('[data-powerup="health"]')).toHaveAttribute("title", "Higher Valuation ×2");
      await expect(inventory.locator('[data-powerup="health"] .powerup-stack-count')).toHaveText("2");
      await expect(panel.locator(":scope > span > strong")).toHaveText(["202", "3"]);
      expect((await inventory.locator("img").first().boundingBox())!.width).toBeLessThan(initialSize);
      for (const viewport of mobile
        ? [{ width: 390, height: 720 }, { width: 844, height: 390 }]
        : [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(viewport);
        const geometry = await panel.evaluate(panel => {
          const bounds = panel.getBoundingClientRect();
          const icons = [...panel.querySelectorAll("img")].map(image => image.getBoundingClientRect());
          const counts = [...panel.querySelectorAll(":scope > span")].map(slot => slot.getBoundingClientRect());
          return {
            overflowing: panel.scrollWidth > panel.clientWidth,
            iconsFit: icons.every(icon => icon.width > 0 && icon.left >= bounds.left && icon.right <= bounds.right + 1 &&
              icon.top >= bounds.top && icon.bottom <= bounds.bottom + 1),
            countCenters: counts.map(count => count.top + count.height / 2),
          };
        });
        expect(geometry.overflowing).toBe(false);
        expect(geometry.iconsFit).toBe(true);
        expect(Math.abs(geometry.countCenters[0]! - geometry.countCenters[1]!)).toBeLessThan(1);
      }
      await page.screenshot({ path: testInfo.outputPath("loot-panel.png") });
    });
    test("shows random, distinct mystery icons after the loot breakdown", async ({ page }) => {
      await signIn(page);
      const icons = page.locator('#welcomePromptBody img[src*="pickups/powerups/"]');
      await expect(icons).toHaveCount(mobile ? 3 : 5);
      const sources = await icons.evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
      expect(new Set(sources).size).toBe(sources.length);
      await expect(page.locator("#welcomePromptBody")).toContainText("Certain power-ups are scattered across the web.");
      const order = await page.locator("#welcomePromptBody").evaluate(body => {
        const loot = body.querySelectorAll(".welcome-loot");
        const lastLoot = loot[loot.length - 1]!;
        const paragraph = lastLoot.nextElementSibling!;
        return { paragraph: paragraph.textContent, icons: paragraph.nextElementSibling?.querySelectorAll('img[src*="powerups/"]').length };
      });
      expect(order.paragraph).toContain("Certain power-ups");
      expect(order.icons).toBe(mobile ? 3 : 5);
      await page.locator("#welcomeUrlInput").fill("https://example.com/powerups");
      const fixture = "<html><body><p>A room</p></body></html>";
      await page.route("**/api/fetch?**", route => route.fulfill({ status: 200, contentType: "text/html", body: fixture }));
      await page.getByRole("button", { name: "Go" }).click();
      await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", /[1-9]/, { timeout: 30_000 });
      expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState().aimAid)).toBe(mobile ? 0.2 : 0);
    });
  });
}
