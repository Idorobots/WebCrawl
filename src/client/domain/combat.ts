import type { Decoration, Monster, MonsterAttackPattern, Point } from "../types";
import {
  BARREL_EXPLOSION_RADIUS,
  ENERGY_DASH_DAMAGE_PER_ENERGY,
  ENERGY_DASH_DISTANCE_PER_ENERGY,
  monsterVisualCenterOffsetY,
  PLAYER_SPEC,
} from "./specs";

export interface EnemyVolleyProjectile {
  direction: Point;
  lateralOffset: number;
}

export function monsterEngagementRange(
  monster: Pick<Monster, "speed" | "attackRange" | "projectileRange">,
): number {
  return monster.speed === 0 ? monster.projectileRange : monster.attackRange;
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

export function projectileHitsCircle(
  target: Point,
  targetRadius: number,
  projectile: Point,
  projectileRadius: number,
): boolean {
  return Math.hypot(projectile.x - target.x, projectile.y - target.y) <= targetRadius + projectileRadius;
}

export function barrelExplosionTargets(
  barrel: Decoration,
  decorations: readonly Decoration[],
  monsters: readonly Monster[],
  player: Point,
): { decorations: Decoration[]; monsters: Monster[]; hitsPlayer: boolean } {
  const center = { x: barrel.x, y: barrel.y + barrel.hitOffsetY };
  return {
    decorations: decorations.filter(item =>
      item !== barrel && item.destructible && !item.destroyed &&
      projectileHitsDecoration(item, center, BARREL_EXPLOSION_RADIUS)
    ),
    monsters: monsters.filter(monster =>
      monster.active && !monster.dead && projectileHitsCircle(
        { x: monster.x, y: monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind) },
        monster.radius,
        center,
        BARREL_EXPLOSION_RADIUS,
      )
    ),
    hitsPlayer: projectileHitsCircle(
      actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY),
      PLAYER_SPEC.radius,
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
  visualCenterOffsetY: number,
  muzzleDistance: number,
  lateralOffset = 0,
): Point {
  const center = actorCollisionCenter(anchor, visualCenterOffsetY);
  return {
    x: center.x + direction.x * muzzleDistance - direction.y * lateralOffset,
    y: center.y + direction.y * muzzleDistance + direction.x * lateralOffset,
  };
}

export function actorAimDirection(anchor: Point, visualCenterOffsetY: number, target: Point): Point {
  const center = actorCollisionCenter(anchor, visualCenterOffsetY);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  return { x: dx / distance, y: dy / distance };
}

export function actorCollisionCenter(anchor: Point, visualCenterOffsetY: number): Point {
  return { x: anchor.x, y: anchor.y + visualCenterOffsetY };
}
