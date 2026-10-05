import { expect, test, type Page } from "@playwright/test";
import type Phaser from "phaser";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires VITE_ART_DEBUG=true");
test.setTimeout(90_000);

interface TestWindow extends Window {
  __webcrawlScene: Phaser.Scene;
  __webcrawlTest: {
    teleportPlayerTo: (x: number, y: number) => void;
    setPlayerInvulnerable: (enabled: boolean) => void;
  };
}

const { layout } = artDebugLevel();
const gallery = layout.nodes[0]!;

async function startGame(page: Page): Promise<void> {
  await page.addInitScript(key => localStorage.setItem(key, "high"), LIGHT_DETAIL_STORAGE_KEY);
  await page.goto("/");
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", String(layout.nodes.length), { timeout: 30_000 });
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-lighting-mode", "webgl");
}

test("keeps the visible edge of a large room lit from two graph hops away", async ({ page }) => {
  await startGame(page);
  const room = layout.nodes[2]!;
  await page.evaluate(room => {
    const target = window as unknown as TestWindow;
    target.__webcrawlTest.setPlayerInvulnerable(true);
    target.__webcrawlTest.teleportPlayerTo(room.x, room.y + 150);
    target.__webcrawlScene.cameras.main.stopFollow().centerOn(1900, 0);
  }, room);
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-player-x", String(room.x));
  await expect.poll(() => page.evaluate(gallery => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const view = scene.cameras.main.worldView;
    const light = scene.lights.lights.find(light => light.x === gallery.x && light.y === gallery.y && light.radius > 1000);
    return {
      centerOffScreen: gallery.x < view.x,
      edgeOnScreen: view.x < gallery.x + gallery.width / 2 && view.right > gallery.x + gallery.width / 2,
      lightVisible: light?.visible,
    };
  }, gallery)).toEqual({ centerOffScreen: true, edgeOnScreen: true, lightVisible: true });
});

test("keeps a large off-screen room light in the shader budget ahead of tiny nearby lights", async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    scene.cameras.main.stopFollow().centerOn(1900, 0);
    for (let index = 0; index < scene.lights.maxLights + 1; index += 1) {
      scene.lights.addLight(1900, 0, 10, 0xffffff, 1);
    }
  });
  await expect.poll(() => page.evaluate(gallery => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const camera = scene.cameras.main;
    const selected = scene.lights.getLights(camera) as unknown as Array<{ light: Phaser.GameObjects.Light }>;
    return {
      centerOffScreen: gallery.x < camera.worldView.x,
      roomSelected: selected.some(({ light }) => light.x === gallery.x && light.y === gallery.y && light.radius > 1000),
      withinBudget: selected.length <= scene.lights.maxLights,
    };
  }, gallery)).toEqual({ centerOffScreen: true, roomSelected: true, withinBudget: true });
});
