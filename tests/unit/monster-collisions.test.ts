import { describe, expect, it, vi } from "vitest";
import { footprintsOverlap } from "../../src/client/domain/geometry";
import { worldPoint } from "../../src/client/domain/object-geometry";
import { chooseReachablePath, FailedPathCache } from "../../src/client/domain/pathfinding";
import { BOSS_DEFINITIONS, MINIBOSS_SIZE_MULTIPLIER, REGULAR_MONSTER_DEFINITIONS, WORLD_GEOMETRY } from "../../src/client/domain/specs";
import { indexMonsterHitboxes, monsterBlockingRadii, monsterCollisionCandidates, MonsterFootprintIndex } from "../../src/client/domain/spatial";
import type { Monster, Point } from "../../src/client/types";

const monster = (id: string, point: Point): Monster => ({
  ...REGULAR_MONSTER_DEFINITIONS["melee-heavy"], ...point,
  id, seed: 0, roomId: 0, spawnRoomId: 0, maxHp: 5, hp: 5,
  active: true, dead: false, miniboss: false, lastAttackAt: -Infinity, dropsLoot: false,
});

describe("monster blocking footprints", () => {
  it("halves both monsters' radii without changing the full geometry used for other collisions", () => {
    const actor = monster("actor", { x: -100, y: 0 });
    const other = monster("other", { x: 0, y: 0 });
    const full = worldPoint(actor, "footprintRadii");
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    expect(monsterBlockingRadii(actor)).toEqual({ x: full.x / 2, y: full.y / 2 });
    const relaxed = { x: -full.x * 1.5, y: 0 };
    expect(footprintsOverlap(relaxed, full, other, worldPoint(other, "footprintRadii"))).toBe(true);
    expect(index.moveIsClear(actor, relaxed)).toBe(true);
    expect(index.positionIsClear(actor, relaxed)).toBe(true);
    expect(index.moveIsClear(actor, { x: -full.x * 0.75, y: 0 })).toBe(false);
    expect(worldPoint(actor, "footprintRadii")).toBe(full);
  });

  it("uses each axis of differently sized elliptical footprints", () => {
    const actor = { ...monster("actor", { x: -100, y: 0 }), size: 100, footprintRadii: { x: 0.3, y: 0.1 } };
    const other = { ...monster("other", { x: 0, y: 0 }), size: 200, footprintRadii: { x: 0.1, y: 0.4 } };
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    expect(index.positionIsClear(actor, { x: 26, y: 0 })).toBe(true);
    expect(index.positionIsClear(actor, { x: 24, y: 0 })).toBe(false);
    expect(index.positionIsClear(actor, { x: 0, y: 46 })).toBe(true);
    expect(index.positionIsClear(actor, { x: 0, y: 44 })).toBe(false);
  });

  it("resolves miniboss and boss scaling and refreshes radii when the size changes", () => {
    const mini = monster("mini", { x: 0, y: 0 });
    mini.miniboss = true;
    mini.size *= MINIBOSS_SIZE_MULTIPLIER;
    const boss: Monster = { ...monster("boss", { x: 200, y: 0 }), ...BOSS_DEFINITIONS["glm-hunter"], bossKind: "glm-hunter" };
    for (const actor of [mini, boss]) {
      const full = worldPoint(actor, "footprintRadii");
      expect(monsterBlockingRadii(actor)).toEqual({ x: full.x / 2, y: full.y / 2 });
    }
    const previous = monsterBlockingRadii(mini);
    mini.size *= 2;
    expect(monsterBlockingRadii(mini)).toEqual({ x: previous.x * 2, y: previous.y * 2 });
  });

  it("indexes feet independently of projectile hitbox offsets", () => {
    const actor = monster("actor", { x: -100, y: 0 });
    const other = { ...monster("other", { x: 0, y: 0 }), hitboxOffset: { x: 0, y: -2 } };
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    expect(monsterCollisionCandidates(indexMonsterHitboxes([other]), other, 0).has(other)).toBe(false);
    expect(index.moveIsClear(actor, other)).toBe(false);
  });

  it("allows overlapping monsters to separate but not move deeper into each other", () => {
    const actor = monster("actor", { x: 5, y: 0 });
    const other = monster("other", { x: 0, y: 0 });
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    expect(index.moveIsClear(actor, { x: 6, y: 0 })).toBe(true);
    expect(index.moveIsClear(actor, { x: 4, y: 0 })).toBe(false);
    expect(index.positionIsClear(actor, { x: 6, y: 0 })).toBe(false);
    actor.x = 0;
    index.update(actor);
    expect(index.moveIsClear(actor, { x: 1, y: 0 })).toBe(true);
  });

  it("sees moves, spawns, and deaths in the same tick across spatial cell boundaries", () => {
    const step = WORLD_GEOMETRY.spatialCellSize;
    const actor = monster("actor", { x: 0, y: 0 });
    const other = monster("other", { x: step - 1, y: 0 });
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    other.x = step * 2 + 1;
    index.update(other);
    expect(index.nearby({ x: step - 1, y: 0 }, 0).has(other)).toBe(false);
    expect(index.moveIsClear(actor, other)).toBe(false);
    other.dead = true;
    index.update(other);
    expect(index.moveIsClear(actor, other)).toBe(true);
    const spawned = monster("spawned", { x: other.x, y: other.y });
    index.update(spawned);
    expect(index.moveIsClear(actor, spawned)).toBe(false);
    spawned.obstacle = false;
    index.update(spawned);
    expect(index.moveIsClear(actor, spawned)).toBe(true);
    index.rebuild([actor]);
    expect(index.nearby(other, 50).size).toBe(0);
  });

  it("blocks on stationary and inactive living monsters, but never on itself", () => {
    const actor = monster("actor", { x: -100, y: 0 });
    const sentry = { ...monster("sentry", { x: 0, y: 0 }), speed: 0, active: false };
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, sentry]);
    expect(index.moveIsClear(actor, actor)).toBe(true);
    expect(index.moveIsClear(actor, sentry)).toBe(false);
  });

  it("uses live positions for movement within the same cells and still wakes cached failures", () => {
    const actor = monster("actor", { x: 0, y: 100 });
    const other = monster("other", { x: 100, y: 100 });
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, other]);
    const cache = new FailedPathCache();
    cache.remember(actor, [], undefined, Infinity, index.nearby(actor, 200));
    expect(index.moveIsClear(actor, { x: 100, y: 100 })).toBe(false);
    other.x = 200;
    index.update(other);
    expect(index.moveIsClear(actor, { x: 100, y: 100 })).toBe(true);
    expect(index.moveIsClear(actor, other)).toBe(false);
    expect(cache.unchanged(actor, undefined, 0, index.nearby(actor, 200))).toBe(false);
    other.x = 100;
    index.update(other);
    expect(index.moveIsClear(actor, { x: 100, y: 100 })).toBe(false);
  });
});

