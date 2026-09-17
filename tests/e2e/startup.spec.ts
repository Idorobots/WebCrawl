import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CAMERA_SCALE } from "../../src/client/config";
import { PORTAL_DEFINITION, ROOM_DEFINITIONS } from "../../src/client/domain/specs";

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
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-monsters", "0");
  await expect(page.locator("#statRooms")).toContainText("1 / 100");
}

async function playerPosition(page: Page): Promise<{ x: number; y: number }> {
  const player = page.locator("#gameCanvas");
  return {
    x: Number(await player.getAttribute("data-player-x")),
    y: Number(await player.getAttribute("data-player-y")),
  };
}

async function alignPlayerToDoor(
  page: Page,
  door: { x: number; y: number },
  direction: string | null,
): Promise<void> {
  const position = await playerPosition(page);
  const horizontal = door.x < position.x ? "ArrowLeft" : "ArrowRight";
  const vertical = door.y < position.y ? "ArrowUp" : "ArrowDown";
  const alignKey = direction === "N" || direction === "S" ? horizontal : vertical;
  const alignDistance = direction === "N" || direction === "S"
    ? Math.abs(door.x - position.x)
    : Math.abs(door.y - position.y);
  if (alignDistance <= 8) return;
  await page.keyboard.down(alignKey);
  try {
    const remaining = (current: { x: number; y: number }): number =>
      direction === "N" || direction === "S" ? door.x - current.x : door.y - current.y;
    await expect.poll(async () => {
      const remainingDistance = remaining(await playerPosition(page));
      return Math.abs(remainingDistance) < 8 || remainingDistance < 0;
    }, { timeout: 6_000 }).toBe(true);
  } finally {
    await page.keyboard.up(alignKey);
  }
}

async function cameraState(page: Page): Promise<{ x: number; y: number; zoom: number; bossRoomId: number | null } | null> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: { camera: () => { x: number; y: number; zoom: number; bossRoomId: number | null } | null };
    }).__webcrawlTest?.camera() ?? null
  );
}

async function teleportPlayer(page: Page, target: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    (window as Window & {
      __webcrawlTest?: { teleportPlayerTo: (nextX: number, nextY: number) => void };
    }).__webcrawlTest?.teleportPlayerTo(x, y);
  }, target);
}

async function setWeaponAmmo(page: Page, ammo: number): Promise<void> {
  await page.evaluate((nextAmmo) => {
    (window as Window & {
      __webcrawlTest?: { setWeaponAmmo: (ammo: number) => void };
    }).__webcrawlTest?.setWeaponAmmo(nextAmmo);
  }, ammo);
}

async function setPlayerInvulnerable(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((nextEnabled) => {
    (window as Window & {
      __webcrawlTest?: { setPlayerInvulnerable: (value: boolean) => void };
    }).__webcrawlTest?.setPlayerInvulnerable(nextEnabled);
  }, enabled);
}

async function grantCrystals(page: Page, count: number): Promise<void> {
  await page.evaluate((nextCount) => {
    (window as Window & {
      __webcrawlTest?: { grantCrystals: (count: number) => void };
    }).__webcrawlTest?.grantCrystals(nextCount);
  }, count);
}

async function grantEnergy(page: Page, count: number): Promise<void> {
  await page.evaluate((nextCount) => {
    (window as Window & {
      __webcrawlTest?: { grantEnergy: (count: number) => void };
    }).__webcrawlTest?.grantEnergy(nextCount);
  }, count);
}

async function playerHp(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as Window & { __webcrawlTest?: { playerHp: () => number } }).__webcrawlTest?.playerHp() ?? 0
  );
}

async function damagePlayer(page: Page, amount: number): Promise<void> {
  await page.evaluate((damage) => {
    (window as Window & { __webcrawlTest?: { damagePlayer: (amount: number) => void } }).__webcrawlTest?.damagePlayer(damage);
  }, amount);
}

async function expireCrystalShield(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __webcrawlTest?: { expireCrystalShield: () => void } }).__webcrawlTest?.expireCrystalShield();
  });
}

async function visibleLoot(page: Page): Promise<Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null; placement: string | null }>> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: {
        loot: () => Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null; placement: string | null }>;
      };
    }).__webcrawlTest?.loot() ?? []
  );
}

