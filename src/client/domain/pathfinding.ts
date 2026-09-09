import type { DungeonLayout } from "../types";

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
