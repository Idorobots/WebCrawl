import { expect, test } from "@playwright/test";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { PLAYER_ENERGY_MAX } from "../../src/client/domain/world-specs";
import { LIGHT_DETAIL_STORAGE_KEY, type LightDetail } from "../../src/client/render/light-detail";

test.skip(process.env.VITE_ART_DEBUG !== "true", "Requires a build with VITE_ART_DEBUG=true");
test.describe.configure({ timeout: 90_000 });
const { layout } = artDebugLevel();

test("boots directly into the playable, authored art floor without fetching a page", async ({ page }) => {
  const fetches: string[] = [];
  await page.route("**/api/fetch?**", route => {
    fetches.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  const host = page.locator("#gameCanvas");
  await expect(page.locator("#welcomeScreen")).toBeHidden();
  await expect(page.locator("#loadingScreen")).toBeHidden();
  await expect(page.locator("#gameUi")).toBeVisible();
  await expect(host.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(host).toHaveAttribute("data-rooms", String(layout.nodes.length), { timeout: 30_000 });
  const fps = page.locator("#debugFps");
  if (process.env.VITE_DEBUG === "true") {
    await expect(fps).toBeVisible();
    await expect(fps).toHaveText(/^[1-9]\d* FPS\s+Tick: \d+\.\d{2} ms\s+Phaser update: \d+\.\d{2} ms\s+Render \(CPU\): \d+\.\d{2} ms\s+Between frames: \d+\.\d{2} ms$/, { timeout: 10_000 });
  } else {
    await expect(fps).toBeHidden();
  }
  await expect(host).toHaveAttribute("data-active-monsters", "0");
  await expect(host).toHaveAttribute("data-credits", "200");
  await expect(host).toHaveAttribute("data-energy", String(PLAYER_ENERGY_MAX));
  await expect(page.locator("#hudEnergyFill")).toHaveAttribute("style", /width:\s*100%/);
  expect(fetches).toEqual([]);

  const enemyRoom = layout.nodes[1]!;
  await page.evaluate(({ x, y }) => {
    (window as Window & { __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void } })
      .__webcrawlTest?.teleportPlayerTo(x, y);
  }, { x: enemyRoom.x, y: enemyRoom.y + 150 });
  await expect(host).toHaveAttribute("data-active-monsters", "1");

  await page.evaluate(() => {
    (window as Window & { __webcrawlTest?: { setPlayerInvulnerable: (enabled: boolean) => void } })
      .__webcrawlTest?.setPlayerInvulnerable(true);
  });
  const minibossRooms = layout.nodes.filter(room => room.tag === "miniboss");
  for (const [index, minibossRoom] of minibossRooms.entries()) {
    await page.evaluate(({ x, y }) => {
      (window as Window & { __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void } })
        .__webcrawlTest?.teleportPlayerTo(x, y);
    }, { x: minibossRoom.x, y: minibossRoom.y + 150 });
    await expect(host).toHaveAttribute("data-active-minibosses", String(index + 1));
    await expect(host).toHaveAttribute("data-active-monsters", String(index + 2));
    await expect(host).toHaveAttribute("data-active-bosses", "0");
    await expect(page.locator("#bossHud")).toBeHidden();
  }

  const bossRoom = layout.nodes.find(room => room.isBossArena)!;
  await page.evaluate(({ x, y }) => {
    (window as Window & { __webcrawlTest?: { teleportPlayerTo: (x: number, y: number) => void } })
      .__webcrawlTest?.teleportPlayerTo(x, y);
  }, { x: bossRoom.x, y: bossRoom.y + 180 });
  await expect(host).toHaveAttribute("data-active-bosses", "1");
  await expect(page.locator("#bossHud")).toBeVisible();
});

for (const detail of ["none", "low", "medium", "high"] as const satisfies readonly LightDetail[]) {
  test(`applies ${detail} lighting to the art floor`, async ({ page }) => {
    await page.addInitScript(({ key, detail }) => localStorage.setItem(key, detail), {
      key: LIGHT_DETAIL_STORAGE_KEY,
      detail,
    });
    await page.goto("/");
    const host = page.locator("#gameCanvas");
    await expect(host).toHaveAttribute("data-rooms", String(layout.nodes.length), { timeout: 30_000 });
    await expect(host).toHaveAttribute("data-light-detail", detail);
    await expect(host).toHaveAttribute("data-lighting-mode", detail === "none" ? "disabled" : "webgl");
    await expect(host).toHaveAttribute("data-flashlight-active", detail === "none" ? "false" : "true");
    if (detail !== "none") {
      await expect.poll(async () => Number(await host.getAttribute("data-room-lights"))).toBeGreaterThan(0);
    }
    await expect(host).toHaveAttribute("data-aura-mode", detail === "medium" || detail === "high" ? "light2d" : "off");
    await expect(host).toHaveAttribute("data-bullet-glow-mode", detail === "high" ? "batched-light2d" : "off");
    await expect(host).toHaveAttribute("data-player-light", detail === "medium" || detail === "high" ? "true" : "false");
    const shadows = Number(await host.getAttribute("data-scenery-shadows"));
    if (detail === "medium" || detail === "high") expect(shadows).toBeGreaterThan(0);
    else expect(shadows).toBe(0);
    const effectLights = await page.evaluate(() => {
      (window as Window & { __webcrawlTest?: { spawnHealingEffect: () => void } }).__webcrawlTest?.spawnHealingEffect();
      return document.querySelector<HTMLElement>("#gameCanvas")?.dataset.effectLights;
    });
    expect(effectLights).toBe(detail === "high" ? "1" : "0");
  });
}