async function lastDroppedWeapon(page: Page): Promise<{ id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null; placement: string | null } | null> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: {
        lastDroppedWeapon: () => { id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null; placement: string | null } | null;
      };
    }).__webcrawlTest?.lastDroppedWeapon() ?? null
  );
}

test("starts a crawl and renders a playable floor", async ({ page }) => {
  const failedAssets: string[] = [];
  page.on("response", response => {
    if (response.url().includes("/assets/") && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await startGame(page);
  await expect.poll(() => page.locator("#playerHudPortrait").evaluate(image =>
    (image as HTMLImageElement).naturalWidth
  )).toBeGreaterThan(0);
  expect(failedAssets).toEqual([]);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-portals", "1");
  await expect(page.locator("#gameViewport")).toHaveCSS("cursor", "crosshair");
  await expect(page.locator("#rightHud")).toBeVisible();
  await expect(page.locator("#rightHud")).toContainText("MINIMAP");
  const minimap = page.locator("#sideMinimapCanvas");
  await expect(minimap).toBeVisible();
  await expect.poll(() => minimap.evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(1);
  await page.keyboard.press("m");
  await expect(page.locator('[role="dialog"][aria-label*="map" i]')).toHaveCount(0);
  await expect(minimap).toBeVisible();
});

test("reports the configured collision-debug state", async ({ page }) => {
  await startGame(page);
  await expect(page.locator("#gameCanvas")).toHaveAttribute(
    "data-debug-hitboxes",
    process.env.VITE_DEBUG_HITBOXES === "true" ? "true" : "false",
  );
});

test("uses crystals for temporary invulnerability without counting supplies as score loot", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await expect(page.locator("#creditCount")).toHaveText("0");
  await expect(page.locator("#crystalCount")).toHaveText("0");
  await expect(page.locator("#coreCount")).toHaveText("0");
  await expect(page.locator("#energyCount")).toHaveText("0");
  await expect(page.locator("#energyLootCount")).toHaveText("0");
  await expect(page.locator("#medkitCount")).toHaveText("0");

  await grantCrystals(page, 2);
  await expect(page.locator("#crystalCount")).toHaveText("2");
  await expect(game).toHaveAttribute("data-crystals", "2");

  await page.keyboard.press("Space");
  await expect(page.locator("#crystalCount")).toHaveText("1");
  await expect(game).toHaveAttribute("data-player-invulnerable", "true");
  await expect(game).toHaveAttribute("data-player-protection-tinted", "true");

  const protectedHp = await playerHp(page);
  await damagePlayer(page, 3);
  expect(await playerHp(page)).toBe(protectedHp);

  await page.keyboard.press("Space");
  await expect(page.locator("#crystalCount")).toHaveText("0");
  await expireCrystalShield(page);
  await expect(game).toHaveAttribute("data-player-invulnerable", "false");
  await damagePlayer(page, 3);
  expect(await playerHp(page)).toBe(protectedHp - 3);
});

test("charges energy and launches an invulnerable energy dash with right click", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await grantEnergy(page, 5);
  await expect(page.locator("#energyCount")).toHaveText("5");
  await expect(page.locator("#energyLootCount")).toHaveText("5");
  await expect(game).toHaveAttribute("data-energy", "5");

  const before = await playerPosition(page);
  const bounds = await page.locator("#gameViewport").boundingBox();
  if (!bounds) throw new Error("Expected a visible game viewport");
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);
  await page.mouse.down({ button: "right" });
  await expect.poll(async () => {
    return await game.getAttribute("data-player-dashing") === "true"
      && await game.getAttribute("data-player-invulnerable") === "true";
  }, { timeout: 3_000, intervals: [15] }).toBe(true);
  await page.mouse.up({ button: "right" });

  await expect.poll(async () => game.getAttribute("data-player-dashing"), {
    timeout: 5_000,
    intervals: [50],
  }).toBe("false");
  await expect.poll(async () => {
    const position = await playerPosition(page);
    return position.x !== before.x || position.y !== before.y;
  }, { timeout: 5_000, intervals: [50] }).toBe(true);
  await expect(page.locator("#energyCount")).toHaveText("0");
  await expect(page.locator("#energyLootCount")).toHaveText("0");
  await expect(game).toHaveAttribute("data-energy", "0");
});

test("spawns on an enabled entry portal without immediately retriggering it", async ({ page }) => {
  await startGame(page);
  await page.locator("#urlInput").fill("https://example.com/next");
  await page.getByRole("button", { name: "GO" }).click();
  await expect(page.locator("#statFloor")).toHaveText("2");

  const state = await page.evaluate(() => {
    const testApi = (window as Window & {
      __webcrawlTest?: {
        stairs: () => Array<{ id: string; type: "up" | "down"; x: number; y: number }>;
        portalContacts: () => string[];
      };
    }).__webcrawlTest;
    return {
      stairs: testApi?.stairs() ?? [],
      contacts: testApi?.portalContacts() ?? [],
    };
  });
  const entryPortal = state.stairs.find(stair => stair.type === "up");
  if (!entryPortal) throw new Error("Expected an up portal on floor two");

  expect(await playerPosition(page)).toEqual({
    x: Math.round(entryPortal.x + PORTAL_DEFINITION.contactOffset.x),
    y: Math.round(entryPortal.y + PORTAL_DEFINITION.contactOffset.y),
  });
  expect(state.contacts).toContain(entryPortal.id);
  await page.waitForTimeout(500);
  await expect(page.locator("#statFloor")).toHaveText("2");
});

test("keeps the Phaser viewport playable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await startGame(page);
  await expect(page.locator("#rightHud")).toBeHidden();
  const bounds = await page.locator("#gameViewport").boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(390);
  expect(bounds?.height).toBeGreaterThan(500);
});

