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

async function visibleLoot(page: Page): Promise<Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null }>> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: {
        loot: () => Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null }>;
      };
    }).__webcrawlTest?.loot() ?? []
  );
}

async function lastDroppedWeapon(page: Page): Promise<{ id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null } | null> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: {
        lastDroppedWeapon: () => { id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null } | null;
      };
    }).__webcrawlTest?.lastDroppedWeapon() ?? null
  );
}

test("starts a crawl and renders a playable floor", async ({ page }) => {
  await startGame(page);
  await expect(page.locator("#gameViewport")).toHaveCSS("cursor", "crosshair");
  await page.keyboard.press("m");
  await expect(page.locator("#minimapModal")).toBeVisible();
  await expect(page.locator("#minimapCanvas")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#minimapModal")).toBeHidden();
});

test("keeps the Phaser viewport playable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await startGame(page);
  await expect(page.locator("#rightHud")).toBeHidden();
  const bounds = await page.locator("#gameViewport").boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(390);
  expect(bounds?.height).toBeGreaterThan(500);
});

test("activates a deterministic boss when revealing a script room", async ({ page }) => {
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><script>const boss = true;</script><main><h1>Boss deck</h1></main></body></html>",
  }));
  await page.goto("/");
  await page.locator("#welcomeUrlInput").fill("https://example.com/boss");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-active-bosses", "0");

  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const position = await playerPosition(page);
  const horizontal = door.x < position.x ? "ArrowLeft" : "ArrowRight";
  const vertical = door.y < position.y ? "ArrowUp" : "ArrowDown";
  const alignKey = direction === "N" || direction === "S" ? horizontal : vertical;
  const alignDistance = direction === "N" || direction === "S"
    ? Math.abs(door.x - position.x)
    : Math.abs(door.y - position.y);
  if (alignDistance > 8) {
    await page.keyboard.down(alignKey);
    await page.waitForTimeout(alignDistance / 400 * 1_000);
    await page.keyboard.up(alignKey);
  }
  const exitKey = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(exitKey);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up(exitKey);

  await expect(game).toHaveAttribute("data-active-bosses", "1");
  await expect(game).toHaveAttribute("data-active-boss-kind", /^(packet-storm|fork-bomb|heap-titan)$/);
  const initialBossPosition = {
    x: Number(await game.getAttribute("data-active-boss-x")),
    y: Number(await game.getAttribute("data-active-boss-y")),
  };
  const retreatKey = { N: "ArrowDown", E: "ArrowLeft", S: "ArrowUp", W: "ArrowRight" }[direction ?? "N"] ?? "ArrowDown";
  await page.keyboard.down(retreatKey);
  try {
    await expect.poll(async () => {
      const x = Number(await game.getAttribute("data-active-boss-x"));
      const y = Number(await game.getAttribute("data-active-boss-y"));
      return Math.hypot(x - initialBossPosition.x, y - initialBossPosition.y);
    }, { timeout: 8_000 }).toBeGreaterThan(12);
  } finally {
    await page.keyboard.up(retreatKey);
  }
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
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", /assets\/player_frames\/east\//);

  await page.keyboard.press("Space");
  await expect(page.locator("#statShots")).toHaveText("0");

  const start = await playerPosition(page);
  await page.keyboard.down("a");
  await page.mouse.down();
  await expect.poll(async () => Number(await page.locator("#statShots").textContent())).toBeGreaterThanOrEqual(2);

  const moving = await playerPosition(page);
  expect(moving.x).toBeLessThan(start.x - 20);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", /assets\/player_frames\/east\//);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-bullets"))).toBeGreaterThan(0);

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
  await startGame(page);

  const game = page.locator("#gameCanvas");
  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const position = await playerPosition(page);
  const horizontal = door.x < position.x ? "ArrowLeft" : "ArrowRight";
  const vertical = door.y < position.y ? "ArrowUp" : "ArrowDown";
  const alignKey = direction === "N" || direction === "S" ? horizontal : vertical;
  const alignDistance = direction === "N" || direction === "S"
    ? Math.abs(door.x - position.x)
    : Math.abs(door.y - position.y);
  if (alignDistance > 8) {
    await page.keyboard.down(alignKey);
    await page.waitForTimeout(alignDistance / 400 * 1000);
    await page.keyboard.up(alignKey);
  }
  const key = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(key);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-active-monsters"))).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-spawners", /^[0-4]$/);
  await page.keyboard.up(key);
});

test("swaps temporary weapons, refills only from orbs, and falls back to pulse rifle", async ({ page }) => {
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><img style=\"display:none\" src=\"artifact.png\" alt=\"Secret armory\" /><section style=\"display:none\"><p>Backup cache</p></section><footer>fallback</footer></body></html>",
  }));
  await page.goto("/");
  await page.locator("#welcomeUrlInput").fill("https://example.com/weapons");
  await page.getByRole("button", { name: "BEGIN CRAWL" }).click();

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-weapon-kind", "pulse-rifle");
  await expect(game).toHaveAttribute("data-weapon-ammo", "infinite");

  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const position = await playerPosition(page);
  const horizontal = door.x < position.x ? "ArrowLeft" : "ArrowRight";
  const vertical = door.y < position.y ? "ArrowUp" : "ArrowDown";
  const alignKey = direction === "N" || direction === "S" ? horizontal : vertical;
  const alignDistance = direction === "N" || direction === "S"
    ? Math.abs(door.x - position.x)
    : Math.abs(door.y - position.y);
  if (alignDistance > 8) {
    await page.keyboard.down(alignKey);
    await page.waitForTimeout(alignDistance / 400 * 1_000);
    await page.keyboard.up(alignKey);
  }
  const exitKey = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(exitKey);
  await expect.poll(async () => {
    const value = await page.locator("#statRooms").textContent();
    return Number(value?.split("/")[0]?.trim() ?? "0");
  }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up(exitKey);

  await expect(game).toHaveAttribute("data-available-weapons", /[1-9]/);

  const weaponTarget = {
    x: Number(await game.getAttribute("data-first-weapon-x")),
    y: Number(await game.getAttribute("data-first-weapon-y")),
  };
  await teleportPlayer(page, weaponTarget);
  await expect(game).not.toHaveAttribute("data-weapon-kind", "pulse-rifle");

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
  await teleportPlayer(page, { x: secondWeapon.x, y: secondWeapon.y });
  const swappedAmmoBeforeShot = Number(await game.getAttribute("data-weapon-ammo"));
  expect(swappedAmmoBeforeShot).toBeGreaterThan(0);

  const droppedWeapon = await lastDroppedWeapon(page);
  expect(droppedWeapon).toBeDefined();
  expect(droppedWeapon?.ammo).toBe(reducedAmmo);
  expect(droppedWeapon?.maxAmmo).toBe(startingAmmo);
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
  await expect.poll(async () => Number(await game.getAttribute("data-bullets"))).toBeGreaterThanOrEqual(volleyAfterShot);

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
  if (lootKind === "crystal" || lootKind === "core") {
    expect(replenishedAmmo).toBeGreaterThan(ammoBeforeOrb);
  } else {
    expect(replenishedAmmo).toBe(ammoBeforeOrb);
  }

  await setWeaponAmmo(page, 1);
  await expect(game).toHaveAttribute("data-weapon-ammo", "1");
  await page.waitForTimeout(1_100);
  await page.mouse.click(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.45);
  await expect.poll(async () => await game.getAttribute("data-weapon-kind")).toBe("pulse-rifle");
  await expect.poll(async () => await game.getAttribute("data-weapon-ammo")).toBe("infinite");
  expect(equippedKind).not.toBe("pulse-rifle");
});
