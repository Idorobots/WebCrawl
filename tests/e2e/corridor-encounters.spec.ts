import { expect, test, type Page } from "@playwright/test";
import type { SecurityDoor } from "../../src/client/domain/corridor-encounters";
import { SECURITY_DOOR_MAX_HP, SECURITY_DOOR_RADIUS } from "../../src/client/domain/corridor-encounters";
import { ROOM_AMBUSH_TRIGGER_RADIUS, sceneryAmbushOutcome } from "../../src/client/domain/generation";
import { pointInCorridor, pointInRoomFloor } from "../../src/client/domain/geometry";
import { DECORATION_DEFINITIONS, SCENERY_DEFINITIONS, WORLD_GEOMETRY } from "../../src/client/domain/world-specs";
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
    scenery(): Pick<Decoration, "id" | "definitionId" | "x" | "y" | "roomId" | "corridorId" | "destructible" | "destroyed" | "roomAmbush">[];
    loot(): Array<Point & { id: string; kind: string; placement: string | null; powerup: PowerupKind | null }>;
    teleportPlayerTo(x: number, y: number): void;
    setPlayerInvulnerable(enabled: boolean): void;
    setMonsterAggroRadius(radius: number): void;
    equipWeapon(kind: WeaponKind, ammo: number): void;
    setWeaponAmmo(ammo: number): void;
    shoot(target: Point): boolean;
    hitMonster(id: string, damage: number): void;
    destroyScenery(id: string): void;
    gameTickAt(): number | null;
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