test("keeps generated world coordinates independent of viewport size", async ({ page }) => {
  await startGame(page);
  const desktop = {
    player: await playerPosition(page),
    doorX: await page.locator("#gameCanvas").getAttribute("data-first-door-x"),
    doorY: await page.locator("#gameCanvas").getAttribute("data-first-door-y"),
  };

  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/");
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();

  expect({
    player: await playerPosition(page),
    doorX: await page.locator("#gameCanvas").getAttribute("data-first-door-x"),
    doorY: await page.locator("#gameCanvas").getAttribute("data-first-door-y"),
  }).toEqual(desktop);
});

test("keeps an active boss sized consistently while it follows the player out", async ({ page }) => {
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><script>const boss = true;</script><main><h1>Boss deck</h1></main></body></html>",
  }));
  await page.goto("/");
  await page.locator("#welcomeUrlInput").fill("https://example.com/boss");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();
  const game = page.locator("#gameCanvas");
  await setPlayerInvulnerable(page, true);
  await expect(game).toHaveAttribute("data-active-bosses", "0");

  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const position = await playerPosition(page);
  await alignPlayerToDoor(page, door, direction);
  const exitKey = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(exitKey);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up(exitKey);

  await expect(game).toHaveAttribute("data-active-bosses", "1");
  await expect(game).toHaveAttribute("data-active-boss-kind", /^(packet-storm|fork-bomb|heap-titan)$/);
  await expect.poll(
    async () => Number(await game.getAttribute("data-active-boss-display-width")),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  const initialBossSize = {
    width: Number(await game.getAttribute("data-active-boss-display-width")),
    height: Number(await game.getAttribute("data-active-boss-display-height")),
  };
  expect(initialBossSize.width).toBeGreaterThan(0);
  expect(initialBossSize.height).toBe(initialBossSize.width);
  await page.keyboard.down(exitKey);
  await expect(game).toHaveAttribute("data-current-room-tag", "script", { timeout: 10_000 });
  await page.keyboard.up(exitKey);
  const arena = {
    left: Number(await game.getAttribute("data-active-boss-arena-left")),
    right: Number(await game.getAttribute("data-active-boss-arena-right")),
    top: Number(await game.getAttribute("data-active-boss-arena-top")),
    bottom: Number(await game.getAttribute("data-active-boss-arena-bottom")),
  };
  const arenaCenter = { x: (arena.left + arena.right) / 2, y: (arena.top + arena.bottom) / 2 };
  const viewport = await page.locator("#gameViewport").boundingBox();
  if (!viewport) throw new Error("Game viewport has no bounds");
  await expect.poll(async () => {
    const camera = await cameraState(page);
    return camera && {
      centered: Math.hypot(camera.x - arenaCenter.x, camera.y - arenaCenter.y) < 3,
      fitsWidth: ROOM_DEFINITIONS.boss.width * camera.zoom <= viewport.width,
      fitsHeight: ROOM_DEFINITIONS.boss.height * camera.zoom <= viewport.height,
      bossRoom: camera.bossRoomId !== null,
    };
  }).toEqual({ centered: true, fitsWidth: true, fitsHeight: true, bossRoom: true });
  await page.setViewportSize({ width: 390, height: 720 });
  const mobileViewport = await page.locator("#gameViewport").boundingBox();
  if (!mobileViewport) throw new Error("Mobile game viewport has no bounds");
  await expect.poll(async () => {
    const camera = await cameraState(page);
    return camera && {
      centered: Math.hypot(camera.x - arenaCenter.x, camera.y - arenaCenter.y) < 3,
      fitsWidth: ROOM_DEFINITIONS.boss.width * camera.zoom <= mobileViewport.width,
      fitsHeight: ROOM_DEFINITIONS.boss.height * camera.zoom <= mobileViewport.height,
    };
  }).toEqual({ centered: true, fitsWidth: true, fitsHeight: true });
  const initialBossPosition = {
    x: Number(await game.getAttribute("data-active-boss-x")),
    y: Number(await game.getAttribute("data-active-boss-y")),
  };
  await teleportPlayer(page, position);
  await expect(game).toHaveAttribute("data-current-room-tag", "body");
  await expect.poll(async () => await cameraState(page)).toMatchObject({ zoom: CAMERA_SCALE, bossRoomId: null });
  await expect.poll(async () => {
    const x = Number(await game.getAttribute("data-active-boss-x"));
    const y = Number(await game.getAttribute("data-active-boss-y"));
    return Math.hypot(x - initialBossPosition.x, y - initialBossPosition.y);
  }, { timeout: 10_000 }).toBeGreaterThan(12);
  const finalBoss = {
    x: Number(await game.getAttribute("data-active-boss-x")),
    y: Number(await game.getAttribute("data-active-boss-y")),
    width: Number(await game.getAttribute("data-active-boss-display-width")),
    height: Number(await game.getAttribute("data-active-boss-display-height")),
  };
  expect(Math.abs(finalBoss.width - initialBossSize.width) / initialBossSize.width).toBeLessThan(0.12);
  expect(Math.abs(finalBoss.height - initialBossSize.height) / initialBossSize.height).toBeLessThan(0.12);
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
  try {
    await expect.poll(async () => (await playerPosition(page)).x).toBeLessThan(second.x - 5);
  } finally {
    await page.keyboard.up("ArrowLeft");
  }
});

