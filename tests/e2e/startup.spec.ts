import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOSS_CAMERA_SCALE, CAMERA_SCALE, MOBILE_CAMERA_SCALE, world } from "../../src/client/config";
import {
  PLAYER_DAMAGE_INVULNERABILITY_MS,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  WORLD_GEOMETRY,
} from "../../src/client/domain/specs";

async function stubRemoteFetchFallbacks(page: Page, body: string): Promise<void> {
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "text/html",
    body,
  }));
}

async function signIn(page: Page): Promise<void> {
  const signInButton = page.getByRole("button", { name: "Sign In" });
  await expect(signInButton).toBeVisible({ timeout: 15_000 });
  await signInButton.click();
  await expect(page.locator("#welcomeUrlInput")).toBeVisible();
}

async function startGame(page: Page, debug = false): Promise<void> {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  if (debug) {
    const index = fs.readFileSync(path.resolve("dist/client/index.html"), "utf8");
    const debugIndex = index.replace(
      "</head>",
      '<script>window.__WEBCRAWL_RUNTIME_CONFIG__={"debug":true};</script></head>',
    );
    await page.route("http://127.0.0.1:3000/", route => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: debugIndex,
    }));
  }
  await stubRemoteFetchFallbacks(page, fixture);
  await page.route("**/api/fetch?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fixture,
  }));
  await page.goto("/");

  await expect(page.locator("#welcomeScreen")).toBeVisible({ timeout: 15_000 });
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();

  await expect(page.locator("#gameUi")).toBeVisible();
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  // The renderer boots (and loads its texture atlas) before the world is
  // generated, so world attributes can lag the first canvas by several
  // seconds. 30s matches the app's own loading boot guard.
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-monsters", "0");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-visited-rooms", "1");
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
  await teleportPlayer(page, direction === "N" || direction === "S"
    ? { x: door.x, y: position.y }
    : { x: position.x, y: door.y + WORLD_GEOMETRY.verticalDoorPassableOffsetY });
}

async function cameraState(page: Page): Promise<{ x: number; y: number; zoom: number; bossRoomId: number | null } | null> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: { camera: () => { x: number; y: number; zoom: number; bossRoomId: number | null } | null };
    }).__webcrawlTest?.camera() ?? null
  );
}

async function screenPositionFor(page: Page, world: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const bounds = await page.locator("#gameViewport").boundingBox();
  if (!bounds) throw new Error("Game viewport unavailable");
  let camera = await cameraState(page);
  const deadline = Date.now() + 15_000;
  while (!camera && Date.now() < deadline) {
    await page.waitForTimeout(50);
    camera = await cameraState(page);
  }
  if (!camera) throw new Error("Camera unavailable");
  return {
    x: bounds.x + bounds.width / 2 + (world.x - camera.x) * camera.zoom,
    y: bounds.y + bounds.height / 2 + (world.y - camera.y) * camera.zoom,
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

async function spawnHealingEffect(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __webcrawlTest?: { spawnHealingEffect: () => void } }).__webcrawlTest?.spawnHealingEffect();
  });
}

async function playerFacing(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() =>
    (window as Window & {
      __webcrawlTest?: { playerFacing: () => { x: number; y: number } };
    }).__webcrawlTest?.playerFacing() ?? { x: 0, y: 0 }
  );
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

test("shows a GitHub repository badge on the welcome screen", async ({ page }) => {
  await page.goto("/");

  const badge = page.getByRole("link", { name: /view webcrawl on github/i });
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toHaveAttribute("href", "https://github.com/Idorobots/WebCrawl");
  await expect(badge).toHaveAttribute("target", "_blank");
  await expect(badge).toHaveAttribute("rel", "noopener noreferrer");

  const bounds = await badge.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeGreaterThan(viewport!.width - 80);
  expect(bounds!.y).toBeLessThan(20);
});

test("starts a lucky crawl from Wikipedia's random page", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.route("https://en.wikipedia.org/**", route => route.abort());
  await page.route("https://en.wikipedia.org/w/api.php**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "application/json",
    body: JSON.stringify({ query: { random: [{ id: 1, ns: 0, title: "Example article" }] } }),
  }));
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    headers: { "x-webcrawl-final-url": "https://en.wikipedia.org/wiki/Example_article" },
    contentType: "text/html",
    body: fixture,
  }));
  await page.goto("/");
  await signIn(page);

  await page.getByRole("button", { name: "I'm feeling lucky" }).click();

  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(page.locator("#urlBarText")).toHaveText("https://en.wikipedia.org/wiki/Example_article", { timeout: 30_000 });
});

