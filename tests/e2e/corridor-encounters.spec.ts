import { expect, test, type Page } from "@playwright/test";
import type { SecurityDoor } from "../../src/client/domain/corridor-encounters";
import { SECURITY_DOOR_MAX_HP, SECURITY_DOOR_RADIUS } from "../../src/client/domain/corridor-encounters";
import { sceneryAmbushOutcome } from "../../src/client/domain/generation";
import { WORLD_GEOMETRY } from "../../src/client/domain/world-specs";
import { doorModuleStyles } from "../../src/client/render/corridor-render-plan";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";
import type { Decoration, DungeonLayout, Monster, Point, PowerupKind, WeaponKind } from "../../src/client/types";

type TestWindow = Window & {
  __webcrawlScene: import("phaser").Scene;
  __webcrawlTest: {
    layout(): DungeonLayout;
    securityDoors(): SecurityDoor[];
    lastMonsterPathSearchAt(id: string): number | undefined;
    monsters(): Pick<Monster, "id" | "kind" | "x" | "y" | "spawnCorridorId" | "active" | "dead">[];
    scenery(): Pick<Decoration, "id" | "definitionId" | "x" | "y" | "roomId" | "corridorId" | "destructible">[];
    loot(): Array<Point & { id: string; kind: string; placement: string | null; powerup: PowerupKind | null }>;
    teleportPlayerTo(x: number, y: number): void;
    setPlayerInvulnerable(enabled: boolean): void;
    setMonsterAggroRadius(radius: number): void;
    equipWeapon(kind: WeaponKind, ammo: number): void;
    setWeaponAmmo(ammo: number): void;
    shoot(target: Point): boolean;
    hitMonster(id: string, damage: number): void;
    destroyScenery(id: string): void;
    navigate(url: string): Promise<void>;
    goBack(): Promise<void>;
  };
};

const url = "https://example.com/corridor-encounters";
const html = `<body><nav><ul>${Array.from({ length: 12 }, (_, index) =>
  `<li><a href="/nav-${index}">Navigation ${index}</a></li>`
).join("")}</ul></nav><main>${Array.from({ length: 20 }, (_, index) =>
  `<article id="entry-${index}"><h1>Article ${index}</h1><p>First paragraph.</p><p>Second paragraph.</p></article>`
).join("")}</main></body>`;