test("follows the player with Phaser lerp and a deadzone", async ({ page }) => {
  await startGame(page);
  await expect.poll(async () => await cameraState(page), { timeout: 15_000 }).not.toBeNull();
  const initialCamera = (await cameraState(page))!;

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(100);

  const position = await playerPosition(page);
  const camera = (await cameraState(page))!;
  expect(position.x).toBeGreaterThan(initialCamera.x + 100);
  expect(camera.x).toBeGreaterThan(initialCamera.x + 5);
  expect(camera.x).toBeLessThan(position.x - 20);
  expect(camera.zoom).toBeCloseTo(CAMERA_SCALE, 2);
});

test("displays every player walk frame", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  const seen = new Set<string>();
  await page.keyboard.down("ArrowRight");
  try {
    for (let index = 0; index < 24; index += 1) {
      if (index === 10) {
        await page.keyboard.up("ArrowRight");
        await page.keyboard.down("ArrowLeft");
      }
      await page.waitForTimeout(40);
      const asset = await game.getAttribute("data-player-asset") ?? "";
      const frame = asset.match(/walk_[A-Z]+_(\d{2})\.png$/)?.[1];
      if (frame) seen.add(frame);
    }
  } finally {
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowLeft");
  }
  expect(seen).toEqual(new Set(["01", "02", "03", "04"]));
});

