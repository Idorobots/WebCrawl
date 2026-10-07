import { expect, test, type Page } from "@playwright/test";
import { POWERUP_DEFINITIONS, POWERUP_KINDS, type PlayerState } from "../../src/client/domain/powerups";
import type { Decoration, LootItem, Monster, Point, PowerupKind, WeaponKind } from "../../src/client/types";

test.setTimeout(90_000);

interface TestWindow extends Window {
  __webcrawlTest: {
    playerState(): PlayerState;
    playerHp(): number;
    damagePlayer(amount: number): void;
    spawnPowerup(kind: PowerupKind, position?: Point): LootItem;
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
    setPlayerInvulnerable(enabled: boolean): void;
    equipWeapon(kind: WeaponKind, ammo: number): void;
    setWeaponAmmo(ammo: number): void;
    shoot(): boolean;
    hitMonster(id: string, damage: number): void;
    monsters(): Array<Pick<Monster, "id" | "x" | "y" | "roomId" | "active" | "dead" | "hp" | "maxHp" | "speed" | "miniboss" | "bossKind" | "slowRemainingMs" | "stunRemainingMs">>;
    scenery(): Array<Pick<Decoration, "id" | "x" | "y" | "roomId" | "destructible" | "destroyed">>;
    destroyScenery(id: string): void;
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

async function stackPowerup(page: Page, kind: PowerupKind, count: number): Promise<void> {
  await page.evaluate(({ kind, count }) => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const game = document.querySelector<HTMLElement>("#gameCanvas")!;
    const position = { x: Number(game.dataset.playerX), y: Number(game.dataset.playerY) };
    for (let index = 0; index < count; index++) {
      const item = api.spawnPowerup(kind, position);
      api.teleportPlayerTo(item.x, item.y);
    }
  }, { kind, count });
}

test("composes map expansion, radar and RAG without visiting rooms or waking enemies", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  const map = page.locator("#sideMinimapCanvas");
  const explored = await game.getAttribute("data-visited-rooms");
  const active = await game.getAttribute("data-active-monsters");
  await expect(map).toHaveAttribute("data-monsters", "0");
  await expect(map).toHaveAttribute("data-portals", "0");
  await expect(map).toHaveAttribute("data-pickups", "0");
  await expect(map).toHaveAttribute("data-vending", "0");
  await stackPowerup(page, "map_expansion", 1);
  await expect.poll(async () => Number(await map.getAttribute("data-mapped-rooms"))).toBeGreaterThan(Number(explored));
  const firstExpansion = Number(await map.getAttribute("data-mapped-rooms"));
  await expect(map).toHaveAttribute("data-monsters", "0");
  await expect(map).toHaveAttribute("data-portals", "0");
  await stackPowerup(page, "map_expansion", 1);
  await expect.poll(async () => Number(await map.getAttribute("data-mapped-rooms"))).toBeGreaterThanOrEqual(firstExpansion);
  await pickup(page, "map_radar");
  await expect.poll(async () => Number(await map.getAttribute("data-monsters"))).toBeGreaterThan(0);
  await expect(map).toHaveAttribute("data-monster-counts", /-?\d+:[1-9]\d*/);
  await expect(map).toHaveAttribute("data-portals", "0");
  await pickup(page, "map_loot");
  await expect.poll(async () => Number(await map.getAttribute("data-portals"))).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.spawnPowerup("health"));
  await expect.poll(async () => Number(await map.getAttribute("data-pickups"))).toBeGreaterThan(0);
  await expect(game).toHaveAttribute("data-visited-rooms", explored!);
  await expect(game).toHaveAttribute("data-active-monsters", active!);
});

test("multiplies each shotgun pellet and spends one emergency energy per shot before the last ammo round", async ({ page }) => {
  await startGame(page);
  await pickup(page, "energy_ammo");
  await stackPowerup(page, "shot_pattern", 10);
  const shots = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.equipWeapon("scatter-array", 2);
    api.grantEnergy(3);
    const game = document.querySelector<HTMLElement>("#gameCanvas")!;
    const fire = (ammo: number) => {
      api.setWeaponAmmo(ammo);
      const fired = api.shoot();
      return { fired, ammo: game.dataset.weaponAmmo, energy: api.playerState().energy,
        volley: game.dataset.lastPlayerVolley, kind: game.dataset.weaponKind };
    };
    return [fire(2), fire(1), fire(1), fire(1), fire(1)];
  });
  expect(shots.map(shot => shot.fired)).toEqual([true, true, true, true, true]);
  expect(shots.map(shot => shot.volley)).toEqual(["10", "10", "10", "10", "10"]);
  expect(shots.map(shot => shot.energy)).toEqual([3, 2, 1, 0, 0]);
  expect(shots.map(shot => shot.ammo)).toEqual(["1", "1", "1", "1", "infinite"]);
  expect(shots.at(-1)!.kind).toBe("pulse-rifle");
});