async function openFixture(page: Page) {
  await page.addInitScript(key => localStorage.setItem(key, "low"), LIGHT_DETAIL_STORAGE_KEY);
  await page.route("**/api/fetch?**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://example.com/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.locator("#welcomeUrlInput").fill(url);
  await page.getByRole("button", { name: "Go" }).click();
  const host = page.locator("#gameCanvas");
  await expect(host).toHaveAttribute("data-rooms", /[1-9]\d*/, { timeout: 60_000 });
  return host;
}

const teleport = (page: Page, point: Point) => page.evaluate(({ x, y }) =>
  (window as unknown as TestWindow).__webcrawlTest.teleportPlayerTo(x, y), point);

const revisitFloor = (page: Page) => page.evaluate(async () => {
  const api = (window as unknown as TestWindow).__webcrawlTest;
  await api.navigate("https://example.com/another-floor");
  await api.goBack();
});

test("corridor doors trap encounters, take projectile damage, and stay broken on return", async ({ page }) => {
  test.setTimeout(90_000);
  const host = await openFixture(page);
  const initial = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setPlayerInvulnerable(true);
    api.setMonsterAggroRadius(0);
    return { doors: api.securityDoors(), monsters: api.monsters(), layout: api.layout() };
  });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const door = initial.doors.find(item => initial.monsters.some(monster =>
    monster.spawnCorridorId === item.linkId && distance(monster, item.position) <= SECURITY_DOOR_RADIUS));
  expect(door, `Expected a populated security door; found ${initial.doors.length} doors`).toBeDefined();
  const link = initial.layout.links.find(link => link.id === door!.linkId)!;
  const nearbyMonster = initial.monsters.find(monster => monster.spawnCorridorId === link.id &&
    distance(monster, door!.position) <= SECURITY_DOOR_RADIUS)!;
  expect(nearbyMonster.active).toBe(false);
  const { x, y } = door!.position;
  const horizontal = door!.side === "E";
  const step = Math.sign(horizontal ? x - nearbyMonster.x : y - nearbyMonster.y) * 110;
  const from = { x: x + (horizontal ? step : 0), y: y + (horizontal ? 0 : step) };
  const target = { x, y: y - 32 };
  const state = () => page.evaluate(({ id, center, radius }) => {
    const { __webcrawlTest: api, __webcrawlScene: scene } = window as unknown as TestWindow;
    const light = scene.lights.lights.find(light => light.x === center.x && light.y === center.y && light.radius === radius);
    const color = light ? [light.color.r, light.color.g, light.color.b].map(channel => Math.round(channel * 255)) : null;
    const bar = scene.children.getByName(`security-door-health:${id}`) as import("phaser").GameObjects.Container | null;
    return { hp: api.securityDoors().find(item => item.id === id)?.hp, visible: light?.visible, color,
      barWidth: bar?.getByName<import("phaser").GameObjects.Rectangle>("hp")?.width ?? null };
  }, {
    id: door!.id,
    center: { x, y: y + (horizontal ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0) },
    radius: WORLD_GEOMETRY.doorOpeningWidth,
  });
  const revealCorridor = async (link: DungeonLayout["links"][number]) => {
    const start = link.points[0]!;
    const inward = { N: { x: 0, y: 1 }, S: { x: 0, y: -1 }, E: { x: -1, y: 0 }, W: { x: 1, y: 0 } }[link.direction];
    const reveal = {
      x: start.x + inward.x * 61,
      y: start.y + inward.y * 61 + (inward.x ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0),
    };
    // Visit the source room before revealing the corridor at its exit.
    await teleport(page, reveal);
    await expect(host).toHaveAttribute("data-player-x", String(Math.round(reveal.x)));
    await expect(host).toHaveAttribute("data-player-y", String(Math.round(reveal.y)));
    await teleport(page, reveal);
  };

  expect(await state()).toMatchObject({ visible: false });
  await revealCorridor(link);
  await expect.poll(() => page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.monsters()
    .find(monster => monster.id === id)?.active, nearbyMonster.id)).toBe(true);
  await teleport(page, from);
  await expect(host).toHaveAttribute("data-player-x", String(Math.round(from.x)));
  await expect(host).toHaveAttribute("data-player-y", String(Math.round(from.y)));
  await expect.poll(state).toEqual({ hp: SECURITY_DOOR_MAX_HP, visible: true, color: [255, 151, 44], barWidth: null });
  // Travel toward the monster on the opposite side; the sealed door blocks movement.
  const key = horizontal ? (step > 0 ? "KeyA" : "KeyD") : (step > 0 ? "KeyW" : "KeyS");
  const axis = horizontal ? "x" : "y";
  await page.keyboard.down(key);
  await expect.poll(async () => Math.abs(Number(await host.getAttribute(`data-player-${axis}`)) - from[axis]))
    .toBeGreaterThan(30);
  await page.keyboard.up(key);
  await teleport(page, door!.position);
  expect(Number(await host.getAttribute(`data-player-${axis}`))).not.toBe(door!.position[axis]);

  const shoot = () => page.evaluate(target => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setWeaponAmmo(20);
    return api.shoot(target);
  }, target);
  await teleport(page, from);
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.equipWeapon("needle-rail", 20));
  expect(await shoot()).toBe(true);
  await expect.poll(async () => (await state()).hp).toBeLessThan(SECURITY_DOOR_MAX_HP);
  const damaged = await state();
  expect(damaged).toMatchObject({ visible: true, color: [255, 151, 44] });
  expect(damaged.barWidth).toBeCloseTo(44 * damaged.hp! / SECURITY_DOOR_MAX_HP);

  // Hold fire and let the monster attack the other side without running A*.
  await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.setMonsterAggroRadius(1000));
  await expect.poll(async () => (await state()).barWidth ?? Infinity, { timeout: 10_000 }).toBeLessThan(damaged.barWidth!);
  const searches = await page.evaluate(id => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setMonsterAggroRadius(0);
    return api.lastMonsterPathSearchAt(id);
  }, nearbyMonster.id);
  expect(searches).toBeUndefined();
  await expect.poll(async () => {
    if ((await state()).hp !== 0) await shoot();
    return state();
  }, { intervals: [140], timeout: 10_000 }).toMatchObject({ hp: 0, visible: false, barWidth: null });
  const half = doorModuleStyles(door!.side, WORLD_GEOMETRY.segmentSize)[0]!;
  await expect.poll(() => page.evaluate(({ x, y, asset }) => {
    const scene = (window as unknown as TestWindow).__webcrawlScene;
    return scene.children.list.some(object => {
      const image = object as import("phaser").GameObjects.Image;
      return image.x === x && image.y === y && image.texture?.key === `asset:${asset}`;
    });
  }, { x: x + half.offsetX, y: y + half.offsetY, asset: half.asset })).toBe(true);
  await expect.poll(async () => {
    await teleport(page, door!.position);
    return Number(await host.getAttribute(`data-player-${axis}`));
  }).toBe(Math.round(door!.position[axis]));

  await revisitFloor(page);
  await expect(host).toHaveAttribute("data-floor", "1");
  await teleport(page, door!.position);
  await expect.poll(state).toMatchObject({ hp: 0, visible: false, barWidth: null });
});