test("aims with the cursor and repeatedly fires while moving backward", async ({ page }) => {
  await startGame(page);

  const viewport = page.locator("#gameViewport");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Game viewport has no bounds");
  const aimX = bounds.x + bounds.width * 0.78;
  const aimY = bounds.y + bounds.height * 0.3;
  await page.mouse.move(aimX, aimY);
  const rightFacingAsset = /assets\/player\/(?:idle\/player_right\.png|walk\/E\/walk_E_\d{2}\.png)/;
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", rightFacingAsset);

  await page.keyboard.press("Space");
  await expect(page.locator("#statShots")).toHaveText("0");

  const start = await playerPosition(page);
  await page.keyboard.down("a");
  await page.mouse.down();
  await expect.poll(async () => Number(await page.locator("#statShots").textContent())).toBeGreaterThanOrEqual(2);

  const moving = await playerPosition(page);
  expect(moving.x).toBeLessThan(start.x - 20);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", rightFacingAsset);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-bullets"))).toBeGreaterThan(0);

  await page.mouse.up();
  await page.keyboard.up("a");
  const shotsAfterRelease = await page.locator("#statShots").textContent();
  await page.waitForTimeout(300);
  await expect(page.locator("#statShots")).toHaveText(shotsAfterRelease ?? "");
});

test("ignores manual pan and zoom gestures", async ({ page }) => {
  await startGame(page);

  const viewport = page.locator("#gameViewport");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Game viewport has no bounds");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const canvas = page.locator("#gameCanvas canvas");
  const initialPosition = await playerPosition(page);

  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -500);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centerX + 80, centerY + 50);
  await page.mouse.up({ button: "middle" });

  await expect(canvas).toHaveCSS("transform", "none");
  expect(await playerPosition(page)).toEqual(initialPosition);
});

test("spawns multiple enemies once another room is revealed", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await startGame(page);
  await setPlayerInvulnerable(page, true);

  const game = page.locator("#gameCanvas");
  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  await alignPlayerToDoor(page, door, direction);
  const key = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(key);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-active-monsters"))).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-spawners", /^[0-4]$/);
  await page.keyboard.up(key);
  await expect.poll(async () => Number(await game.getAttribute("data-rendered-monsters"))).toBeGreaterThanOrEqual(2);

  const seen = new Set<string>();
  const samples: string[] = [];
  for (let index = 0; index < 14; index += 1) {
    await page.waitForTimeout(50);
    const assets = await game.getAttribute("data-monster-assets") ?? "";
    samples.push(`${await game.getAttribute("data-rendered-monsters")}:${assets}`);
    for (const match of assets.matchAll(/frame_(\d{2})\.png/g)) seen.add(match[1]!);
  }
  expect(seen, `Page errors: ${pageErrors.join(" | ")}\nMonster asset samples: ${samples.join(" | ")}`).toEqual(new Set(["01", "02", "03", "04"]));
});

