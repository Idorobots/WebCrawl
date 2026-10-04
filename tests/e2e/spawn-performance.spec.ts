import { expect, test } from "@playwright/test";
import type Phaser from "phaser";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires VITE_ART_DEBUG=true");
test.setTimeout(120_000);

type TestWindow = Window & {
  __webcrawlScene: Phaser.Scene;
  __webcrawlTest: {
    setPlayerInvulnerable: (enabled: boolean) => void;
    primeSpawnerSpawn: () => { id: string; x: number; y: number } | null;
  };
};

test("defers off-screen summon visuals and resumes them when the camera returns", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "high"), LIGHT_DETAIL_STORAGE_KEY);
  await page.goto("/");
  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-active-spawners", "1", { timeout: 30_000 });
  await expect(game).toHaveAttribute("data-active-monsters", "0");

  const result = await page.evaluate(() => {
    const { __webcrawlScene: scene, __webcrawlTest: api } = window as unknown as TestWindow;
    api.setPlayerInvulnerable(true);
    const before = { objects: scene.children.list.length, lights: scene.lights.lights.length };
    const monster = api.primeSpawnerSpawn();
    if (!monster) throw new Error("Expected a reinforcement from the gallery spawner");
    const view = scene.cameras.main.worldView;
    return {
      monster,
      before,
      after: { objects: scene.children.list.length, lights: scene.lights.lights.length },
      outsideView: !view.contains(monster.x, monster.y),
    };
  });
  expect(result.outsideView).toBe(true);
  expect(result.after).toEqual(result.before);
  await expect(game).toHaveAttribute("data-active-monsters", "1");
  await expect(game).toHaveAttribute("data-rendered-monsters", "0");
  await expect(game).toHaveAttribute("data-enemy-auras", "0");
  await expect(game).toHaveAttribute("data-effect-lights", "0");

  const centerCamera = (position: { x: number; y: number }) => page.evaluate(({ x, y }) => {
    (window as unknown as TestWindow).__webcrawlScene.cameras.main.stopFollow().centerOn(x, y);
  }, position);
  const visualState = () => page.evaluate(id => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    const container = scene.children.list.find(object => object.getData("monsterId") === id) as
      Phaser.GameObjects.Container | undefined;
    if (!container) return null;
    const sprite = container.getByName("sprite") as Phaser.GameObjects.Sprite;
    const bar = scene.children.list.find(object => object.type === "Container" &&
      Boolean((object as Phaser.GameObjects.Container).getByName("hp"))) as Phaser.GameObjects.Container | undefined;
    return {
      visible: container.visible,
      paused: sprite.anims.isPaused,
      healthBarVisible: bar?.visible,
      auraVisible: scene.lights.lights.some(light => light.visible && light.x === container.x &&
        Math.abs(light.y - container.y) < 50),
      count: scene.children.list.filter(object => object.getData("monsterId") === id).length,
    };
  }, result.monster.id);

  await centerCamera(result.monster);
  await expect(game).toHaveAttribute("data-rendered-monsters", "1");
  await expect.poll(visualState).toEqual({ visible: true, paused: false, healthBarVisible: true, auraVisible: true, count: 1 });

  await centerCamera({ x: 25_000, y: 25_000 });
  await expect(game).toHaveAttribute("data-rendered-monsters", "0");
  await expect.poll(visualState).toEqual({ visible: false, paused: true, healthBarVisible: false, auraVisible: false, count: 1 });

  await centerCamera(result.monster);
  await expect(game).toHaveAttribute("data-rendered-monsters", "1");
  await expect.poll(visualState).toEqual({ visible: true, paused: false, healthBarVisible: true, auraVisible: true, count: 1 });
});