test("destroyed scenery spawns one ambush monster or one collectible powerup, with results saved on return", async ({ page }) => {
  test.setTimeout(90_000);
  await openFixture(page);
  const initial = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setPlayerInvulnerable(true);
    api.setMonsterAggroRadius(0);
    return { scenery: api.scenery(), layout: api.layout() };
  });
  const scenery = initial.scenery.filter(item => !item.corridorId &&
    !initial.layout.nodes.find(room => room.id === item.roomId)?.isBossArena);
  const floor = `${url}::floor-1`;
  const ambush = scenery.find(item => sceneryAmbushOutcome(item, floor) === "monster");
  const reward = scenery.find(item => sceneryAmbushOutcome(item, floor) === "powerup");
  expect(ambush).toBeDefined();
  expect(reward).toBeDefined();
  const room = initial.layout.nodes.find(room => room.id === ambush!.roomId)!;
  await teleport(page, { x: room.x, y: room.y });
  const ambushMonsters = (id: string) => page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.monsters()
    .filter(monster => monster.id === `${id}::ambush`), id);
  const ambushPowerups = (id: string) => page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.loot()
    .filter(item => item.id === id), `${floor}::${id}::ambush-powerup`);
  const destroyTwice = (id: string) => page.evaluate(id => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.destroyScenery(id);
    api.destroyScenery(id);
  }, id);
  await destroyTwice(ambush!.id);
  await destroyTwice(reward!.id);
  await expect.poll(() => ambushMonsters(ambush!.id)).toEqual([expect.objectContaining({
    kind: expect.stringMatching(/^(melee|shooter)-light$/), dead: false,
  })]);
  expect(await ambushPowerups(ambush!.id)).toEqual([]);
  expect(await ambushMonsters(reward!.id)).toEqual([]);
  const uncollected = await ambushPowerups(reward!.id);
  expect(uncollected).toEqual([expect.objectContaining({ kind: "powerup", powerup: expect.any(String), placement: "floor" })]);
  await page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.hitMonster(id, 1000), `${ambush!.id}::ambush`);

  await revisitFloor(page);
  await expect.poll(() => ambushMonsters(ambush!.id)).toEqual([expect.objectContaining({ dead: true })]);
  expect(await ambushPowerups(reward!.id)).toEqual(uncollected);
  await teleport(page, uncollected[0]!);
  expect(await ambushPowerups(reward!.id)).toEqual([]);
  await revisitFloor(page);
  expect(await ambushPowerups(reward!.id)).toEqual([]);
});
