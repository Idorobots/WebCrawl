import type { DungeonLayout, GraphNode, LayoutLink, Point } from "../types";
import { pointInCorridor } from "./geometry";
import { WORLD_GEOMETRY } from "./specs";

interface Segment {
  start: Point;
  end: Point;
}

export interface CorridorJunction {
  point: Point;
  linkIds: [string, string];
}

function between(value: number, left: number, right: number): boolean {
  return value >= Math.min(left, right) && value <= Math.max(left, right);
}

/** Centerline intersections, including the ends of a collinear shared run. */
export function segmentIntersectionPoints(first: Segment, second: Segment): Point[] {
  const firstHorizontal = first.start.y === first.end.y;
  const secondHorizontal = second.start.y === second.end.y;
  if (firstHorizontal !== secondHorizontal) {
    const horizontal = firstHorizontal ? first : second;
    const vertical = firstHorizontal ? second : first;
    const point = { x: vertical.start.x, y: horizontal.start.y };
    return between(point.x, horizontal.start.x, horizontal.end.x) &&
      between(point.y, vertical.start.y, vertical.end.y) ? [point] : [];
  }
  const axis = firstHorizontal ? "x" : "y";
  const cross = firstHorizontal ? "y" : "x";
  if (first.start[cross] !== second.start[cross]) return [];
  const start = Math.max(Math.min(first.start[axis], first.end[axis]), Math.min(second.start[axis], second.end[axis]));
  const end = Math.min(Math.max(first.start[axis], first.end[axis]), Math.max(second.start[axis], second.end[axis]));
  if (start > end) return [];
  return [...new Set([start, end])].map(value => firstHorizontal
    ? { x: value, y: first.start.y }
    : { x: first.start.x, y: value });
}

export function corridorJunctions(links: readonly LayoutLink[]): CorridorJunction[] {
  const junctions: CorridorJunction[] = [];
  const seen = new Set<string>();
  for (let left = 0; left < links.length; left += 1) {
    const first = links[left]!;
    if (first.direct) continue;
    for (let right = left + 1; right < links.length; right += 1) {
      const second = links[right]!;
      if (second.direct) continue;
      if (first.forkId && first.forkId === second.forkId) continue;
      for (let a = 1; a < first.points.length; a += 1) {
        for (let b = 1; b < second.points.length; b += 1) {
          const firstSegment = { start: first.points[a - 1]!, end: first.points[a]! };
          const secondSegment = { start: second.points[b - 1]!, end: second.points[b]! };
          const intersections = segmentIntersectionPoints(firstSegment, secondSegment);
          const collinear = (
            firstSegment.start.y === firstSegment.end.y &&
            secondSegment.start.y === secondSegment.end.y && firstSegment.start.y === secondSegment.start.y
          ) || (
            firstSegment.start.x === firstSegment.end.x &&
            secondSegment.start.x === secondSegment.end.x && firstSegment.start.x === secondSegment.start.x
          );
          const points = collinear && intersections.length === 2
            ? [{ x: (intersections[0]!.x + intersections[1]!.x) / 2,
                y: (intersections[0]!.y + intersections[1]!.y) / 2 }]
            : intersections;
          for (const point of points) {
            const key = `${first.id}:${second.id}:${point.x}:${point.y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            junctions.push({ point, linkIds: [first.id, second.id] });
          }
        }
      }
    }
  }
  return junctions;
}

/** Rooms accessible at the player's current crossing, including previously unseen ends. */
export function junctionRoomsAtPoint(
  layout: DungeonLayout,
  junctions: readonly CorridorJunction[],
  point: Point,
): GraphNode[] {
  const nearby = junctions.filter(junction =>
    Math.abs(point.x - junction.point.x) <= WORLD_GEOMETRY.corridorHalfWidth &&
    Math.abs(point.y - junction.point.y) <= WORLD_GEOMETRY.corridorHalfWidth
  );
  if (!nearby.length) return [];
  const byId = new Map(layout.links.map(link => [link.id, link]));
  const rooms = new Map<number, GraphNode>();
  for (const junction of nearby) {
    for (const id of junction.linkIds) {
      const link = byId.get(id);
      if (!link || !pointInCorridor(point.x, point.y, link, 0)) continue;
      rooms.set(link.source.id, link.source);
      rooms.set(link.target.id, link.target);
    }
  }
  return [...rooms.values()];
}

/** Room-level shortcuts are traversable only when both ends have been revealed. */
export function connectedRoomAdjacency(layout: DungeonLayout, visited: ReadonlySet<number>): Map<number, number[]> {
  const adjacency = new Map<number, Set<number>>();
  for (const room of layout.nodes) if (visited.has(room.id)) adjacency.set(room.id, new Set());
  const add = (first: number, second: number): void => {
    if (first === second || !adjacency.has(first) || !adjacency.has(second)) return;
    adjacency.get(first)!.add(second);
    adjacency.get(second)!.add(first);
  };
  for (const link of layout.links) add(link.source.id, link.target.id);
  const byId = new Map(layout.links.map(link => [link.id, link]));
  for (const { linkIds } of corridorJunctions(layout.links)) {
    const first = byId.get(linkIds[0])!;
    const second = byId.get(linkIds[1])!;
    for (const from of [first.source.id, first.target.id]) {
      for (const to of [second.source.id, second.target.id]) add(from, to);
    }
  }
  return new Map([...adjacency].map(([room, neighbors]) => [room, [...neighbors]]));
}
