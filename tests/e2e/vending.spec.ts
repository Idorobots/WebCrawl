import { expect, test, type Page } from "@playwright/test";
import type { Decoration } from "../../src/client/types";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";

test.describe.configure({ timeout: 90_000 });

type Machine = Pick<Decoration, "id" | "x" | "y" | "kind" | "obstacle" | "destructible" | "vendingCapacity" | "vendingRemaining" | "destroyed" | "dropKind"> & { price: number };
interface TestWindow extends Window {
  __webcrawlTest: {
    teleportPlayerTo: (x: number, y: number) => void;
    grantRam: (count: number) => void;
    grantEnergy: (count: number) => void;
    dashing: () => boolean;
    vendingMachines: () => Machine[];
    playerHp: () => number;
    loot: () => Array<{ id: string; kind: string; x: number; y: number }>;
    navigate: (url: string) => Promise<void>;
    goBack: () => Promise<void>;
    camera: () => { x: number; y: number; zoom: number };
  };
  __webcrawlScene: import("phaser").Scene;
}

async function startGame(page: Page): Promise<Machine> {
  await page.addInitScript(key => localStorage.setItem(key, "none"), LIGHT_DETAIL_STORAGE_KEY);
  const html = "<html><body>Vending test</body></html>";
  await page.route("**/api/fetch?**", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: html,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  // This room hash generates an ammo machine with four items and a successful destruction drop.
  await page.locator("#welcomeUrlInput").fill("https://example.com/vending-61");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "1", { timeout: 30_000 });
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-portal-intro", "false", { timeout: 15_000 });
  const item = await machine(page);
  expect(item).toMatchObject({ vendingCapacity: 4, vendingRemaining: 4, dropKind: "core", price: 10 });
  const labelCount = await page.evaluate(id => {
    const container = (window as unknown as TestWindow).__webcrawlScene.children.getByName(`vending:${id}`) as import("phaser").GameObjects.Container;
    return container.list.filter(child => child.type === "Text").length;
  }, item.id);
  expect(labelCount).toBe(0);
  return item;
}

async function machine(page: Page): Promise<Machine> {
  return page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.vendingMachines()[0]!);
}

async function positionPlayer(page: Page, item: Machine, distance: number): Promise<void> {
  await page.evaluate(({ x, y }) => (window as unknown as TestWindow).__webcrawlTest.teleportPlayerTo(x, y), {
    x: item.x + distance, y: item.y,
  });
  await expect.poll(async () => Number(await page.locator("#gameCanvas").getAttribute("data-player-x"))).toBeCloseTo(item.x + distance, 0);
  // Give contact tracking a frame to observe the separation.
  await page.waitForTimeout(50);
  const preview = page.locator("#vendingPreview");
  const current = await machine(page);
  if (distance <= 112 && !current.destroyed && current.vendingRemaining) {
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText(`$${item.price}`);
  } else {
    await expect(preview).toBeHidden();
  }
}

async function bump(page: Page, remaining: number): Promise<void> {
  // Release within the vend's frame so a slow test runner cannot keep walking
  // through the machine after depletion and accidentally collect its drop.
  await page.evaluate(targetStock => {
    const target = window as unknown as TestWindow;
    const stopWhenVended = (): void => {
      if (target.__webcrawlTest.vendingMachines()[0]?.vendingRemaining !== targetStock) return;
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA", key: "a", bubbles: true }));
      target.__webcrawlScene.game.events.off("postrender", stopWhenVended);
    };
    target.__webcrawlScene.game.events.on("postrender", stopWhenVended);
  }, remaining);
  await page.keyboard.down("a");
  await expect.poll(async () => (await machine(page)).vendingRemaining, { intervals: [10, 20, 50] }).toBe(remaining);
  await page.keyboard.up("a");
}