test("starts a lucky crawl from a Hacker News top story", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.addInitScript(() => {
    Math.random = () => 0.75;
  });
  await page.route("https://hacker-news.firebaseio.com/v0/topstories.json", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "application/json",
    body: JSON.stringify([101, 202]),
  }));
  await page.route("https://hacker-news.firebaseio.com/v0/item/202.json", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "application/json",
    body: JSON.stringify({ url: "https://example.com/lucky" }),
  }));
  await page.route("https://example.com/lucky", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "text/html",
    body: fixture,
  }));
  await page.goto("/");
  await signIn(page);

  await page.getByRole("button", { name: "I'm feeling lucky" }).click();

  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(page.locator("#urlBarText")).toHaveText("https://example.com/lucky", { timeout: 30_000 });
});

test("starts a crawl and renders a playable floor", async ({ page }) => {
  const failedAssets: string[] = [];
  page.on("response", response => {
    if (response.url().includes("/assets/") && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await startGame(page);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-debug-mode", "false");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-max-hp", String(PLAYER_SPEC.maxHp));
  expect(await playerHp(page)).toBe(PLAYER_SPEC.maxHp);
  await expect.poll(() => page.locator("#playerHudPortrait").evaluate(image =>
    (image as HTMLImageElement).naturalWidth
  )).toBeGreaterThan(0);
  expect(failedAssets).toEqual([]);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-portals", "1");
  await expect(page.locator("#gameViewport")).toHaveCSS("cursor", "crosshair");
  await expect(page.locator("#rightHud")).toBeVisible();
  await expect(page.locator("#rightHud")).toContainText("FLOOR 1");
  const minimap = page.locator("#sideMinimapCanvas");
  await expect(minimap).toBeVisible();
  await expect.poll(() => minimap.evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(1);
  await page.keyboard.press("m");
  await expect(page.locator('[role="dialog"][aria-label*="map" i]')).toHaveCount(0);
  await expect(minimap).toBeVisible();
});

test("starts with 1000 HP when server debug mode is enabled", async ({ page }) => {
  await startGame(page, true);
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-debug-mode", "true");
  await expect(game).toHaveAttribute("data-player-max-hp", "1000");
  await expect(game).toHaveAttribute("data-player-hp", "1000");
  expect(await playerHp(page)).toBe(1_000);
});

test("reports the configured collision-debug state", async ({ page }) => {
  await startGame(page);
  await expect(page.locator("#gameCanvas")).toHaveAttribute(
    "data-debug-hitboxes",
    process.env.VITE_DEBUG_HITBOXES === "true" ? "true" : "false",
  );
});

test("renders ambient lighting and aims the elliptical flashlight at the cursor", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await startGame(page);
  await page.waitForTimeout(100);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-lighting-mode", "webgl", { timeout: 15_000 });
  await expect(game).toHaveAttribute("data-ambient-light", "07121c");
  await expect(game).toHaveAttribute("data-aura-mode", "light2d");
  await expect(game).toHaveAttribute("data-aura-flicker", "false");
  await expect(game).toHaveAttribute("data-max-lights", "4");
  await expect(game).toHaveAttribute("data-portal-down-aura-color", "ff4dff");
  await expect(game).toHaveAttribute("data-portal-up-aura-color", "4da6ff");
  await expect(game).toHaveAttribute("data-bullet-glow-mode", "batched-light2d");
  await expect(game).toHaveAttribute("data-bullet-shape", "bar");
  await expect(game).toHaveAttribute("data-flicker-mode", "occasional-burst-35ms");
  await expect(game).toHaveAttribute("data-flashlight-color", "ffffff");
  await expect(game).toHaveAttribute("data-flashlight-radius-scale", "0.8");
  await expect(game).toHaveAttribute("data-player-light", "true");
  await expect.poll(async () => Number(await game.getAttribute("data-room-lights"))).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await game.getAttribute("data-corridor-lights"))).toBeGreaterThan(0);
  const roomIntensities = (await game.getAttribute("data-room-light-intensities") ?? "").split(",");
  expect(new Set(roomIntensities).size).toBeGreaterThan(1);
  expect(Number(await game.getAttribute("data-full-room-lights"))).toBeGreaterThanOrEqual(roomIntensities.length / 2);
  expect(Number(await game.getAttribute("data-root-room-light-intensity"))).toBeGreaterThanOrEqual(0.8);
  const roomRadii = (await game.getAttribute("data-room-light-radii") ?? "").split(",").map(Number);
  expect(Math.max(...roomRadii) / Math.min(...roomRadii)).toBeGreaterThan(1.5);
  await expect.poll(async () => Number(await game.getAttribute("data-pickup-auras"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await game.getAttribute("data-scenery-shadows"))).toBeGreaterThan(0);

  const position = await playerPosition(page);
  const viewport = await page.locator("#gameViewport").boundingBox();
  if (!viewport) throw new Error("Game viewport unavailable");
  const nearAim = await screenPositionFor(page, { x: position.x + world(36), y: position.y });
  await page.mouse.move(nearAim.x, nearAim.y);
  await expect(game).toHaveAttribute("data-flashlight-active", "true");
  const nearMajorRadius = Number(await game.getAttribute("data-flashlight-major-radius"));
  const nearMinorRadius = Number(await game.getAttribute("data-flashlight-minor-radius"));
  expect(nearMinorRadius / nearMajorRadius).toBeGreaterThan(0.85);
  await page.mouse.move(viewport.x + viewport.width * 0.75, viewport.y + viewport.height * 0.4);
  await expect(game).toHaveAttribute("data-flashlight-active", "true");
  await expect.poll(async () => Number(await game.getAttribute("data-flashlight-target-x"))).toBeGreaterThan(position.x);
  expect(Number(await game.getAttribute("data-flashlight-major-radius"))).toBeGreaterThan(world(190));

  await damagePlayer(page, 1);
  expect(Number(await game.getAttribute("data-effect-lights"))).toBeGreaterThan(0);
  await spawnHealingEffect(page);
  await expect(game).toHaveAttribute("data-last-effect", /effects\/healing\/frame_01\.png$/);
  await expect(game).toHaveAttribute("data-effect-sprite-mode", "emissive");
  await expect(game).toHaveAttribute("data-following-effects", "1");
  const movedEffect = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#gameCanvas")!;
    const api = (window as Window & {
      __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void };
    }).__webcrawlTest;
    const beforeX = Number(host.dataset.playerX);
    const beforeY = Number(host.dataset.playerY);
    api?.teleportPlayerTo(beforeX + 4, beforeY);
    return {
      beforeX,
      playerX: Number(host.dataset.playerX),
      playerY: Number(host.dataset.playerY),
      effectX: Number(host.dataset.followingEffectX),
      effectY: Number(host.dataset.followingEffectY),
    };
  });
  expect(movedEffect.playerX).toBeGreaterThan(movedEffect.beforeX);
  expect(movedEffect.effectX).toBe(movedEffect.playerX);
  expect(movedEffect.effectY).toBe(movedEffect.playerY);
});

