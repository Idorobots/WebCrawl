import { describe, expect, it, vi } from "vitest";
import { beginCrowdDetour, continueCrowdDetour } from "../../src/client/domain/crowd-navigation";
import { worldPoint } from "../../src/client/domain/object-geometry";
import { walkableSegment } from "../../src/client/domain/pathfinding";
import { REGULAR_MONSTER_DEFINITIONS } from "../../src/client/domain/specs";
import { monsterBlockingRadii, MonsterFootprintIndex } from "../../src/client/domain/spatial";
import type { Monster, Point } from "../../src/client/types";

const monster = (id: string, x: number, y = 0): Monster => ({
  ...REGULAR_MONSTER_DEFINITIONS["melee-heavy"], id, x, y, seed: 0, speed: 100,
  roomId: 0, spawnRoomId: 0, maxHp: 5, hp: 5, active: true, dead: false,
  miniboss: false, lastAttackAt: -Infinity, dropsLoot: false,
});

function advance(actor: Monster, target: Point, index: MonsterFootprintIndex, timestamp: number): void {
  const isClear = (point: Point) => walkableSegment(actor, point,
    sample => index.moveIsClear(actor, sample), 2);
  let next = continueCrowdDetour(actor, 5, timestamp, isClear);
  if (!next) {
    const distance = Math.hypot(target.x - actor.x, target.y - actor.y);
    if (distance < 0.001) return;
    const direction = { x: (target.x - actor.x) / distance, y: (target.y - actor.y) / distance };
    const preferred = { x: actor.x + direction.x * Math.min(distance, 5), y: actor.y + direction.y * Math.min(distance, 5) };
    next = isClear(preferred) ? preferred : beginCrowdDetour(actor, direction,
      index.blockingMonsters(actor, preferred), 5, timestamp, isClear);
  }
  if (next) {
    actor.x = next.x;
    actor.y = next.y;
    index.update(actor);
  }
}

describe("sustained crowd detours", () => {
  it("commits to a side long enough to walk around a stationary blocker instead of oscillating back to the route", () => {
    const blocker = monster("blocker", 0);
    blocker.speed = 0;
    const actor = monster("actor", -monsterBlockingRadii(blocker).x * 2 - 2);
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, blocker]);
    for (let timestamp = 0; timestamp < 5000; timestamp += 50) {
      advance(actor, { x: 100, y: 0 }, index, timestamp);
      expect(index.positionIsClear(actor, actor)).toBe(true);
    }
    expect(Math.hypot(actor.x - 100, actor.y)).toBeLessThan(5);
  });

  it("breaks a head-on deadlock with stable right-of-way without allowing bodies to pass through each other", () => {
    const left = monster("a", -60);
    const right = monster("b", 60);
    const index = new MonsterFootprintIndex();
    index.rebuild([left, right]);
    for (let timestamp = 0; timestamp < 5000; timestamp += 50) {
      advance(left, { x: 120, y: 0 }, index, timestamp);
      advance(right, { x: -120, y: 0 }, index, timestamp);
      expect(index.positionIsClear(left, left)).toBe(true);
    }
    expect(left.x).toBeGreaterThan(100);
    expect(right.x).toBeLessThan(-100);
  });

  it("rechecks collisions during a committed detour when another monster moves into its lane", () => {
    const actor = monster("actor", 0);
    const arriving = monster("arriving", 1000);
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, arriving]);
    actor.escapeDirection = { x: 0, y: -1 };
    actor.escapeUntil = 1000;
    expect(continueCrowdDetour(actor, 5, 100, point => index.moveIsClear(actor, point))).toEqual({ x: 0, y: -5 });
    arriving.x = 0;
    arriving.y = -monsterBlockingRadii(actor).y * 2 - 2;
    index.update(arriving);
    expect(continueCrowdDetour(actor, 5, 150, point => index.moveIsClear(actor, point))).toBeNull();
    expect(actor.escapeDirection).toBeUndefined();
    expect(actor.nextCrowdAvoidanceAt).toBe(250);
  });

  it("preserves full scenery clearance and bounds the work when no legal detour exists", () => {
    const blocker = monster("blocker", 0);
    const actor = monster("actor", -monsterBlockingRadii(blocker).x * 2 - 2);
    const full = worldPoint(actor, "footprintRadii");
    const leftWall = actor.x - full.x - 1;
    const rightWall = actor.x + full.x + 1;
    const index = new MonsterFootprintIndex();
    index.rebuild([actor, blocker]);
    const clear = vi.fn((point: Point) => walkableSegment(actor, point, sample =>
      sample.x - full.x >= leftWall && sample.x + full.x <= rightWall &&
      Math.abs(sample.y) + full.y <= full.y + 1 && index.moveIsClear(actor, sample), 2));
    expect(beginCrowdDetour(actor, { x: 1, y: 0 }, new Set([blocker]), 5, 0, clear)).toBeNull();
    expect(clear.mock.calls.length).toBeLessThanOrEqual(24);
    expect(actor.escapeDirection).toBeUndefined();
  });

  it("lets a detour expire so normal pursuit resumes", () => {
    const actor = monster("actor", 0);
    actor.escapeDirection = { x: 0, y: -1 };
    actor.escapeUntil = 500;
    expect(continueCrowdDetour(actor, 5, 500, () => true)).toBeNull();
    expect(actor.escapeUntil).toBeUndefined();
  });
});