describe("failed paths blocked by monsters", () => {
  it("sleeps behind a stationary blocker, ignores distant movement, and recovers as soon as the blocker moves", () => {
    const actor = monster("actor", { x: -100, y: 0 });
    const blocker = monster("blocker", { x: 0, y: 0 });
    const distant = monster("distant", { x: 2000, y: 0 });
    const target = { x: 100, y: 0, roomId: 0 };
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, blocker, distant]);
    const cache = new FailedPathCache();
    const nearby = () => index.nearby(actor, WORLD_GEOMETRY.spatialCellSize);
    const search = vi.fn(() => chooseReachablePath(actor, [target],
      point => Math.abs(point.y) <= 10 && index.moveIsClear(actor, point), 13, 300,
      () => ({ minX: -110, maxX: 110, minY: -10, maxY: 10 }), true));
    const update = () => {
      if (cache.unchanged(actor, target, 0, nearby())) return null;
      const route = search();
      if (!route || route.partial) cache.remember(actor, [], target, Infinity, nearby());
      return route;
    };
    const partial = update();
    expect(partial?.partial).toBe(true);
    expect(partial!.path.at(-1)!.x).toBeLessThan(-monsterBlockingRadii(actor).x - monsterBlockingRadii(blocker).x);
    for (let tick = 0; tick < 240; tick++) {
      distant.x += 1;
      index.update(distant);
      expect(update()).toBeNull();
    }
    expect(search).toHaveBeenCalledTimes(1);
    blocker.y = 100;
    index.update(blocker);
    expect(update()?.path.at(-1)).toEqual(target);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it.each(["moves", "dies", "stops blocking"])("invalidates a local failure immediately when a blocker %s", change => {
    const actor = monster("actor", { x: 0, y: 0 });
    const blocker = monster("blocker", { x: 40, y: 0 });
    const cache = new FailedPathCache();
    cache.remember(actor, [], undefined, Infinity, [blocker]);
    expect(cache.unchanged(actor)).toBe(true);
    if (change === "moves") blocker.x += 0.01;
    if (change === "dies") blocker.dead = true;
    if (change === "stops blocking") blocker.obstacle = false;
    expect(cache.unchanged(actor)).toBe(false);
  });

  it("wakes when another monster arrives in the previously empty neighborhood", () => {
    const actor = monster("actor", { x: 0, y: 0 });
    const arriving = monster("arriving", { x: 2000, y: 0 });
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, arriving]);
    const cache = new FailedPathCache();
    cache.remember(actor, [], undefined, Infinity, index.nearby(actor, 100));
    arriving.x = 40;
    index.update(arriving);
    expect(cache.unchanged(actor, undefined, 0, index.nearby(actor, 100))).toBe(false);
  });
});