test("applies blue slow and gray stun with a rotating spinner, pauses the sprite, and restores it after expiry", async ({ page }) => {
  await startGame(page, "<!doctype html><html><body><main>Boss deck</main></body></html>");
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.setPlayerInvulnerable(true));
  await stackPowerup(page, "damage_slow", 20);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState().powerups.damage_slow)).toBe(20);
  const id = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.monsters().find(item => item.active && !item.dead)!.id);
  const tint = () => page.evaluate(id => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const container = scene.children.list.find(object => object.getData("monsterId") === id) as import("phaser").GameObjects.Container | undefined;
    return (container?.getByName("sprite") as import("phaser").GameObjects.Sprite | undefined)?.tintTopLeft;
  }, id);
  await expect.poll(tint).not.toBeUndefined();
  await page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.hitMonster(id, 0.1), id);
  await expect.poll(tint, { intervals: [20] }).toBe(0x4d8dff);
  await expect.poll(tint, { intervals: [100], timeout: 3_000 }).toBe(0xffffff);
  await stackPowerup(page, "damage_stun", 20);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerState().powerups.damage_stun)).toBe(20);
  const held = await page.evaluate(async id => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const container = scene.children.list.find(object => object.getData("monsterId") === id) as import("phaser").GameObjects.Container;
    const sprite = container.getByName("sprite") as import("phaser").GameObjects.Sprite;
    const textureBefore = sprite.texture.key;
    const frameBefore = sprite.frame.name;
    const hitAsStun = () => {
      const random = Math.random;
      Math.random = () => 0.99; // Both procs succeed at 20 stacks; resolve the simultaneous hit as stun.
      try { api.hitMonster(id, 0.1); } finally { Math.random = random; }
    };
    hitAsStun();
    const before = api.monsters().find(item => item.id === id)!;
    const samples: Array<{ x: number; y: number; tint: number; grayscale: boolean; paused: boolean;
      texture: string; frame: string | number; spinnerRotation: number; spinnerCount: number;
      slowRemainingMs: number; spinnerCenterError: number }> = [];
    let refreshed = false;
    await new Promise<void>(resolve => {
      const sample = () => {
        const current = api.monsters().find(item => item.id === id)!;
        if ((current.stunRemainingMs ?? 0) <= 0) {
          scene.events.off("postupdate", sample);
          resolve();
          return;
        }
        // Refresh an active stun once: it must reuse the same spinner and preserve the frozen frame.
        if (!refreshed && current.stunRemainingMs! < 300) {
          refreshed = true;
          api.hitMonster(id, 0.1);
        }
        const spinner = container.getByName("stun-spinner") as import("phaser").GameObjects.Graphics;
        const bounds = sprite.getBounds();
        const position = container.getWorldTransformMatrix().transformPoint(spinner.x, spinner.y);
        samples.push({ x: current.x, y: current.y, tint: sprite.tintTopLeft,
          grayscale: Boolean(sprite.getData("stunGrayscale")), paused: sprite.anims.isPaused,
          texture: sprite.texture.key, frame: sprite.frame.name, spinnerRotation: spinner.rotation,
          spinnerCount: container.list.filter(child => child.name === "stun-spinner").length,
          slowRemainingMs: current.slowRemainingMs ?? 0,
          spinnerCenterError: Math.hypot(position.x - bounds.centerX, position.y - bounds.centerY) });
      };
      scene.events.on("postupdate", sample);
      sample();
    });
    return { before, samples, textureBefore, frameBefore, refreshed,
      ending: { spinner: Boolean(container.getByName("stun-spinner")), paused: sprite.anims.isPaused,
        grayscale: Boolean(sprite.getData("stunGrayscale")), tint: sprite.tintTopLeft } };
  }, id);
  expect(held.before.stunRemainingMs).toBe(500);
  expect(held.before.slowRemainingMs).toBe(0);
  expect(held.samples.length).toBeGreaterThan(0);
  for (const sample of held.samples) {
    expect(sample.x).toBe(held.before.x);
    expect(sample.y).toBe(held.before.y);
    expect(sample.tint).toBe(0xb0b0b0);
    expect(sample.grayscale).toBe(true);
    expect(sample.paused).toBe(true);
    expect(sample.texture).toBe(held.textureBefore);
    expect(sample.frame).toBe(held.frameBefore);
    expect(sample.spinnerCount).toBe(1);
    expect(sample.slowRemainingMs).toBe(0);
    expect(sample.spinnerCenterError).toBeLessThan(0.01);
  }
  expect(held.refreshed).toBe(true);
  expect(new Set(held.samples.map(sample => sample.spinnerRotation)).size).toBeGreaterThan(1);
  expect(held.ending).toEqual({ spinner: false, paused: false, grayscale: false, tint: 0xffffff });
  const firstSlow = await page.evaluate(id => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const random = Math.random;
    try {
      Math.random = () => 0;
      api.hitMonster(id, 0.1);
      Math.random = () => 0.99;
      api.hitMonster(id, 0.1); // Stun cannot replace an already active slow.
    } finally { Math.random = random; }
    const monster = api.monsters().find(item => item.id === id)!;
    const container = (window as unknown as TestWindow).__webcrawlScene.children.list
      .find(object => object.getData("monsterId") === id) as import("phaser").GameObjects.Container;
    return { slow: monster.slowRemainingMs, stun: monster.stunRemainingMs,
      spinner: Boolean(container.getByName("stun-spinner")) };
  }, id);
  expect(firstSlow).toEqual({ slow: 2_000, stun: 0, spinner: false });
  await expect.poll(tint, { intervals: [100], timeout: 3_000 }).toBe(0xffffff);
  const deathCleanup = await page.evaluate(id => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const hp = api.monsters().find(item => item.id === id)!.hp;
    const random = Math.random;
    Math.random = () => 0.99;
    try { api.hitMonster(id, 0.1); } finally { Math.random = random; }
    api.hitMonster(id, hp + 1);
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const container = scene.children.list.find(object => object.getData("monsterId") === id) as import("phaser").GameObjects.Container;
    return { dead: api.monsters().find(item => item.id === id)!.dead, spinner: Boolean(container.getByName("stun-spinner")) };
  }, id);
  expect(deathCleanup).toEqual({ dead: true, spinner: false });
});