test("uses crystals for temporary invulnerability without counting supplies as score loot", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await expect(page.locator("#creditCount")).toHaveText("0");
  await expect(page.locator("#crystalCount")).toHaveText("0");
  await expect(page.locator("#coreCount")).toHaveText("0");
  await expect(game).toHaveAttribute("data-energy", "0");
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

test("ignores repeated damage for 200ms after taking a hit", async ({ page }) => {
  await startGame(page);
  const initialHp = await playerHp(page);

  // Both hits must land inside one evaluate: the first damage spawns an
  // effect light, which makes Phaser recompile its light pipeline and can
  // stall the main thread past the 200ms window between CDP roundtrips.
  const hpAfterBurst = await page.evaluate((initial) => {
    const api = (window as Window & {
      __webcrawlTest?: { damagePlayer: (amount: number) => void; playerHp: () => number };
    }).__webcrawlTest;
    api?.damagePlayer(2);
    api?.damagePlayer(2);
    return api?.playerHp() ?? initial;
  }, initialHp);
  expect(hpAfterBurst).toBe(initialHp - 2);

  await page.waitForTimeout(PLAYER_DAMAGE_INVULNERABILITY_MS + 50);
  await damagePlayer(page, 2);
  expect(await playerHp(page)).toBe(initialHp - 4);
});

test("charges energy and launches an invulnerable energy dash with right click", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await grantEnergy(page, 5);
  await expect(game).toHaveAttribute("data-energy", "5");
  await expect(page.locator("#energyLootCount")).toHaveText("5");

  const before = await playerPosition(page);
  const aim = await screenPositionFor(page, { x: before.x + world(120), y: before.y });
  await page.mouse.move(aim.x, aim.y);
  await page.mouse.down({ button: "right" });
  await expect.poll(async () => await game.getAttribute("data-player-dashing"), {
    timeout: 3_000,
    intervals: [15],
  }).toBe("true");
  await page.mouse.up({ button: "right" });

  await expect.poll(async () => game.getAttribute("data-player-dashing"), {
    timeout: 5_000,
    intervals: [50],
  }).toBe("false");
  await expect.poll(async () => {
    const position = await playerPosition(page);
    return position.x !== before.x || position.y !== before.y;
  }, { timeout: 5_000, intervals: [50] }).toBe(true);
  await expect(page.locator("#energyLootCount")).toHaveText("0");
  await expect(game).toHaveAttribute("data-energy", "0");
});