async function openFixture(page: Page, fixtureUrl = url) {
  await page.addInitScript(key => localStorage.setItem(key, "low"), LIGHT_DETAIL_STORAGE_KEY);
  await page.route("**/api/fetch?**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://example.com/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.locator("#welcomeUrlInput").fill(fixtureUrl);
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

test("compound corridors reveal furnishings, rooms show debris, and security doors trap encounters", async ({ page }) => {
  test.setTimeout(90_000);
  const host = await openFixture(page);
  const initial = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setPlayerInvulnerable(true);
    api.setMonsterAggroRadius(0);
    return { doors: api.securityDoors(), monsters: api.monsters(), layout: api.layout(), scenery: api.scenery() };
  });
  const furnishing = initial.scenery.find(item => {
    if (!item.id.endsWith("::furnishing")) return false;
    const link = initial.layout.links.find(link => link.id === item.corridorId);
    return link?.forkPointIndex !== undefined &&
      pointInCorridor(item.x, item.y, { ...link, points: link.points.slice(link.forkPointIndex) });
  });
  expect(furnishing).toBeDefined();
  const furnishingLink = initial.layout.links.find(link => link.id === furnishing!.corridorId)!;
  const furnishingArt = Object.values(DECORATION_DEFINITIONS).find(definition => definition.definitionId === furnishing!.definitionId)!
    .visual.normal.frames[0]!;
  const sceneryVisible = ({ x, y }: Point, assets: string[]) => page.evaluate(({ x, y, assets }) =>
    (window as unknown as TestWindow).__webcrawlScene.children.list.some(object => {
      const container = object as import("phaser").GameObjects.Container;
      return container.type === "Container" && container.visible && container.x === x && container.y === y &&
        container.list.some(child => assets.includes((child as import("phaser").GameObjects.Image).texture?.key));
    }), { x, y, assets: assets.map(asset => `asset:${asset}`) });
  const furnishingVisible = () => sceneryVisible(furnishing!, [furnishingArt]);
  expect(await furnishingVisible()).toBe(false);
  const root = initial.layout.nodes.find(room => room.isRoot)!;
  const roomDebris = initial.scenery.find(item => item.roomId === root.id && item.id.endsWith("::floor-debris"));
  expect(roomDebris).toBeDefined();
  await expect.poll(() => sceneryVisible(roomDebris!, SCENERY_DEFINITIONS.flatMap(definition => [...definition.visual.normal.frames]))).toBe(true);
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

  await revealCorridor(furnishingLink);
  await expect.poll(furnishingVisible).toBe(true);
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
  const scenery = initial.scenery.filter(item => !item.corridorId && !item.roomAmbush &&
    !initial.layout.nodes.find(room => room.id === item.roomId)?.isBossArena);
  const floor = `${url}::floor-1`;
  const ambush = scenery.find(item => sceneryAmbushOutcome(item, floor, 1) === "monster");
  const reward = scenery.find(item => sceneryAmbushOutcome(item, floor, 1) === "powerup");
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
    kind: expect.stringMatching(/^(melee|shooter)-(light|heavy)$/), dead: false,
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

test("ambush room props burst near the center once, and their outcomes survive a floor revisit", async ({ page }) => {
  test.setTimeout(90_000);
  const fixtureUrl = "https://example.com/ambush-probe-18";
  await openFixture(page, fixtureUrl);
  const initial = await page.evaluate(() => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    api.setPlayerInvulnerable(true);
    api.setMonsterAggroRadius(0);
    return { scenery: api.scenery(), monsters: api.monsters(), layout: api.layout() };
  });
  const floor = `${fixtureUrl}::floor-1`;
  const pods = initial.scenery.filter(item => item.roomAmbush &&
    ["sealed-escape-capsule", "lifeboat-pod"].includes(item.definitionId));
  expect(pods).toHaveLength(3);
  const podRoom = initial.layout.nodes.find(room => room.id === pods[0]!.roomId)!;
  await teleport(page, { x: podRoom.x, y: podRoom.y });
  await expect.poll(async () => {
    const monsters = await page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.monsters());
    return monsters.filter(monster => pods.some(pod => monster.id === `${pod.id}::ambush`) &&
      monster.active && monster.kind.endsWith("-heavy") && pointInRoomFloor(monster.x, monster.y, podRoom));
  }).toHaveLength(pods.length);

  const room = initial.layout.nodes.find(room => {
    const outcomes = initial.scenery.filter(item => item.roomId === room.id && item.roomAmbush)
      .map(item => sceneryAmbushOutcome(item, floor, 1));
    return outcomes.includes("monster") && outcomes.includes("powerup");
  });
  expect(room).toBeDefined();
  const props = initial.scenery.filter(item => item.roomId === room!.id && item.roomAmbush);
  expect(initial.monsters.filter(monster => !monster.spawnCorridorId && monster.id.startsWith(`${room!.id}::`))).toEqual([]);
  const monsterIds = props.filter(item => sceneryAmbushOutcome(item, floor, 1) === "monster").map(item => `${item.id}::ambush`);
  const powerupIds = props.filter(item => sceneryAmbushOutcome(item, floor, 1) === "powerup")
    .map(item => `${floor}::${item.id}::ambush-powerup`);
  const outcomes = () => page.evaluate(({ propIds, monsterIds, powerupIds }) => {
    const api = (window as unknown as TestWindow).__webcrawlTest;
    return {
      destroyed: api.scenery().filter(item => propIds.includes(item.id) && item.destroyed).length,
      monsters: api.monsters().filter(item => monsterIds.includes(item.id))
        .map(({ id, active, dead }) => ({ id, active, dead })),
      powerups: api.loot().filter(item => powerupIds.includes(item.id)).map(({ id }) => id),
    };
  }, { propIds: props.map(item => item.id), monsterIds, powerupIds });
  const edge = { x: room!.x + ROOM_AMBUSH_TRIGGER_RADIUS + 32, y: room!.y };
  expect(pointInRoomFloor(edge.x, edge.y, room!)).toBe(true);
  await teleport(page, edge);
  const tick = () => page.evaluate(() => (window as unknown as TestWindow).__webcrawlTest.gameTickAt() ?? 0);
  const outsideTick = await tick();
  await expect.poll(tick).toBeGreaterThan(outsideTick);
  expect(await outcomes()).toEqual({ destroyed: 0, monsters: [], powerups: [] });

  await teleport(page, { x: room!.x, y: room!.y });
  const triggered = { destroyed: props.length, monsters: monsterIds.map(id => ({ id, active: true, dead: false })), powerups: powerupIds };
  await expect.poll(outcomes).toEqual(triggered);
  await page.evaluate(id => (window as unknown as TestWindow).__webcrawlTest.hitMonster(id, 1000), monsterIds[0]!);
  await revisitFloor(page);
  await teleport(page, { x: room!.x, y: room!.y });
  await expect.poll(outcomes).toEqual({
    ...triggered,
    monsters: triggered.monsters.map(({ id }) => ({ id, active: true, dead: id === monsterIds[0] })),
  });
});
