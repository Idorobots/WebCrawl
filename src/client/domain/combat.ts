import type { Decoration, Monster, Point } from "../types";

export function applyObstacleDamage(item: Decoration, damage: number): boolean {
  if (!item.destructible || item.destroyed || damage <= 0) return false;
  item.hp = Math.max(0, item.hp - damage);
  item.destroyed = item.hp === 0;
  return true;
}

export function projectileHitsDecoration(
  item: Decoration,
  projectile: Point,
  projectileRadius: number,
): boolean {
  return Math.hypot(
    projectile.x - item.x,
    projectile.y - (item.y + item.hitOffsetY),
  ) <= item.radius + projectileRadius;
}

export function monsterAttackIsReady(monster: Monster, timestamp: number): boolean {
  const animation = monster.attackKind ?? "melee";
  const animationDuration = Math.max(0, ...Object.values(monster.visual.directions).map(direction => {
    const clip = direction[animation];
    return clip ? clip.frames.length * clip.frameDurationMs : 0;
  }));
  return timestamp - monster.lastAttackAt >= Math.max(monster.attackCooldownMs, animationDuration);
}

export function actorProjectileOrigin(
  anchor: Point,
  direction: Point,
  visualCenterOffsetY: number,
  muzzleDistance: number,
  lateralOffset = 0,
): Point {
  return {
    x: anchor.x + direction.x * muzzleDistance - direction.y * lateralOffset,
    y: anchor.y + visualCenterOffsetY + direction.y * muzzleDistance + direction.x * lateralOffset,
  };
}
