import type { DungeonLayout, Point } from "../types";
import { WORLD_GEOMETRY } from "./specs";

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function revealedRoomPath(
  layout: DungeonLayout | null,
  visitedRooms: ReadonlySet<number>,
  fromRoomId: number | null,
  toRoomId: number | null,
): number[] | null {
  if (!layout || fromRoomId === null || toRoomId === null) return null;
  if (fromRoomId === toRoomId) return [fromRoomId];

  const adjacency = new Map<number, number[]>();
  for (const room of layout.nodes) if (visitedRooms.has(room.id)) adjacency.set(room.id, []);
  for (const link of layout.links) {
    const source = link.source.id;
    const target = link.target.id;
    if (visitedRooms.has(source) && visitedRooms.has(target)) {
      adjacency.get(source)?.push(target);
      adjacency.get(target)?.push(source);
    }
  }
  if (!adjacency.has(fromRoomId) || !adjacency.has(toRoomId)) return null;

  const queue = [fromRoomId];
  const previous = new Map<number, number | null>([[fromRoomId, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === toRoomId) {
        const path = [toRoomId];
        let cursor: number | null = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

interface AStarNode {
  x: number;
  y: number;
  f: number;
  g: number;
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

function pushOpen(open: AStarNode[], node: AStarNode): void {
  open.push(node);
  let index = open.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (open[parent]!.f <= node.f) break;
    open[index] = open[parent]!;
    index = parent;
  }
  open[index] = node;
}

function popOpen(open: AStarNode[]): AStarNode | undefined {
  const first = open[0];
  const last = open.pop();
  if (!first || !last || !open.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= open.length) break;
    const child = right < open.length && open[right]!.f < open[left]!.f ? right : left;
    if (open[child]!.f >= last.f) break;
    open[index] = open[child]!;
    index = child;
  }
  open[index] = last;
  return first;
}

/** Check the space between waypoints, including thin doorway wall bands. */
export function walkableSegment(
  from: Point,
  to: Point,
  isWalkable: (point: Point) => boolean,
  maxStep = WORLD_GEOMETRY.wallThickness / 2,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segments = Math.max(1, Math.ceil(Math.hypot(dx, dy) / maxStep));
  for (let index = 1; index <= segments; index += 1) {
    const fraction = index / segments;
    if (!isWalkable({ x: from.x + dx * fraction, y: from.y + dy * fraction })) return false;
  }
  return true;
}

/** Projectiles are drawn at visual height, but collide with walls at floor height. */
export function walkableProjectileLine(
  from: Point,
  to: Point,
  visualOffsetY: number,
  isWalkable: (point: Point) => boolean,
): boolean {
  const floorFrom = { x: from.x, y: from.y - visualOffsetY };
  if (!isWalkable(from) || !isWalkable(floorFrom)) return false;
  return walkableSegment(from, to, isWalkable) &&
    walkableSegment(floorFrom, { x: to.x, y: to.y - visualOffsetY }, isWalkable);
}

/** Prefer a reachable player position over a graph-room waypoint. */
export function chooseReachablePath(
  start: Point,
  targets: readonly Point[],
  isWalkable: (point: Point) => boolean,
  step: number,
  maxIterations: number,
  boundsFor: (target: Point) => Bounds,
): { path: Point[]; targetIndex: number } | null {
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (!isWalkable(target)) continue;
    let path: Point[] | null = null;
    if (walkableSegment(start, target, isWalkable)) {
      path = [target];
    } else {
      const longRoute = Math.hypot(target.x - start.x, target.y - start.y) > step * 32;
      if (longRoute) path = aStarPath(start, target, isWalkable, step * 2, maxIterations, boundsFor(target));
      path ??= aStarPath(start, target, isWalkable, step,
        index === 0 && longRoute ? Math.max(maxIterations, 6000) : maxIterations, boundsFor(target));
    }
    if (path) return { path, targetIndex: index };
  }
  return null;
}

/** Find a nearby position for a larger actor when the target hugs a wall. */
export function walkableApproachPoint(
  target: Point,
  from: Point,
  isWalkable: (point: Point) => boolean,
  hasAccessToTarget: (point: Point) => boolean,
  maxDistance: number,
  step = WORLD_GEOMETRY.pathGridStep,
): Point | null {
  if (isWalkable(target)) return target;
  const angle = Math.atan2(from.y - target.y, from.x - target.x);
  for (let distance = step; distance <= maxDistance; distance += step) {
    for (let index = 0; index < 16; index += 1) {
      const offset = Math.ceil(index / 2) * (index % 2 ? 1 : -1);
      const direction = angle + offset * Math.PI / 8;
      const candidate = {
        x: target.x + Math.cos(direction) * distance,
        y: target.y + Math.sin(direction) * distance,
      };
      if (isWalkable(candidate) && hasAccessToTarget(candidate)) return candidate;
    }
  }
  return null;
}

export function aStarPath(
  start: Point,
  goal: Point,
  isWalkable: (point: Point) => boolean,
  step = 20,
  maxIterations = 2500,
  bounds?: Bounds,
): Point[] | null {
  if (!isWalkable(goal)) return null;

  const inBounds = (point: Point): boolean => {
    if (!bounds) return true;
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  };

  const neighbors = [
    { x: -1, y: 0, cost: 1 },
    { x: 1, y: 0, cost: 1 },
    { x: 0, y: -1, cost: 1 },
    { x: 0, y: 1, cost: 1 },
    { x: -1, y: -1, cost: Math.SQRT2 },
    { x: 1, y: -1, cost: Math.SQRT2 },
    { x: -1, y: 1, cost: Math.SQRT2 },
    { x: 1, y: 1, cost: Math.SQRT2 },
  ];

  const open: AStarNode[] = [];
  const previous = new Map<string, string | null>();
  const bestCost = new Map<string, number>();
  const gridX = Math.round(start.x / step) * step;
  const gridY = Math.round(start.y / step) * step;
  // An actor can stand near a wall while its nearest snapped grid point is
  // blocked. Connect to any nearby cell it can actually reach instead.
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const point = { x: gridX + offsetX * step, y: gridY + offsetY * step };
      if (!inBounds(point) || !walkableSegment(start, point, isWalkable)) continue;
      const key = pointKey(point.x, point.y);
      const cost = Math.hypot(point.x - start.x, point.y - start.y) / step;
      previous.set(key, null);
      bestCost.set(key, cost);
      pushOpen(open, { ...point, g: cost, f: cost + Math.hypot(goal.x - point.x, goal.y - point.y) / step });
    }
  }

  for (let iterations = 0; open.length && iterations < maxIterations; iterations += 1) {
    const current = popOpen(open);
    if (!current) break;
    const currentKey = pointKey(current.x, current.y);
    if (current.g > (bestCost.get(currentKey) ?? Infinity)) continue;
    if (Math.hypot(goal.x - current.x, goal.y - current.y) <= step * Math.SQRT2 &&
      walkableSegment(current, goal, isWalkable)) {
      const path: Point[] = [goal, { x: current.x, y: current.y }];
      let cursor = previous.get(currentKey) ?? null;
      while (cursor) {
        const [x = 0, y = 0] = cursor.split(",").map(Number);
        path.push({ x, y });
        cursor = previous.get(cursor) ?? null;
      }
      return [start, ...path.reverse()];
    }

    for (const neighbor of neighbors) {
      const next = {
        x: current.x + neighbor.x * step,
        y: current.y + neighbor.y * step,
      };
      if (!inBounds(next) || !walkableSegment(current, next, isWalkable)) continue;

      if (neighbor.x !== 0 && neighbor.y !== 0) {
        const horizontal = { x: current.x + neighbor.x * step, y: current.y };
        const vertical = { x: current.x, y: current.y + neighbor.y * step };
        if (!inBounds(horizontal) || !inBounds(vertical) ||
          !walkableSegment(current, horizontal, isWalkable) ||
          !walkableSegment(current, vertical, isWalkable)) continue;
      }

      const nextKey = pointKey(next.x, next.y);
      const nextCost = current.g + neighbor.cost;
      if (nextCost >= (bestCost.get(nextKey) ?? Infinity)) continue;

      bestCost.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      pushOpen(open, {
        x: next.x,
        y: next.y,
        g: nextCost,
        f: nextCost + Math.hypot(goal.x - next.x, goal.y - next.y) / step,
      });
    }
  }

  return null;
}

export function monsterEscapeStep(
  position: Point,
  desiredDirection: Point,
  distance: number,
  isWalkable: (point: Point) => boolean,
  seed = 0,
): Point | null {
  const magnitude = Math.hypot(desiredDirection.x, desiredDirection.y);
  const forward = magnitude > 0
    ? { x: desiredDirection.x / magnitude, y: desiredDirection.y / magnitude }
    : { x: 1, y: 0 };
  const side = seed % 2 === 0 ? 1 : -1;
  const angles = [side * Math.PI / 2, -side * Math.PI / 2, side * Math.PI / 4, -side * Math.PI / 4, Math.PI];
  for (const angle of angles) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const direction = {
      x: forward.x * cosine - forward.y * sine,
      y: forward.x * sine + forward.y * cosine,
    };
    const candidate = {
      x: position.x + direction.x * distance,
      y: position.y + direction.y * distance,
    };
    if (isWalkable(candidate)) return candidate;
  }
  return null;
}