test("persists bonus monster and scenery drops without rerolls or recollection across floor revisits", async ({ page }) => {
  await startGame(page);
  await stackPowerup(page, "extra_loot", 20);
  await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const prop = api.scenery().find(item => item.destructible && !item.destroyed);
    if (!prop) throw new Error("Fixture needs destructible scenery");
    api.destroyScenery(prop.id);
    api.defeatAllMonsters();
  });
  const bonuses = () => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().filter(item => item.id.endsWith("::bonus-drop")));
  const initial = await bonuses();
  expect(initial.length).toBeGreaterThan(1);
  expect(new Set(initial.map(item => item.id)).size).toBe(initial.length);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/next"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect(await bonuses()).toEqual(initial);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.defeatAllMonsters());
  expect(await bonuses()).toEqual(initial);
  const collectedId = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    const items = api.loot().filter(item => item.id.endsWith("::bonus-drop"));
    for (const item of items) {
      api.teleportPlayerTo(item.x, item.y);
      if (!api.loot().some(candidate => candidate.id === item.id)) return item.id;
    }
    return null;
  });
  expect(collectedId).not.toBeNull();
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/next"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect((await bonuses()).some(item => item.id === collectedId)).toBe(false);
});

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
      await expect(page.locator("#welcomePromptBody")).toContainText("are scattered across the web.");
      const order = await page.locator("#welcomePromptBody").evaluate(body => {
        const loot = body.querySelectorAll(".welcome-loot");
        const lastLoot = loot[loot.length - 1]!;
        const paragraph = lastLoot.nextElementSibling!;
        return { paragraph: paragraph.textContent, icons: paragraph.nextElementSibling?.querySelectorAll('img[src*="powerups/"]').length };
      });
      expect(order.paragraph).toContain("scattered across the web");
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