test("restores the previous floor from its snapshot without re-fetching it", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-floor", "1");
  const startRooms = await game.getAttribute("data-rooms");

  await page.evaluate(() => {
    void (window as Window & {
      __webcrawlTest?: { navigate: (url: string) => Promise<void> };
    }).__webcrawlTest?.navigate("https://example.com/next");
  });
  await expect(game).toHaveAttribute("data-floor", "2");

  // The previous floor must not be re-fetched when going back: if the game
  // tries to reload it, this route aborts and the level load fails.
  await page.route("**/api/fetch?*", route => route.abort());
  await page.route("https://example.com/**", route => route.abort());

  await page.evaluate(() => {
    void (window as Window & {
      __webcrawlTest?: { goBack: () => Promise<void> };
    }).__webcrawlTest?.goBack();
  });
  await expect(game).toHaveAttribute("data-floor", "1", { timeout: 10_000 });
  await expect(game).toHaveAttribute("data-rooms", startRooms ?? "");
  await expect(game).toHaveAttribute("data-visited-rooms", "1");

  // Descending into the same page again must reuse its stored level too.
  await page.evaluate(() => {
    void (window as Window & {
      __webcrawlTest?: { navigate: (url: string) => Promise<void> };
    }).__webcrawlTest?.navigate("https://example.com/next");
  });
  await expect(game).toHaveAttribute("data-floor", "2", { timeout: 10_000 });
});

test("spawns on an enabled entry portal without immediately retriggering it", async ({ page }) => {
  await startGame(page);
  const game = page.locator("#gameCanvas");
  const position = await playerPosition(page);
  const aim = await screenPositionFor(page, { x: position.x + world(120), y: position.y });
  await page.mouse.move(aim.x, aim.y);
  await expect(game).toHaveAttribute("data-flashlight-active", "true");
  await page.evaluate(() => {
    void (window as Window & {
      __webcrawlTest?: { navigate: (url: string) => Promise<void> };
    }).__webcrawlTest?.navigate("https://example.com/next");
  });
  await expect(game).toHaveAttribute("data-floor", "2");
  await expect(game).toHaveAttribute("data-flashlight-active", "true");

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
    x: Math.round(entryPortal.x + PORTAL_DEFINITION.spawnOffset.x),
    y: Math.round(entryPortal.y + PORTAL_DEFINITION.spawnOffset.y),
  });
  expect(state.contacts).not.toContain(entryPortal.id);
  await page.waitForTimeout(500);
  await expect(game).toHaveAttribute("data-floor", "2");
});

test("keeps the Phaser viewport playable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await startGame(page);
  await expect(page.locator("#rightHud")).toBeVisible();
  await expect(page.locator("#topBarStats")).toBeVisible();
  await expect(page.locator("#urlBar")).toBeHidden();
  await expect(page.locator("#bottomHud")).toBeHidden();
  const bounds = await page.locator("#gameViewport").boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(390);
  expect(bounds?.height).toBeGreaterThan(500);
});

test("fits the welcome prompt on mobile portrait and landscape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signIn(page);

  const panel = page.locator("#promptLayout .welcome-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#promptLayout .welcome-header-dim")).toBeHidden();
  await page.waitForTimeout(450);

  const titlebar = await page.locator(".welcome-titlebar").boundingBox();
  const visual = await page.locator(".welcome-visual").boundingBox();
  expect(visual).not.toBeNull();
  expect(visual!.y).toBeGreaterThanOrEqual((titlebar?.y ?? 0) + (titlebar?.height ?? 0));

  const portrait = await panel.boundingBox();
  expect(portrait!.x).toBeGreaterThanOrEqual(0);
  expect(portrait!.x + portrait!.width).toBeLessThanOrEqual(390);

  const go = await page.getByRole("button", { name: "Go" }).boundingBox();
  const lucky = await page.getByRole("button", { name: "I'm feeling lucky" }).boundingBox();
  expect(Math.round(go!.y)).toBe(Math.round(lucky!.y));
  expect(Math.round(go!.height)).toBe(Math.round(lucky!.height));

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(450);
  const landscape = await panel.boundingBox();
  expect(landscape!.height).toBeGreaterThan(150);
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
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });

  expect({
    player: await playerPosition(page),
    doorX: await page.locator("#gameCanvas").getAttribute("data-first-door-x"),
    doorY: await page.locator("#gameCanvas").getAttribute("data-first-door-y"),
  }).toEqual(desktop);
});

