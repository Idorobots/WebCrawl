import type { DungeonLayout, GraphNode, Point } from "../types";
import type { CorridorJunction } from "./corridor-junctions";
import { pointInCorridor, pointNearDirectDoor } from "./geometry";
import { WORLD_GEOMETRY } from "./world-specs";

/** Discovery is separate for a corridor and each of its endpoint rooms. */
export function discoveriesAtPoint(
  layout: DungeonLayout,
  junctions: readonly CorridorJunction[],
  point: Point,
  rooms: ReadonlySet<number>,
  corridors: ReadonlySet<string>,
): { rooms: GraphNode[]; corridors: string[] } {
  const newRooms = new Map<number, GraphNode>();
  const newCorridors = new Set<string>();
  const corridorKnown = (id: string): boolean => corridors.has(id) || newCorridors.has(id);
  for (const link of layout.links) {
    const sourceKnown = rooms.has(link.source.id);
    const targetKnown = rooms.has(link.target.id);
    if (link.direct) {
      if (sourceKnown !== targetKnown && pointNearDirectDoor(point, sourceKnown ? link.source : link.target, link)) {
        const room = sourceKnown ? link.target : link.source;
        newRooms.set(room.id, room);
      }
      continue;
    }
    if (link.forkId && link.forkPointIndex !== undefined && !corridorKnown(link.id) &&
        layout.links.some(other => other.forkId === link.forkId && corridorKnown(other.id))) {
      const fork = link.points[link.forkPointIndex];
      const next = link.points[link.forkPointIndex + 1];
      if (fork && next) {
        const length = Math.hypot(next.x - fork.x, next.y - fork.y);
        const progress = length ? ((point.x - fork.x) * (next.x - fork.x) +
          (point.y - fork.y) * (next.y - fork.y)) / length : 0;
        if (progress > link.width / 2 && pointInCorridor(point.x, point.y,
          { ...link, points: link.points.slice(link.forkPointIndex) })) newCorridors.add(link.id);
      }
    }
    for (const [room, door, side] of [
      [link.source, link.points[0]!, link.direction],
      [link.target, link.points[link.points.length - 1]!, link.targetDirection ?? ({ N: "S", S: "N", E: "W", W: "E" } as const)[link.direction]],
    ] as const) {
      const offsetY = side === "E" || side === "W" ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
      if (Math.hypot(point.x - door.x, point.y - door.y - offsetY) > WORLD_GEOMETRY.segmentSize / 2) continue;
      if (rooms.has(room.id) && !corridorKnown(link.id)) newCorridors.add(link.id);
      if (corridorKnown(link.id) && !rooms.has(room.id)) newRooms.set(room.id, room);
    }
  }
  // Crossing a corridor reveals the connected floor, never its remote rooms.
  for (const junction of junctions) {
    if (Math.abs(point.x - junction.point.x) > WORLD_GEOMETRY.corridorHalfWidth ||
        Math.abs(point.y - junction.point.y) > WORLD_GEOMETRY.corridorHalfWidth) continue;
    for (const id of junction.linkIds) if (!corridorKnown(id)) newCorridors.add(id);
  }
  return { rooms: [...newRooms.values()], corridors: [...newCorridors] };
}
