import type { DungeonLayout, Point } from "../types";

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

export function aStarPath(
  start: Point,
  goal: Point,
  isWalkable: (point: Point) => boolean,
  step = 20,
  maxIterations = 2500,
  bounds?: Bounds,
): Point[] | null {
  const snappedStart = {
    x: Math.round(start.x / step) * step,
    y: Math.round(start.y / step) * step,
  };
  const snappedGoal = {
    x: Math.round(goal.x / step) * step,
    y: Math.round(goal.y / step) * step,
  };
  if (!isWalkable(snappedStart) || !isWalkable(snappedGoal)) return null;

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

  const open: AStarNode[] = [{
    x: snappedStart.x,
    y: snappedStart.y,
    g: 0,
    f: Math.hypot(snappedGoal.x - snappedStart.x, snappedGoal.y - snappedStart.y) / step,
  }];
  const previous = new Map<string, string | null>([[pointKey(snappedStart.x, snappedStart.y), null]]);
  const bestCost = new Map<string, number>([[pointKey(snappedStart.x, snappedStart.y), 0]]);

  for (let iterations = 0; open.length && iterations < maxIterations; iterations += 1) {
    const current = popOpen(open);
    if (!current) break;
    const currentKey = pointKey(current.x, current.y);
    if (current.g > (bestCost.get(currentKey) ?? Infinity)) continue;
    if (current.x === snappedGoal.x && current.y === snappedGoal.y) {
      const path: Point[] = [{ x: current.x, y: current.y }];
      let cursor = previous.get(currentKey) ?? null;
      while (cursor) {
        const [x = 0, y = 0] = cursor.split(",").map(Number);
        path.push({ x, y });
        cursor = previous.get(cursor) ?? null;
      }
      return path.reverse();
    }

    for (const neighbor of neighbors) {
      const next = {
        x: current.x + neighbor.x * step,
        y: current.y + neighbor.y * step,
      };
      if (!inBounds(next) || !isWalkable(next)) continue;

      if (neighbor.x !== 0 && neighbor.y !== 0) {
        const horizontal = { x: current.x + neighbor.x * step, y: current.y };
        const vertical = { x: current.x, y: current.y + neighbor.y * step };
        if (!inBounds(horizontal) || !inBounds(vertical) || !isWalkable(horizontal) || !isWalkable(vertical)) continue;
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
        f: nextCost + Math.hypot(snappedGoal.x - next.x, snappedGoal.y - next.y) / step,
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
