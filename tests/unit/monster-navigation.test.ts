import { describe, expect, it, vi } from "vitest";
import { applyObstacleDamage, meleeBlockingScenery } from "../../src/client/domain/combat";
import { chooseReachablePath, FailedPathCache, walkableSegment } from "../../src/client/domain/pathfinding";
import { DECORATION_DEFINITIONS, MINIBOSS_SIZE_MULTIPLIER, REGULAR_MONSTER_DEFINITIONS } from "../../src/client/domain/specs";
import { worldPoint } from "../../src/client/domain/object-geometry";
import type { Decoration, Monster, Point, RegularMonsterKind } from "../../src/client/types";

describe("unreachable monster paths", () => {
  it("does not repeat a failed search until nearby scenery is destroyed, even as actors move", () => {
    const cache = new FailedPathCache();
    const monster = { x: 0, y: 0 };
    const player = { x: 200, y: 0 };
    const barrier = { destroyed: false };
    const search = vi.fn(() => chooseReachablePath(
      monster, [player], point => barrier.destroyed || point.x < 80 || point.x > 120,
      13, 300, () => ({ minX: 0, maxX: 220, minY: -40, maxY: 40 }),
    ));
    const update = () => {
      if (cache.unchanged(monster)) return null;
      const result = search();
      if (!result) cache.remember(monster, [barrier]);
      return result;
    };

    for (let tick = 0; tick < 120; tick++) {
      expect(update()).toBeNull();
      monster.y += 1;
      player.x += 1;
    }
    expect(search).toHaveBeenCalledTimes(1);
    barrier.destroyed = true;
    expect(update()?.path.at(-1)).toEqual(player);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate after partial scenery damage", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const scenery = { hp: 5, destroyed: false };
    cache.remember(actor, [scenery]);
    scenery.hp -= 1;
    expect(cache.unchanged(actor)).toBe(true);
  });

  it("only wakes monsters watching the destroyed scenery", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const other = { x: 1000, y: 0 };
    const near = { destroyed: false };
    const far = { destroyed: false };
    cache.remember(actor, [near]);
    cache.remember(other, [far]);
    far.destroyed = true;
    expect(cache.unchanged(actor)).toBe(true);
    expect(cache.unchanged(other)).toBe(false);
    near.destroyed = true;
    expect(cache.unchanged(actor)).toBe(false);
    expect(cache.has(actor)).toBe(false);
  });

  it("stays cached if there is no nearby destructible scenery", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    cache.remember(actor, []);
    actor.x += 100;
    expect(cache.unchanged(actor)).toBe(true);
  });

  it("does not watch scenery that was already destroyed when the search failed", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    cache.remember(actor, [{ destroyed: true }]);
    expect(cache.unchanged(actor)).toBe(true);
  });

  it("keeps failures independent between monsters and releases a recovered route", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const other = { x: 20, y: 0 };
    cache.remember(actor, []);
    expect(cache.has(other)).toBe(false);
    cache.forget(actor);
    expect(cache.unchanged(actor)).toBe(false);
  });

  it("wakes a miniboss when the player moves out of an unreachable area", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const player = { x: 200, y: 0, roomId: 1 };
    const walkable = (point: Point) => point.x >= 0 && point.x < 100 && Math.abs(point.y) <= 40;
    const search = vi.fn(() => chooseReachablePath(actor, [player], walkable, 13, 300,
      () => ({ minX: 0, maxX: 220, minY: -40, maxY: 40 }), true));
    const update = () => {
      if (cache.unchanged(actor, player, 0)) return null;
      const route = search();
      if (!route || route.partial) cache.remember(actor, [], player);
      return route;
    };

    expect(update()).toMatchObject({ partial: true });
    for (let tick = 0; tick < 120; tick++) {
      player.y = tick % 2; // Small input jitter must not trigger repeated A* searches.
      expect(update()).toBeNull();
    }
    expect(search).toHaveBeenCalledTimes(1);
    player.x = 80;
    expect(update()?.path.at(-1)).toEqual(player);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("wakes a miniboss on room changes without needing scenery destruction", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const target = { x: 100, y: 0, roomId: 1 };
    cache.remember(actor, [], target);
    expect(cache.unchanged(actor, target)).toBe(true);
    target.roomId = 2;
    expect(cache.unchanged(actor, target)).toBe(false);
  });

  it("throttles miniboss retries when the target remains unreachable", () => {
    const cache = new FailedPathCache();
    const actor = { x: 0, y: 0 };
    const target = { x: 100, y: 0, roomId: 1 };
    const search = vi.fn();
    for (let timestamp = 0; timestamp < 5_000; timestamp += 16) {
      if (cache.unchanged(actor, target, timestamp)) continue;
      search();
      cache.remember(actor, [], target, timestamp + 2_000);
    }
    expect(search).toHaveBeenCalledTimes(3);
  });
});