test("unfunded bumps recoil and return; purchases require pulling away and survive floor revisits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const item = await startGame(page);
  await positionPlayer(page, item, 140);
  await positionPlayer(page, item, 80);
  const previewBounds = await page.locator("#vendingPreview").boundingBox();
  expect(previewBounds?.width).toBeLessThan(100);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#vendingPreview")).toBeVisible();
  const mobileBounds = await page.locator("#vendingPreview").boundingBox();
  expect(mobileBounds?.width).toBeLessThan(100);
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(8);
  expect(mobileBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Observe the actual scene each frame so even a short spring recoil is captured.
  await page.evaluate(id => {
    const target = window as unknown as TestWindow & { vendingMotion: number[] };
    target.vendingMotion = [];
    target.__webcrawlScene.game.events.on("postrender", () => {
      const container = target.__webcrawlScene.children.getByName(`vending:${id}`) as import("phaser").GameObjects.Container | null;
      if (container) target.vendingMotion.push(container.x);
    });
  }, item.id);
  const failedPurchase = page.waitForEvent("console", { predicate: message => message.text().includes("Not enough RAM") });
  await page.keyboard.down("a");
  await failedPurchase;
  await page.waitForTimeout(500);
  await page.keyboard.up("a");
  expect((await machine(page)).vendingRemaining).toBe(4);
  await expect(page.locator("#vendingPreview")).toHaveText("$10");
  const motion = await page.evaluate(() => (window as unknown as { vendingMotion: number[] }).vendingMotion);
  expect(Math.min(...motion)).toBeLessThan(item.x - 2);
  expect(motion.at(-1)).toBeCloseTo(item.x, 5);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().filter(loot => loot.id.includes("::vend-")).length)).toBe(0);

  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.grantRam(100));
  // Releasing the key without leaving contact must not buy anything.
  await page.keyboard.down("a");
  await page.waitForTimeout(500);
  await page.keyboard.up("a");
  expect((await machine(page)).vendingRemaining).toBe(4);
  await positionPlayer(page, item, 120);
  await positionPlayer(page, item, 80);
  await bump(page, 3);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-credits", "90");
  await expect(page.locator("#vendingPreview")).toHaveText("$10");
  await page.keyboard.down("a");
  await page.waitForTimeout(650);
  await page.keyboard.up("a");
  expect((await machine(page)).vendingRemaining).toBe(3);
  const purchase = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().find(loot => loot.id.includes("::vend-1")));
  expect(purchase?.kind).toBe("core");

  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/other-floor"));
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-floor", "2");
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-floor", "1");
  expect((await machine(page)).vendingRemaining).toBe(3);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().find(loot => loot.id.includes("::vend-1")))).toEqual(purchase);

  for (const remaining of [2, 1]) {
    await positionPlayer(page, item, 120);
    await positionPlayer(page, item, 80);
    await bump(page, remaining);
  }
  const hp = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerHp());
  await positionPlayer(page, item, 120);
  await positionPlayer(page, item, 80);
  await bump(page, 0);
  await expect.poll(async () => (await machine(page)).destructible, { timeout: 20_000 }).toBe(false);
  expect(await machine(page)).toMatchObject({ kind: "debris", obstacle: true, destroyed: false });
  await expect(page.locator("#vendingPreview")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerHp())).toBe(hp - 1);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-credits", "60");
  const drops = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().filter(loot => loot.id.includes("::scenery-drop")));
  expect(drops).toHaveLength(1);
  expect(drops[0]?.kind).toBe("core");
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/other-floor"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect(await machine(page)).toMatchObject({ kind: "debris", destroyed: false, obstacle: true, destructible: false, vendingRemaining: 0 });
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().filter(loot => loot.id.includes("::scenery-drop")))).toEqual(drops);
  expect(errors).toEqual([]);
});

test("shooting replaces a stocked machine with a permanent blocking wreck and drops its product once", async ({ page }) => {
  const item = await startGame(page);
  await positionPlayer(page, item, 140);
  const hp = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerHp());
  const camera = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.camera());
  const bounds = await page.locator("#gameViewport").boundingBox();
  if (!bounds) throw new Error("Missing viewport");
  await page.mouse.move(
    bounds.x + bounds.width / 2 + (item.x - camera.x) * camera.zoom,
    bounds.y + bounds.height / 2 + (item.y - 30 - camera.y) * camera.zoom,
  );
  await page.mouse.down();
  await expect.poll(async () => (await machine(page)).destructible, { timeout: 20_000 }).toBe(false);
  // Additional shots must leave the replacement intact and cannot repeat its drop.
  await page.waitForTimeout(500);
  await page.mouse.up();
  expect(await machine(page)).toMatchObject({ kind: "debris", destroyed: false, obstacle: true, destructible: false, vendingRemaining: 0 });
  expect(await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.playerHp())).toBe(hp);
  const textures = await page.evaluate(id => {
    const container = (window as unknown as TestWindow).__webcrawlScene.children.getByName(`vending:${id}`) as import("phaser").GameObjects.Container;
    return container.list.map(child => (child as import("phaser").GameObjects.Image).texture?.key);
  }, item.id);
  expect(textures).toContain("asset:assets/debris/vending_generic.png");
  const drops = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.loot().filter(loot => loot.id.includes("::scenery-drop")));
  expect(drops).toHaveLength(1);
  expect(drops[0]?.kind).toBe("core");
  await positionPlayer(page, item, 80);
  await page.keyboard.down("a");
  await page.waitForTimeout(650);
  await page.keyboard.up("a");
  const playerX = Number(await page.locator("#gameCanvas").getAttribute("data-player-x"));
  expect(playerX - item.x).toBeGreaterThanOrEqual(55);
  await expect(page.locator("#vendingPreview")).toBeHidden();
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.navigate("https://example.com/other-floor"));
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.goBack());
  expect(await machine(page)).toMatchObject({ kind: "debris", obstacle: true, destructible: false });
  await positionPlayer(page, item, 80);
  await page.keyboard.down("a");
  await page.waitForTimeout(650);
  await page.keyboard.up("a");
  const restoredPlayerX = Number(await page.locator("#gameCanvas").getAttribute("data-player-x"));
  expect(restoredPlayerX - item.x).toBeGreaterThanOrEqual(55);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.grantEnergy(1));
  const dashCamera = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.camera());
  await page.mouse.click(
    bounds.x + bounds.width / 2 + (item.x - dashCamera.x) * dashCamera.zoom,
    bounds.y + bounds.height / 2 + (item.y - dashCamera.y) * dashCamera.zoom,
    { button: "right" },
  );
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-energy", "0");
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.dashing())).toBe(false);
  const dashedPlayerX = Number(await page.locator("#gameCanvas").getAttribute("data-player-x"));
  expect(dashedPlayerX - item.x).toBeGreaterThanOrEqual(55);
});