test("keeps an active boss sized consistently while it follows the player out", async ({ page }) => {
  test.setTimeout(90_000);
  const bossFixture = "<!doctype html><html><body><script>const boss = true;</script><main><h1>Boss deck</h1></main></body></html>";
  await stubRemoteFetchFallbacks(page, bossFixture);
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: bossFixture,
  }));
  await page.goto("/");
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/boss");
  await page.getByRole("button", { name: "Go" }).click();
  const game = page.locator("#gameCanvas");
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(game).toHaveAttribute("data-rooms", /^\d+$/, { timeout: 30_000 });
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
    const value = await game.getAttribute("data-visited-rooms");
    return Number(value ?? "0");
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up(exitKey);

  await expect(game).toHaveAttribute("data-active-bosses", "1");
  await expect(game).toHaveAttribute("data-active-boss-kind", /^(packet-storm|fork-bomb|heap-titan|kimi-swarm|llama-herd)$/);
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
  await expect(game).toHaveAttribute("data-boss-room-lights", "1");
  await expect(game).toHaveAttribute("data-boss-room-light-color", "ff3d42");
  expect(Number(await game.getAttribute("data-boss-room-light-intensity"))).toBeGreaterThanOrEqual(1.3);
  await page.keyboard.up(exitKey);
  await expect.poll(async () => {
    const camera = await cameraState(page);
    return camera && {
      zoomedOut: Math.abs(camera.zoom - BOSS_CAMERA_SCALE) < 0.01,
      bossRoom: camera.bossRoomId !== null,
    };
  }).toEqual({ zoomedOut: true, bossRoom: true });
  await page.setViewportSize({ width: 390, height: 720 });
  await expect.poll(async () => {
    const camera = await cameraState(page);
    return camera && {
      zoomedOut: Math.abs(camera.zoom - BOSS_CAMERA_SCALE * MOBILE_CAMERA_SCALE) < 0.01,
    };
  }).toEqual({ zoomedOut: true });
  const initialBossPosition = {
    x: Number(await game.getAttribute("data-active-boss-x")),
    y: Number(await game.getAttribute("data-active-boss-y")),
  };
  await teleportPlayer(page, position);
  await expect(game).toHaveAttribute("data-current-room-tag", "body");
  await expect.poll(async () => await cameraState(page)).toMatchObject({ zoom: MOBILE_CAMERA_SCALE, bossRoomId: null });
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

