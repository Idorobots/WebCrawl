import type { Point, Stair } from "../types";

export function updatePortalContacts(
  portals: readonly Stair[],
  position: Point,
  radius: number,
  contacts: Set<string>,
): Stair | null {
  const overlapping = portals.filter(portal =>
    portal.enabled && Math.hypot(position.x - portal.x, position.y - portal.y) <= radius
  );
  const overlappingIds = new Set(overlapping.map(portal => portal.id));
  for (const id of contacts) {
    if (!overlappingIds.has(id)) contacts.delete(id);
  }
  const entered = overlapping.find(portal => !contacts.has(portal.id)) ?? null;
  for (const portal of overlapping) contacts.add(portal.id);
  return entered;
}
