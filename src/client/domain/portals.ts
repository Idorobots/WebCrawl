import type { Monster, Point, Stair } from "../types";
import { PORTAL_DEFINITION } from "./world-specs";
import { ellipseContainsEllipse } from "./geometry";
import type { EllipseRadii } from "../types";

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
  if (!portal) return { x: fallback.x, y: fallback.y };
  const offset = PORTAL_DEFINITION.spawnOffset;
  return { x: portal.x + offset.x, y: portal.y + offset.y };
}

export function closestPortalWithUrl(portals: readonly Stair[], position: Point, radius: number): Stair | null {
  let closest: Stair | null = null;
  let closestDistance = radius * radius;
  for (const portal of portals) {
    if (!portal.url) continue;
    const dx = position.x - portal.x;
    const dy = position.y - portal.y;
    const distance = dx * dx + dy * dy;
    if (distance > closestDistance || (closest && distance === closestDistance)) continue;
    closest = portal;
    closestDistance = distance;
  }
  return closest;
}

type PortalEnemy = Pick<Monster, "dead" | "bossKind" | "roomId" | "spawnRoomId">;

export function hasBlockingPortalMonsters(monsters: readonly PortalEnemy[], revealedRooms: ReadonlySet<number>): boolean {
  return monsters.some(monster => !monster.dead && (
    monster.bossKind !== undefined ||
    revealedRooms.has(monster.spawnRoomId) || revealedRooms.has(monster.roomId)
  ));
}

export function updatePortalAvailability(
  portals: Stair[],
  monsters: readonly PortalEnemy[],
  revealedRooms: ReadonlySet<number>,
): boolean {
  const floorCleared = !hasBlockingPortalMonsters(monsters, revealedRooms);
  let changed = false;
  for (const portal of portals) {
    const enabled = floorCleared && portal.url !== null;
    if (portal.enabled === enabled) continue;
    portal.enabled = enabled;
    changed = true;
  }
  return changed;
}

export function updatePortalContacts(
  portals: readonly Stair[],
  position: Point,
  playerFootprint: EllipseRadii,
  contacts: Set<string>,
): Stair | null {
  const overlapping = portals.filter(portal => portal.enabled &&
    ellipseContainsEllipse(portal, PORTAL_DEFINITION.footprintRadii, position, playerFootprint));
  const overlappingIds = new Set(overlapping.map(portal => portal.id));
  for (const id of contacts) {
    if (!overlappingIds.has(id)) contacts.delete(id);
  }
  const entered = overlapping.find(portal => !contacts.has(portal.id)) ?? null;
  for (const portal of overlapping) contacts.add(portal.id);
  return entered;
}
