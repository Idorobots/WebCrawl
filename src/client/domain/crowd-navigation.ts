import type { Monster, Point } from "../types";
import { monsterBlockingRadii } from "./spatial";

/** Continue a short, committed detour instead of immediately turning back into the same blocker. */
export function continueCrowdDetour(
  monster: Monster, distance: number, timestamp: number, isClear: (point: Point) => boolean,
): Point | null {
  if (!monster.escapeDirection || timestamp >= (monster.escapeUntil ?? 0)) {
    monster.escapeDirection = undefined;
    monster.escapeUntil = undefined;
    return null;
  }
  const next = { x: monster.x + monster.escapeDirection.x * distance,
    y: monster.y + monster.escapeDirection.y * distance };
  if (isClear(next)) return next;
  monster.escapeDirection = undefined;
  monster.escapeUntil = undefined;
  monster.nextCrowdAvoidanceAt = timestamp + 100;
  return null;
}

/** Probe a bounded set of local lanes, with stable right-of-way for a blocked pair. */
export function beginCrowdDetour(
  monster: Monster, direction: Point, blockers: ReadonlySet<Monster>, distance: number,
  timestamp: number, isClear: (point: Point) => boolean,
): Point | null {
  if (!blockers.size || monster.speed <= 0 || distance <= 0) return null;
  const magnitude = Math.hypot(direction.x, direction.y);
  const forward = magnitude > 0 ? { x: direction.x / magnitude, y: direction.y / magnitude } : { x: 1, y: 0 };
  const radii = monsterBlockingRadii(monster);
  let clearance = Math.max(radii.x, radii.y) * 2 + 8;
  let yields = false;
  for (const other of blockers) {
    const otherRadii = monsterBlockingRadii(other);
    clearance = Math.max(clearance, radii.x + otherRadii.x + 8, radii.y + otherRadii.y + 8);
    if (other.active && other.speed > 0 && other.id < monster.id) yields = true;
  }
  // Both actors keep to their own right when facing one another. The lower
  // priority actor can back out of a choke point instead of mirroring its peer.
  const angles = [-Math.PI / 6, Math.PI / 6, -Math.PI / 3, Math.PI / 3, -Math.PI / 2, Math.PI / 2];
  if (yields) angles.push(-Math.PI * 3 / 4, Math.PI * 3 / 4, Math.PI);
  for (const probe of [clearance, Math.min(clearance, Math.max(distance, 8))]) {
    for (const angle of angles) {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const escape = { x: forward.x * cosine - forward.y * sine, y: forward.x * sine + forward.y * cosine };
      if (!isClear({ x: monster.x + escape.x * probe, y: monster.y + escape.y * probe })) continue;
      const next = { x: monster.x + escape.x * distance, y: monster.y + escape.y * distance };
      if (!isClear(next)) continue;
      monster.escapeDirection = escape;
      monster.escapeUntil = timestamp + Math.min(1500, Math.max(400, clearance / monster.speed * 1000));
      return next;
    }
  }
  return null;
}