describe("partial miniboss routes", () => {
  const bounds = { minX: 0, maxX: 220, minY: -40, maxY: 40 };
  const start = { x: 0, y: 0 };
  const goal = { x: 200, y: 0 };

  it("approaches a doorway it cannot fit through without crossing the blocked band", () => {
    const walkable = (point: Point) => point.x < 80 || point.x > 120;
    const route = chooseReachablePath(start, [goal], walkable, 13, 300, () => bounds, true);
    expect(route?.partial).toBe(true);
    expect(route?.path.at(-1)?.x).toBeGreaterThan(50);
    expect(route?.path.at(-1)?.x).toBeLessThan(80);
    expect(route!.path.slice(1).every((point, index) => walkableSegment(route!.path[index]!, point, walkable))).toBe(true);
    expect(chooseReachablePath(start, [goal], walkable, 13, 300, () => bounds)).toBeNull();
  });

  it("still approaches the player when their exact position is too narrow for the actor", () => {
    const route = chooseReachablePath(start, [goal], point => point.x < 80, 13, 300, () => bounds, true);
    expect(route).toMatchObject({ partial: true, targetIndex: 0 });
    expect(route?.path.at(-1)?.x).toBeGreaterThan(50);
    expect(route?.path.at(-1)?.x).toBeLessThan(80);
  });

  it("prefers a complete fallback route over a partial player route", () => {
    const fallback = { x: 26, y: 26 };
    const route = chooseReachablePath(start, [goal, fallback], point => point.x < 80,
      13, 300, () => bounds, true);
    expect(route?.targetIndex).toBe(1);
    expect(route?.partial).toBeUndefined();
    expect(route?.path.at(-1)).toEqual(fallback);
  });

  it("does not fabricate a partial route when the actor cannot move closer", () => {
    const route = chooseReachablePath(start, [goal], point => point.x <= 0,
      13, 300, () => bounds, true);
    expect(route).toBeNull();
  });

  it("finishes the route after the miniboss breaks the blocking scenery", () => {
    const barrier = { destroyed: false };
    const walkable = (point: Point) => barrier.destroyed || point.x < 80 || point.x > 120;
    const route = chooseReachablePath(start, [goal], walkable, 13, 300, () => bounds, true);
    const actor = miniboss("shooter-heavy");
    Object.assign(actor, route!.path.at(-1));
    const blocker = crate("doorway-crate", { x: 95, y: 0 });
    const cache = new FailedPathCache();
    const target = { ...goal, roomId: 1 };
    cache.remember(actor, [blocker], target);
    expect(meleeBlockingScenery(actor, goal, [blocker])).toBe(blocker);
    expect(applyObstacleDamage(blocker, blocker.hp)).toBe(true);
    barrier.destroyed = blocker.destroyed;
    expect(cache.unchanged(actor, target)).toBe(false);
    const recovered = chooseReachablePath(actor, [goal], walkable, 13, 300, () => bounds, true);
    expect(recovered?.partial).toBeUndefined();
    expect(recovered?.path.at(-1)).toEqual(goal);
  });
});

const walker = (): Monster => ({
  ...REGULAR_MONSTER_DEFINITIONS["melee-light"],
  id: "walker", seed: 0, x: 0, y: 0, roomId: 0, spawnRoomId: 0,
  maxHp: 5, hp: 5, active: true, dead: false, miniboss: false,
  lastAttackAt: -Infinity, dropsLoot: false,
});
const crate = (id: string, point: Point): Decoration => ({
  ...DECORATION_DEFINITIONS.crateCargo,
  ...point, id, roomId: 0, maxHp: 5, hp: 5, destroyed: false, dropKind: null,
});
const miniboss = (kind: RegularMonsterKind = "melee-heavy"): Monster => {
  const definition = REGULAR_MONSTER_DEFINITIONS[kind];
  return { ...walker(), ...definition, kind, miniboss: true,
    size: definition.size * MINIBOSS_SIZE_MULTIPLIER,
    spriteSize: definition.spriteSize * MINIBOSS_SIZE_MULTIPLIER };
};

