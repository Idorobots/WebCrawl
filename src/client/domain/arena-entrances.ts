import type { DungeonLayout, GraphNode, Point } from "../types";

export interface ArenaEntrance {
  arena: GraphNode;
  position: Point;
}

/** Distance from an arena doorway inside which no monster may spawn or be summoned. */
export const ARENA_ENTRANCE_KEEP_OUT_DISTANCE = 180;

/**
 * Doorways touching a boss arena, one per arena side of each link. A link
 * between two arenas belongs to both, so each fight can seal its own doors.
 * Corridor links report each arena-side endpoint; direct links report the
 * shared doorway position. Feeds door locking and the spawn keep-out zone.
 */
export function arenaEntrances(layout: Pick<DungeonLayout, "links">): ArenaEntrance[] {
  const result: ArenaEntrance[] = [];
  for (const link of layout.links) {
    const sourceArena = link.source.isBossArena === true;
    const targetArena = link.target.isBossArena === true;
    if (sourceArena && link.points[0]) result.push({ arena: link.source, position: link.points[0] });
    if (targetArena && link.points.length) result.push({
      arena: link.target, position: link.points[link.points.length - 1]!,
    });
  }
  return result;
}

export function entrancePositionsForRoom(entrances: readonly ArenaEntrance[], roomId: number): Point[] {
  return entrances.filter(entrance => entrance.arena.id === roomId).map(entrance => entrance.position);
}

/** The player has cleared every entrance, rather than just moving away from the arena center. */
export function playerBeyondArenaDoors(doors: readonly Point[], player: Point, distance: number): boolean {
  return doors.length > 0 && doors.every(door => Math.hypot(player.x - door.x, player.y - door.y) > distance);
}

export function isNearArenaEntrance(
  entrances: readonly Point[],
  x: number,
  y: number,
  distance: number = ARENA_ENTRANCE_KEEP_OUT_DISTANCE,
): boolean {
  return entrances.some(point => Math.hypot(point.x - x, point.y - y) < distance);
}
