import type { Decoration, EllipseRadii, Monster, MonsterAttackPattern, Point } from "../types";
import { ellipseRadii, ellipsesOverlap, sweptEllipsesOverlap } from "./geometry";
import { worldPoint } from "./object-geometry";
import {
  BARREL_EXPLOSION_RADIUS,
  ENERGY_DASH_DAMAGE_PER_ENERGY,
  ENERGY_DASH_DISTANCE_PER_ENERGY,
  PLAYER_SPEC,
  WORLD_GEOMETRY,
} from "./world-specs";

export interface EnemyVolleyProjectile {
  direction: Point;
  lateralOffset: number;
}

export function monsterEngagementRange(
  monster: Pick<Monster, "speed" | "attackRange" | "projectileRange">,
): number {
  return monster.speed === 0 ? monster.projectileRange : monster.attackRange;
}

/** Melee must reach an actor standing just beyond the two occupied floor ellipses. */
export function monsterMeleeRange(monster: Pick<Monster, "size" | "attackRange" | "footprintRadii">): number {
  const footprint = worldPoint(monster, "footprintRadii");
  return Math.max(monster.attackRange, Math.max(footprint.x + PLAYER_SPEC.footprintRadii.x,
    footprint.y + PLAYER_SPEC.footprintRadii.y) + WORLD_GEOMETRY.pathGridStep * 2);
}

/** Choose scenery blocking a melee walker or moving miniboss's next steps. */
export function meleeBlockingScenery(
  monster: Monster,
  target: Point,
  decorations: Iterable<Decoration>,
): Decoration | null {
  if (monster.bossKind || monster.speed <= 0 || (!monster.miniboss && monster.attackPattern !== "melee")) return null;
  const dx = target.x - monster.x;
  const dy = target.y - monster.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001 && !monster.miniboss) return null;
  const reach = WORLD_GEOMETRY.pathGridStep * 2;
  const step = distance < 0.001 ? monster
    : { x: monster.x + dx / distance * reach, y: monster.y + dy / distance * reach };
  const footprint = worldPoint(monster, "footprintRadii");
  let closest: Decoration | null = null;
  let closestDistance = Infinity;
  for (const item of decorations) {
    if (!item.obstacle || !item.destructible || item.destroyed) continue;
    const itemDx = item.x - monster.x;
    const itemDy = item.y - monster.y;
    const itemDistance = Math.hypot(itemDx, itemDy);
    const itemFootprint = worldPoint(item, "footprintRadii");
    // Large actors can snag a prop beside or behind them at a corner. Allow
    // them to clear anything touching their footprint, not just directly ahead.
    const touching = monster.miniboss && ellipsesOverlap(monster, footprint, item, itemFootprint, true);
    if (!touching && itemDx * dx + itemDy * dy <= 0 && itemDistance > 0.001) continue;
    if (!touching && !sweptEllipsesOverlap(monster, step, footprint, item, itemFootprint)) continue;
    if (itemDistance < closestDistance) {
      closest = item;
      closestDistance = itemDistance;
    }
  }
  return closest;
}

export function enemyVolleyProjectiles(
  direction: Point,
  pattern: MonsterAttackPattern,
  barrelOffset: number,
): EnemyVolleyProjectile[] {
  if (pattern === "melee") return [];
  if (pattern === "double") {
    return [
      { direction, lateralOffset: -barrelOffset },
      { direction, lateralOffset: barrelOffset },
    ];
  }
  if (pattern === "scatter") {
    return [-0.24, -0.12, 0, 0.12, 0.24].map((angle) => {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      return {
        direction: {
          x: direction.x * cosine - direction.y * sine,
          y: direction.x * sine + direction.y * cosine,
        },
        lateralOffset: 0,
      };
    });
  }
  return [{ direction, lateralOffset: 0 }];
}

export function applyObstacleDamage(item: Decoration, damage: number): boolean {
  if (!item.destructible || item.destroyed || damage <= 0) return false;
  item.hp = Math.max(0, item.hp - damage);
  item.destroyed = item.hp === 0;
  return true;
}

/** Sweep the boss's footprint across one movement step so fast charges cannot skip scenery. */
export function bossCrushedScenery<T extends Pick<Decoration, "size" | "x" | "y" | "footprintRadii" | "destructible" | "destroyed">>(
  from: Point,
  to: Point,
  bossRadius: number | EllipseRadii,
  decorations: readonly T[],
): T[] {
  return decorations.filter(item => {
    if (!item.destructible || item.destroyed) return false;
    return sweptEllipsesOverlap(from, to, ellipseRadii(bossRadius), item, worldPoint(item, "footprintRadii"));
  });
}

