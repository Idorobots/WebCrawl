import { describe, expect, it, vi } from "vitest";
import { chooseReachablePath, PathSearchBudget, SharedPathCache, walkableSegment } from "../../src/client/domain/pathfinding";
import { wallBlocksSegment, wallOverlapsEllipse, WallRectIndex } from "../../src/client/domain/wall-collision";
import type { Point } from "../../src/client/types";

describe("shared static monster paths", () => {
  const key = "35,35:false::1";
  const target = { x: 200, y: 0 };
  // A wall across the direct route, with its doorway at the bottom.
  const walkable = (point: Point) => point.x < 80 || point.x > 120 || point.y >= 60;
  const search = (start: Point) => chooseReachablePath(start, [target], walkable, 13, 1800,
    () => ({ minX: -80, maxX: 220, minY: -40, maxY: 100 }), true);

  it("lets a crowd join one donor route through a doorway without running A* for each monster", () => {
    const cache = new SharedPathCache();
    const compute = vi.fn(search);
    const donor = { x: 0, y: 0 };
    const route = compute(donor)!;
    expect(route.partial).toBeUndefined();
    cache.remember(key, donor, [target], route, 0);
    for (let index = 1; index <= 40; index++) {
      const start = { x: -index, y: index % 10 };
      const reused = cache.find(key, start, [target], walkable, 500);
      expect(reused).not.toBeNull();
      expect(reused!.path.at(-1)).toEqual(target);
      expect(reused!.path.slice(1).every((point, step) => walkableSegment(reused!.path[step]!, point, walkable))).toBe(true);
    }
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("rejects an inaccessible connector even when the cached tail reaches the player", () => {
    const cache = new SharedPathCache();
    cache.remember(key, { x: 0, y: 0 }, [target], search({ x: 0, y: 0 })!, 0);
    expect(cache.find(key, { x: -50, y: 0 }, [target], point => point.x >= 0 && walkable(point), 100)).toBeNull();
  });

  it("checks the swept connector so a narrow wall between sampled points cannot trap a follower", () => {
    const cache = new SharedPathCache();
    const donor = { x: 0, y: 0 };
    const goal = { x: 30, y: 0 };
    const follower = { x: -10, y: 0 };
    const walls = new WallRectIndex([{ x: -6, y: -100, width: 1, height: 200 }]);
    const radii = { x: 1, y: 1 };
    const clear = (point: Point) => !wallOverlapsEllipse(point, radii, walls);
    cache.remember(key, donor, [goal], { path: [donor, goal], targetIndex: 0 }, 0);
    expect(walkableSegment(follower, donor, clear)).toBe(true);
    expect(cache.find(key, follower, [goal], clear, 100,
      (from, to) => !wallBlocksSegment(from, to, radii, walls) && walkableSegment(from, to, clear))).toBeNull();
  });

  it("does not share routes between different footprints, scenery policies, or target rooms", () => {
    const cache = new SharedPathCache();
    cache.remember(key, { x: 0, y: 0 }, [target], search({ x: 0, y: 0 })!, 0);
    for (const incompatible of ["50,50:false::1", "35,35:true::1", "35,35:false::2"]) {
      expect(cache.find(incompatible, { x: 0, y: 0 }, [target], walkable, 100)).toBeNull();
    }
    expect(cache.find(key, { x: 0, y: 0 }, [{ x: 260, y: 0 }], walkable, 100)).toBeNull();
  });

  it("safely reconnects to a nearby moved target without changing another monster's path", () => {
    const cache = new SharedPathCache();
    const start = { x: 0, y: 0 };
    const route = search(start)!;
    cache.remember(key, start, [target], route, 0);
    route.path[1]!.x = -1000;
    const moved = { x: target.x + 10, y: 10 };
    const reused = cache.find(key, { x: -10, y: 0 }, [moved], walkable, 100)!;
    expect(reused.path.at(-1)).toEqual(moved);
    reused.path[1]!.x = -2000;
    const another = cache.find(key, start, [target], walkable, 200)!;
    expect(another.path.every(point => point.x > -1000)).toBe(true);
  });

  it("shares partial approaches briefly and upgrades them once the nearby target becomes reachable", () => {
    const cache = new SharedPathCache();
    cache.remember(key, { x: 0, y: 0 }, [target], { path: [{ x: 0, y: 0 }, { x: 65, y: 0 }], targetIndex: 0, partial: true }, 0);
    expect(cache.find(key, { x: -10, y: 0 }, [target], point => point.x < 80, 100)?.partial).toBe(true);
    const recovered = cache.find(key, { x: -10, y: 0 }, [target], () => true, 200)!;
    expect(recovered.partial).toBeUndefined();
    expect(recovered.path.at(-1)).toEqual(target);
    expect(cache.find(key, { x: -10, y: 0 }, [target], () => true, 1500)).toBeNull();
  });

  it("continues from a room fallback to a now reachable player instead of parking at the waypoint", () => {
    const cache = new SharedPathCache();
    const fallback = { x: 100, y: 0 };
    cache.remember(key, { x: 0, y: 0 }, [target, fallback], { path: [fallback], targetIndex: 1 }, 0);
    const reused = cache.find(key, { x: -10, y: 0 }, [target, fallback], () => true, 100)!;
    expect(reused.targetIndex).toBe(0);
    expect(reused.path.at(-1)).toEqual(target);
  });

  it("does not force a follower to visit the donor's goal before its own nearby endpoint", () => {
    const cache = new SharedPathCache();
    const start = { x: 0, y: 0 };
    const donorGoal = { x: 100, y: 0 };
    const followerGoal = { x: 100, y: 30 };
    cache.remember(key, start, [donorGoal], {
      path: [start, { x: 60, y: 0 }, donorGoal], targetIndex: 0,
    }, 0);
    const route = cache.find(key, { x: -10, y: 0 }, [followerGoal], () => true, 100)!;
    expect(route.path.at(-1)).toEqual(followerGoal);
    expect(route.path).not.toContainEqual(donorGoal);
  });

  it("drops shared routes after geometry invalidation or expiry", () => {
    const cache = new SharedPathCache();
    const start = { x: 0, y: 0 };
    cache.remember(key, start, [target], search(start)!, 0);
    expect(cache.find(key, start, [target], walkable, 3000)).toBeNull();
    cache.remember(key, start, [target], search(start)!, 4000);
    cache.clear();
    expect(cache.find(key, start, [target], walkable, 4100)).toBeNull();
  });
});

describe("aggregate monster search budget", () => {
  it("limits a crowd to one new route search per 100ms rather than one search per actor", () => {
    const budget = new PathSearchBudget();
    let searches = 0;
    for (let timestamp = 0; timestamp < 1000; timestamp += 10) {
      for (let actor = 0; actor < 100; actor++) if (budget.take(timestamp)) searches++;
    }
    expect(searches).toBe(10);
    budget.clear();
    expect(budget.take(999)).toBe(true);
  });
});
