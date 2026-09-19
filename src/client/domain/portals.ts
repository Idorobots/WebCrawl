import type { Point, Stair } from "../types";

export function entryPortalFor(
  roomStairs: readonly Stair[],
  spawnPortalUrl?: string | null,
): Stair | null {
  return (
    (spawnPortalUrl
      ? roomStairs.find(stair => stair.url === spawnPortalUrl)
      : null) ||
    roomStairs.find(stair => stair.type === "up") ||
    roomStairs[0] ||
    null
  );
}

export function initialPlayerPosition(portal: Stair | null, fallback: Point): Point {
  return portal ? { x: portal.x, y: portal.y } : { x: fallback.x, y: fallback.y };
}

export function updatePortalContacts(
  portals: readonly Stair[],
  position: Point,
  radius: number | Point,
  contacts: Set<string>,
  offset: Point = { x: 0, y: 0 },
): Stair | null {
  const radii = typeof radius === "number" ? { x: radius, y: radius } : radius;
  const overlapping = portals.filter((portal) => {
    const dx = (position.x - (portal.x + offset.x)) / radii.x;
    const dy = (position.y - (portal.y + offset.y)) / radii.y;
    return portal.enabled && dx * dx + dy * dy <= 1;
  });
  const overlappingIds = new Set(overlapping.map(portal => portal.id));
  for (const id of contacts) {
    if (!overlappingIds.has(id)) contacts.delete(id);
  }
  const entered = overlapping.find(portal => !contacts.has(portal.id)) ?? null;
  for (const portal of overlapping) contacts.add(portal.id);
  return entered;
}