export function energyDashPower(energy: number): { maxDistance: number; damage: number } {
  return {
    maxDistance: energy * ENERGY_DASH_DISTANCE_PER_ENERGY,
    damage: energy * ENERGY_DASH_DAMAGE_PER_ENERGY,
  };
}

export function steerDashDirection(direction: Point, from: Point, target: Point, maxTurn: number): Point {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (Math.hypot(dx, dy) < 1) return direction;
  const currentAngle = Math.atan2(direction.y, direction.x);
  const targetAngle = Math.atan2(dy, dx);
  const delta = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
  const angle = currentAngle + Math.max(-maxTurn, Math.min(maxTurn, delta));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Damageable props and solid, indestructible scenery both stop projectiles. */
export function sceneryBlocksProjectiles(item: Pick<Decoration, "destructible" | "obstacle" | "destroyed">): boolean {
  return !item.destroyed && (item.destructible || item.obstacle);
}

export function projectileHitsDecoration(
  item: Decoration,
  projectile: Point,
  projectileRadius: number | EllipseRadii,
): boolean {
  return ellipsesOverlap(
    actorCollisionCenter(item, worldPoint(item, "hitboxOffset")), worldPoint(item, "hitboxRadii"),
    projectile, ellipseRadii(projectileRadius), true,
  );
}

export function projectileHitsCircle(
  target: Point,
  targetRadius: number | EllipseRadii,
  projectile: Point,
  projectileRadius: number | EllipseRadii,
): boolean {
  return ellipsesOverlap(target, ellipseRadii(targetRadius), projectile, ellipseRadii(projectileRadius), true);
}

export function barrelExplosionTargets(
  barrel: Decoration,
  decorations: readonly Decoration[],
  monsters: readonly Monster[],
  player: Point,
): { decorations: Decoration[]; monsters: Monster[]; hitsPlayer: boolean } {
  const center = actorCollisionCenter(barrel, worldPoint(barrel, "hitboxOffset"));
  return {
    decorations: decorations.filter(item =>
      item !== barrel && item.destructible && !item.destroyed &&
      projectileHitsDecoration(item, center, BARREL_EXPLOSION_RADIUS)
    ),
    monsters: monsters.filter(monster =>
      monster.active && !monster.dead && projectileHitsCircle(
        actorCollisionCenter(monster, worldPoint(monster, "hitboxOffset")),
        worldPoint(monster, "hitboxRadii"),
        center,
        BARREL_EXPLOSION_RADIUS,
      )
    ),
    hitsPlayer: projectileHitsCircle(
      actorCollisionCenter(player, PLAYER_SPEC.hitboxOffset),
      PLAYER_SPEC.hitboxRadii,
      center,
      BARREL_EXPLOSION_RADIUS,
    ),
  };
}

/** Grace period after a monster appears before it may start attacking. */
export const MONSTER_ATTACK_WARMUP_MS = 500;

export function monsterAttackIsReady(monster: Monster, timestamp: number): boolean {
  if (monster.attackWarmupUntil !== undefined && timestamp < monster.attackWarmupUntil) return false;
  return timestamp - monster.lastAttackAt >= monster.attackCooldownMs;
}

export function actorProjectileOrigin(
  anchor: Point,
  direction: Point,
  hitboxOffset: Point,
  muzzleDistance: number,
  lateralOffset = 0,
): Point {
  const center = actorCollisionCenter(anchor, hitboxOffset);
  return {
    x: center.x + direction.x * muzzleDistance - direction.y * lateralOffset,
    y: center.y + direction.y * muzzleDistance + direction.x * lateralOffset,
  };
}

export function actorAimDirection(anchor: Point, hitboxOffset: Point, target: Point): Point {
  const center = actorCollisionCenter(anchor, hitboxOffset);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  return { x: dx / distance, y: dy / distance };
}

export function actorCollisionCenter(anchor: Point, offset: Point): Point {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

/** Aim within the player's hit area when its visual center is against a northern wall. */
export function visiblePlayerHitPoint(
  center: Point,
  radius: number,
  hasLineOfSight: (point: Point) => boolean,
): Point | null {
  for (const offsetY of [0, radius / 2, radius * 0.95]) {
    const point = { x: center.x, y: center.y + offsetY };
    if (hasLineOfSight(point)) return point;
  }
  return null;
}