test("swaps temporary weapons, refills only from ammo cores, and falls back to pulse rifle", async ({ page }) => {
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><img style=\"display:none\" src=\"artifact.png\" alt=\"Secret armory\" /><section style=\"display:none\"><p>Backup cache</p></section><footer>fallback</footer></body></html>",
  }));
  await page.goto("/");
  await page.locator("#welcomeUrlInput").fill("https://example.com/weapons");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();

  const game = page.locator("#gameCanvas");
  await setPlayerInvulnerable(page, true);
  await expect(game).toHaveAttribute("data-weapon-kind", "pulse-rifle");
  await expect(game).toHaveAttribute("data-weapon-ammo", "infinite");

  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const start = await playerPosition(page);
  const target = {
    x: door.x + Math.sign(door.x - start.x || 1) * 32,
    y: door.y + Math.sign(door.y - start.y || 1) * 32,
  };
  await teleportPlayer(page, target);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);

  await expect(game).toHaveAttribute("data-available-weapons", /[1-9]/);
  await expect(game).toHaveAttribute("data-weapon-pedestals", /[1-9]/);
  const pedestalCount = await game.getAttribute("data-weapon-pedestals");

  const weaponTarget = {
    x: Number(await game.getAttribute("data-first-weapon-x")),
    y: Number(await game.getAttribute("data-first-weapon-y")),
  };
  await teleportPlayer(page, weaponTarget);
  await expect(game).not.toHaveAttribute("data-weapon-kind", "pulse-rifle");
  await expect(game).toHaveAttribute("data-weapon-pedestals", pedestalCount ?? "");

  const equippedKind = await game.getAttribute("data-weapon-kind");
  const startingAmmo = Number(await game.getAttribute("data-weapon-ammo"));
  expect(Number.isFinite(startingAmmo)).toBe(true);
  await setWeaponAmmo(page, Math.max(2, Math.min(startingAmmo, 4)));
  const reducedAmmo = Number(await game.getAttribute("data-weapon-ammo"));
  expect(reducedAmmo).toBeGreaterThanOrEqual(2);

  const lootBeforeSwap = await visibleLoot(page);
  const secondWeapon = lootBeforeSwap.find(item =>
    item.kind === "weapon" && Math.hypot(item.x - weaponTarget.x, item.y - weaponTarget.y) > 30
  );
  if (!secondWeapon) throw new Error("Expected a second weapon pickup for swap coverage");
  expect(secondWeapon.placement).toBe("pedestal");
  await teleportPlayer(page, { x: secondWeapon.x, y: secondWeapon.y });
  const swappedAmmoBeforeShot = Number(await game.getAttribute("data-weapon-ammo"));
  expect(swappedAmmoBeforeShot).toBeGreaterThan(0);

  const droppedWeapon = await lastDroppedWeapon(page);
  expect(droppedWeapon).toBeDefined();
  expect(droppedWeapon?.ammo).toBe(reducedAmmo);
  expect(droppedWeapon?.maxAmmo).toBe(startingAmmo);
  expect(droppedWeapon?.placement).toBe("floor");
  expect(droppedWeapon?.x).toBe(secondWeapon.x);
  expect(droppedWeapon?.y).toBe(secondWeapon.y);
  await expect(game).toHaveAttribute("data-weapon-ammo", String(swappedAmmoBeforeShot));

  const viewport = page.locator("#gameViewport");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Game viewport has no bounds");
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);
  await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);

  const volleyAfterShot = Number(await game.getAttribute("data-last-player-volley"));
  expect(volleyAfterShot).toBeGreaterThan(0);
  await expect.poll(async () => Number(await game.getAttribute("data-weapon-ammo"))).toBe(swappedAmmoBeforeShot - 1);
  await expect(game).toHaveAttribute("data-last-player-volley", String(volleyAfterShot));

  await teleportPlayer(page, { x: droppedWeapon!.x + 80, y: droppedWeapon!.y + 80 });
  await teleportPlayer(page, { x: droppedWeapon!.x, y: droppedWeapon!.y });
  await expect(game).toHaveAttribute("data-weapon-ammo", String(reducedAmmo));
  await expect(page.locator("#ammoCount")).toContainText(`${reducedAmmo} / ${startingAmmo}`);

  const ammoBeforeOrb = Number(await game.getAttribute("data-weapon-ammo"));
  const lootTarget = {
    x: Number(await game.getAttribute("data-first-loot-x")),
    y: Number(await game.getAttribute("data-first-loot-y")),
  };
  const lootKind = await game.getAttribute("data-first-loot-kind");
  await teleportPlayer(page, lootTarget);
  const replenishedAmmo = Number(await game.getAttribute("data-weapon-ammo"));
  if (lootKind === "core") {
    expect(replenishedAmmo).toBeGreaterThan(ammoBeforeOrb);
  } else {
    expect(replenishedAmmo).toBe(ammoBeforeOrb);
  }

  await setWeaponAmmo(page, 1);
  await expect(game).toHaveAttribute("data-weapon-ammo", "1");
  await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);
  await expect.poll(async () => await game.getAttribute("data-weapon-kind")).toBe("pulse-rifle");
  await expect.poll(async () => await game.getAttribute("data-weapon-ammo")).toBe("infinite");
  expect(equippedKind).not.toBe("pulse-rifle");
});