test("centers the camera one third of the way from the player to the cursor", async ({ page }) => {
  await startGame(page);
  await expect.poll(async () => await cameraState(page), { timeout: 15_000 }).not.toBeNull();
  const viewport = await page.locator("#gameViewport").boundingBox();
  if (!viewport) throw new Error("Game viewport unavailable");
  const cursor = {
    x: viewport.x + viewport.width / 2 + 120,
    y: viewport.y + viewport.height / 2 - 60,
  };
  await page.mouse.move(cursor.x, cursor.y);

  await expect.poll(async () => {
    const position = await playerPosition(page);
    const camera = (await cameraState(page))!;
    const cursorWorld = {
      x: camera.x + (cursor.x - viewport.x - viewport.width / 2) / camera.zoom,
      y: camera.y + (cursor.y - viewport.y - viewport.height / 2) / camera.zoom,
    };
    return Math.hypot(
      camera.x - (position.x * 2 + cursorWorld.x) / 3,
      camera.y - (position.y * 2 + cursorWorld.y) / 3,
    );
  }, { timeout: 5_000 }).toBeLessThan(4);
  expect((await cameraState(page))!.zoom).toBeCloseTo(CAMERA_SCALE, 2);
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

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-lighting-mode", "webgl", { timeout: 15_000 });
  const aimFrom = await playerPosition(page);
  const aim = await screenPositionFor(page, { x: aimFrom.x + world(120), y: aimFrom.y });
  await page.mouse.move(aim.x, aim.y);
  const rightFacingAsset = /assets\/player\/(?:idle\/player_right\.png|walk\/E\/walk_E_\d{2}\.png)/;
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", rightFacingAsset);

  await page.keyboard.press("Space");
  await expect(game).toHaveAttribute("data-shots-fired", "0");

  const start = await playerPosition(page);
  await page.keyboard.down("a");
  await page.mouse.down();
  await expect.poll(async () => Number(await game.getAttribute("data-shots-fired"))).toBeGreaterThanOrEqual(2);

  const moving = await playerPosition(page);
  expect(moving.x).toBeLessThan(start.x - 20);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-asset", rightFacingAsset);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-bullets"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-bullet-glows"))).toBeGreaterThan(0);
  await expect(game).toHaveAttribute("data-bullet-shape", "bar");
  await expect.poll(async () => Number(await game.getAttribute("data-bullet-lights"))).toBeGreaterThan(0);
  const viewport = await page.locator("#gameViewport").boundingBox();
  if (!viewport) throw new Error("Game viewport unavailable");
  await expect.poll(async () => {
    const camera = (await cameraState(page))!;
    const position = await playerPosition(page);
    const cursorWorld = {
      x: camera.x + (aim.x - viewport.x - viewport.width / 2) / camera.zoom,
      y: camera.y + (aim.y - viewport.y - viewport.height / 2) / camera.zoom,
    };
    const center = { x: position.x, y: position.y + PLAYER_SPEC.visualCenterOffsetY };
    const expectedMagnitude = Math.hypot(cursorWorld.x - center.x, cursorWorld.y - center.y);
    const facing = await playerFacing(page);
    return facing.x * (cursorWorld.x - center.x) / expectedMagnitude +
      facing.y * (cursorWorld.y - center.y) / expectedMagnitude;
  }).toBeGreaterThan(0.995);

  await page.mouse.up();
  await page.keyboard.up("a");
  const shotsAfterRelease = await game.getAttribute("data-shots-fired");
  await page.waitForTimeout(300);
  await expect(game).toHaveAttribute("data-shots-fired", shotsAfterRelease ?? "");
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
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await startGame(page);
  await setPlayerInvulnerable(page, true);

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-lighting-mode", "webgl", { timeout: 15_000 });
  const direction = await game.getAttribute("data-first-exit");
  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  await alignPlayerToDoor(page, door, direction);
  const key = { N: "ArrowUp", E: "ArrowRight", S: "ArrowDown", W: "ArrowLeft" }[direction ?? "N"] ?? "ArrowUp";
  await page.keyboard.down(key);
  await expect.poll(async () => {
    const value = await game.getAttribute("data-visited-rooms");
    return Number(value ?? "0");
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(
    async () => Number(await page.locator("#gameCanvas").getAttribute("data-active-monsters")),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-active-spawners", /^[0-4]$/);
  await page.keyboard.up(key);
  await expect.poll(
    async () => Number(await game.getAttribute("data-rendered-monsters")),
    { timeout: 15_000 },
  ).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await game.getAttribute("data-enemy-auras"))).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Number(await game.getAttribute("data-monster-shadows"))).toBeGreaterThanOrEqual(2);

  const seen = new Set<string>();
  const samples: string[] = [];
  const animationDeadline = Date.now() + 5_000;
  while (seen.size < 4 && Date.now() < animationDeadline) {
    await page.waitForTimeout(50);
    const assets = await game.getAttribute("data-monster-assets") ?? "";
    samples.push(`${await game.getAttribute("data-rendered-monsters")}:${assets}`);
    for (const match of assets.matchAll(/frame_(\d{2})\.png/g)) seen.add(match[1]!);
  }
  expect(
    seen.size,
    `Page errors: ${pageErrors.join(" | ")}\nMonster asset samples: ${samples.join(" | ")}`,
  ).toBeGreaterThanOrEqual(3);
  expect([...seen].every(frame => ["01", "02", "03", "04"].includes(frame))).toBe(true);
});