describe("melee scenery blockers", () => {
  it("chooses the nearest destructible obstacle immediately ahead", () => {
    const near = crate("near", { x: 55, y: 0 });
    const farther = crate("farther", { x: 70, y: 0 });
    expect(meleeBlockingScenery(walker(), { x: 200, y: 0 }, [farther, near])).toBe(near);
  });

  it("does not attack distant, side, or rear scenery", () => {
    const items = [crate("distant", { x: 200, y: 0 }), crate("side", { x: 10, y: 100 }),
      crate("rear", { x: -40, y: 0 })];
    expect(meleeBlockingScenery(walker(), { x: 200, y: 0 }, items)).toBeNull();
  });

  it("can break out when already embedded in a scenery footprint", () => {
    const blocker = crate("embedded", { x: 0, y: 0 });
    expect(meleeBlockingScenery(walker(), { x: 200, y: 0 }, [blocker])).toBe(blocker);
  });

  it("ignores destroyed, indestructible, and nonblocking scenery", () => {
    const items = [
      { ...crate("destroyed", { x: 55, y: 0 }), destroyed: true },
      { ...crate("indestructible", { x: 55, y: 0 }), destructible: false },
      { ...crate("nonblocking", { x: 55, y: 0 }), obstacle: false },
    ];
    expect(meleeBlockingScenery(walker(), { x: 200, y: 0 }, items)).toBeNull();
  });

  it("does not apply walker obstacle attacks to shooters, sentries, or bosses", () => {
    const items = [crate("blocker", { x: 55, y: 0 })];
    expect(meleeBlockingScenery({ ...walker(), attackPattern: "single" }, { x: 200, y: 0 }, items)).toBeNull();
    expect(meleeBlockingScenery({ ...walker(), speed: 0 }, { x: 200, y: 0 }, items)).toBeNull();
    expect(meleeBlockingScenery({ ...walker(), bossKind: "glm-hunter" }, { x: 200, y: 0 }, items)).toBeNull();
  });

  it.each(["melee-light", "melee-heavy", "shooter-light", "shooter-heavy"] as const)(
    "lets a moving %s miniboss destroy blocking props", kind => {
      const blocker = crate("blocker", { x: 55, y: 0 });
      expect(meleeBlockingScenery(miniboss(kind), { x: 200, y: 0 }, [blocker])).toBe(blocker);
    },
  );

  it("clears a rear prop snagging a miniboss's enlarged footprint at a corner", () => {
    const actor = miniboss();
    const blocker = crate("corner-prop", { x: 0, y: 0 });
    blocker.x = -worldPoint(actor, "footprintRadii").x - worldPoint(blocker, "footprintRadii").x + 1;
    expect(meleeBlockingScenery(actor, { x: 200, y: 0 }, [blocker])).toBe(blocker);
    expect(meleeBlockingScenery(actor, actor, [blocker])).toBe(blocker);
  });

  it("targets scenery blocking the next waypoint rather than the player's direct bearing", () => {
    const actor = miniboss("shooter-heavy");
    const blocker = crate("corner-prop", { x: 0, y: 0 });
    blocker.y = worldPoint(actor, "footprintRadii").y + worldPoint(blocker, "footprintRadii").y + 10;
    expect(meleeBlockingScenery(actor, { x: 200, y: 0 }, [blocker])).toBeNull();
    expect(meleeBlockingScenery(actor, { x: 0, y: 200 }, [blocker])).toBe(blocker);
  });

  it("does not give stationary sentry minibosses scenery-breaking movement attacks", () => {
    const blocker = crate("blocker", { x: 55, y: 0 });
    expect(meleeBlockingScenery(miniboss("sentry-heavy"), { x: 200, y: 0 }, [blocker])).toBeNull();
  });
});
