import { describe, expect, it, vi } from "vitest";
import { meleeBlockingScenery } from "../../src/client/domain/combat";
import { chooseReachablePath, FailedPathCache } from "../../src/client/domain/pathfinding";
import { DECORATION_DEFINITIONS, REGULAR_MONSTER_DEFINITIONS } from "../../src/client/domain/specs";
import type { Decoration, Monster, Point } from "../../src/client/types";

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
});