test("swaps temporary weapons, refills only from ammo cores, and falls back to pulse rifle", async ({ page }) => {
  test.setTimeout(90_000);
  const weaponFixture = "<!doctype html><html><body><img style=\"display:none\" src=\"artifact.png\" alt=\"Secret armory\" /><section style=\"display:none\"><p>Backup cache</p></section><footer>fallback</footer></body></html>";
  await stubRemoteFetchFallbacks(page, weaponFixture);
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: weaponFixture,
  }));
  await page.goto("/");
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/weapons");
  await page.getByRole("button", { name: "Go" }).click();

  const game = page.locator("#gameCanvas");
  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(game).toHaveAttribute("data-rooms", /^\d+$/, { timeout: 30_000 });
  await setPlayerInvulnerable(page, true);
  await expect(game).toHaveAttribute("data-weapon-kind", "pulse-rifle");
  await expect(game).toHaveAttribute("data-weapon-ammo", "infinite");

  const door = {
    x: Number(await game.getAttribute("data-first-door-x")),
    y: Number(await game.getAttribute("data-first-door-y")),
  };
  const start = await playerPosition(page);
  const direction = await game.getAttribute("data-first-exit");
  const target = {
    x: door.x + Math.sign(door.x - start.x || 1) * 32,
    y: direction === "E" || direction === "W"
      ? door.y + WORLD_GEOMETRY.verticalDoorPassableOffsetY
      : door.y + Math.sign(door.y - start.y || 1) * 32,
  };
  await teleportPlayer(page, target);
  await expect.poll(async () => {
    const value = await game.getAttribute("data-visited-rooms");
    return Number(value ?? "0");
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

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

  const firingOffset = {
    x: secondWeapon.x + world(120),
    y: secondWeapon.y + world(0),
  };
  const gunTarget = await screenPositionFor(page, firingOffset);
  await page.mouse.move(gunTarget.x, gunTarget.y);
  await page.mouse.click(gunTarget.x, gunTarget.y);

  const volleyAfterShot = Number(await game.getAttribute("data-last-player-volley"));
  expect(volleyAfterShot).toBeGreaterThan(0);
  await expect.poll(async () => Number(await game.getAttribute("data-weapon-ammo"))).toBe(swappedAmmoBeforeShot - 1);
  await expect(game).toHaveAttribute("data-last-player-volley", String(volleyAfterShot));

  await teleportPlayer(page, { x: droppedWeapon!.x + 80, y: droppedWeapon!.y + 80 });
  await teleportPlayer(page, { x: droppedWeapon!.x, y: droppedWeapon!.y });
  await expect(game).toHaveAttribute("data-weapon-ammo", String(reducedAmmo));

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
  const fallbackAimFrom = await playerPosition(page);
  const fallbackAim = await screenPositionFor(page, { x: fallbackAimFrom.x + world(120), y: fallbackAimFrom.y });
  await page.mouse.click(fallbackAim.x, fallbackAim.y);
  await expect.poll(async () => await game.getAttribute("data-weapon-kind")).toBe("pulse-rifle");
  await expect.poll(async () => await game.getAttribute("data-weapon-ammo")).toBe("infinite");
  expect(equippedKind).not.toBe("pulse-rifle");
});

test("loads a page directly when the site allows CORS, without hitting the relay server", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "text/html",
    body: fixture,
  }));
  let relayHits = 0;
  await page.route("**/api/fetch?**", route => {
    relayHits += 1;
    route.fulfill({ status: 200, contentType: "text/html", body: fixture });
  });
  await page.goto("/");
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });
  expect(relayHits).toBe(0);
});

test("shows the ClosedNS Code loading session while fetching a page", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("https://example.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "text/html",
      body: fixture,
    });
  });
  await page.goto("/?loading-screen");
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();

  const loading = page.locator("#loadingScreen");
  await expect(loading).toBeVisible();
  await expect(page.locator("#loadingPromptText")).toContainText("webcrawl https://example.com/start");
  await expect(page.locator("#loadingThought")).not.toBeEmpty();
  const tasks = page.locator("#loadingTasks .loading-task");
  await expect(tasks).toHaveCount(4);
  await expect(tasks.nth(0)).toHaveAttribute("data-task", "fetch");
  await expect(tasks.nth(1)).toHaveAttribute("data-task", "phaser");
  await expect(tasks.nth(2)).toHaveAttribute("data-task", "generate");
  await expect(tasks.nth(3)).toHaveAttribute("data-task", "boot");
  await expect(page.locator('[data-task="fetch"] .loading-task-label')).toHaveText("Fetching the page");
  await expect(page.locator('[data-task="phaser"] .loading-task-label')).toHaveText("Fetching Phaser");
  await expect(page.locator('[data-task="generate"] .loading-task-label')).toHaveText("Generating level");
  await expect(page.locator('[data-task="boot"] .loading-task-label')).toHaveText("Booting the renderer");

  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });
  await expect(loading).not.toBeVisible({ timeout: 30_000 });
});

test("pauses the game while teleporting through a portal", async ({ page }) => {
  test.setTimeout(90_000);
  await startGame(page);
  const game = page.locator("#gameCanvas");
  await setPlayerInvulnerable(page, true);

  const portal = await page.evaluate(() => {
    const api = (window as Window & {
      __webcrawlTest?: {
        stairs: () => Array<{ id: string; type: string; x: number; y: number }>;
      };
    }).__webcrawlTest;
    return (api?.stairs() ?? []).find(stair => stair.type === "down") ?? null;
  });
  if (!portal) throw new Error("Expected an enabled down portal on floor one");

  const contactX = portal.x + PORTAL_DEFINITION.contactOffset.x;
  const contactY = portal.y + PORTAL_DEFINITION.contactOffset.y;
  await teleportPlayer(page, {
    x: contactX,
    y: contactY + PORTAL_DEFINITION.contactRadius.y + 12,
  });
  await page.keyboard.down("ArrowUp");

  await expect.poll(
    async () => await game.getAttribute("data-game-paused"),
    { timeout: 30_000 },
  ).toBe("true");
  await page.keyboard.up("ArrowUp");
  await expect.poll(
    async () => await game.getAttribute("data-game-paused"),
    { timeout: 15_000 },
  ).toBe("false");
  await expect.poll(
    async () => await game.getAttribute("data-floor"),
    { timeout: 15_000 },
  ).toBe("2");
});

test("starts a lucky crawl after an error returns to the welcome screen", async ({ page }) => {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.route("https://en.wikipedia.org/**", route => route.abort());
  await page.route("**/api/fetch?**", route => route.abort());
  await page.route("https://cors.io/**", route => route.abort());
  await page.goto("/");
  await signIn(page);

  const lucky = page.getByRole("button", { name: "I'm feeling lucky" });
  await lucky.click();

  const modal = page.locator("#fetchErrorModal");
  await expect(modal).toBeVisible();
  await page.getByRole("button", { name: "UNDERSTOOD" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator("#welcomeScreen")).toBeVisible();

  await expect(lucky).toBeEnabled();

  await page.route("https://en.wikipedia.org/w/api.php**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "application/json",
    body: JSON.stringify({ query: { random: [{ id: 1, ns: 0, title: "Example article" }] } }),
  }));
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    headers: { "x-webcrawl-final-url": "https://en.wikipedia.org/wiki/Example_article" },
    contentType: "text/html",
    body: fixture,
  }));
  await lucky.click();

  await expect(page.locator("#gameCanvas canvas")).toBeVisible();
  await expect(page.locator("#urlBarText")).toHaveText("https://en.wikipedia.org/wiki/Example_article", { timeout: 30_000 });
});

test("rescales the game when the viewport is resized", async ({ page }) => {
  await startGame(page);
  const host = page.locator("#gameCanvas");
  const canvas = page.locator("#gameCanvas canvas");

  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  await page.setViewportSize({ width: 700, height: 900 });

  // The canvas buffer must track the host size and the canvas must fill the
  // host again (previously a stale inline style kept the boot-time size).
  await expect.poll(async () => {
    const [hostBox, canvasBox] = await Promise.all([host.boundingBox(), canvas.boundingBox()]);
    if (!hostBox || !canvasBox) return null;
    return {
      width: Math.round(canvasBox.width),
      height: Math.round(canvasBox.height),
      hostWidth: Math.round(hostBox.width),
      hostHeight: Math.round(hostBox.height),
      bufferWidth: await canvas.evaluate((element) => (element as HTMLCanvasElement).width),
      bufferHeight: await canvas.evaluate((element) => (element as HTMLCanvasElement).height),
    };
  }).toEqual({
    width: 700,
    height: 900,
    hostWidth: 700,
    hostHeight: 900,
    bufferWidth: Math.round(700 * dpr),
    bufferHeight: Math.round(900 * dpr),
  });
});

test("shows the could-not-load modal when every fetch route fails", async ({ page }) => {
  await page.route("https://example.com/**", route => route.abort());
  await page.route("**/api/fetch?**", route => route.abort());
  await page.route("https://cors.io/**", route => route.abort());
  await page.goto("/?loading-screen");
  await signIn(page);
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();
  const modal = page.locator("#fetchErrorModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#loadingScreen")).not.toBeVisible();
  await expect(page.locator("#fetchErrorMessage")).toContainText("https://example.com/start");
  await page.getByRole("button", { name: "UNDERSTOOD" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator("#welcomeScreen")).toBeVisible();
  await expect(page.locator("#gameUi")).not.toBeVisible();
  await expect(page.locator("#welcomeUrlInput")).toHaveValue("https://example.com/start");
});
