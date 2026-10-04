import type { EllipseRadii, Monster, Point } from "../types";
import { WORLD_GEOMETRY } from "./specs";
import { worldPoint } from "./object-geometry";
import { footprintMoveIsClear, footprintsOverlap } from "./geometry";

const SPATIAL_CELL_SIZE = WORLD_GEOMETRY.spatialCellSize;
const blockingRadii = new WeakMap<Monster, { full: EllipseRadii; half: EllipseRadii }>();

/** Relax only monster/monster collisions; scenery and player checks use the full footprint. */
export function monsterBlockingRadii(monster: Monster): EllipseRadii {
  const full = worldPoint(monster, "footprintRadii");
  const cached = blockingRadii.get(monster);
  if (cached?.full === full) return cached.half;
  const half = { x: full.x / 2, y: full.y / 2 };
  blockingRadii.set(monster, { full, half });
  return half;
}

/** Foot-level blocking is separate from offset projectile hitboxes. */
export class MonsterFootprintIndex {
  private readonly cells = new Map<string, Set<Monster>>();
  private readonly entries = new Map<Monster, {
    x: number; y: number; radii: EllipseRadii; keys: string[];
    minCellX: number; maxCellX: number; minCellY: number; maxCellY: number;
  }>();

  rebuild(monsters: readonly Monster[]): void {
    this.cells.clear();
    this.entries.clear();
    for (const monster of monsters) this.update(monster);
  }

  update(monster: Monster): void {
    const previous = this.entries.get(monster);
    const radii = monsterBlockingRadii(monster);
    if (!monster.dead && monster.obstacle && previous?.x === monster.x && previous.y === monster.y &&
      previous.radii === radii) return;
    const minCellX = Math.floor((monster.x - radii.x) / SPATIAL_CELL_SIZE);
    const maxCellX = Math.floor((monster.x + radii.x) / SPATIAL_CELL_SIZE);
    const minCellY = Math.floor((monster.y - radii.y) / SPATIAL_CELL_SIZE);
    const maxCellY = Math.floor((monster.y + radii.y) / SPATIAL_CELL_SIZE);
    // Most movement stays within the same cells. Their sets already contain the
    // live object, so avoid removing/reinserting it and allocating fresh keys.
    if (!monster.dead && monster.obstacle && previous &&
      previous.minCellX === minCellX && previous.maxCellX === maxCellX &&
      previous.minCellY === minCellY && previous.maxCellY === maxCellY) {
      previous.x = monster.x;
      previous.y = monster.y;
      previous.radii = radii;
      return;
    }
    if (previous) {
      for (const key of previous.keys) {
        const cell = this.cells.get(key)!;
        cell.delete(monster);
        if (!cell.size) this.cells.delete(key);
      }
      this.entries.delete(monster);
    }
    if (monster.dead || !monster.obstacle) return;
    const keys: string[] = [];
    forSpatialCells(monster.x - radii.x, monster.x + radii.x, monster.y - radii.y, monster.y + radii.y, key => {
      const cell = this.cells.get(key) ?? new Set<Monster>();
      cell.add(monster);
      this.cells.set(key, cell);
      keys.push(key);
    });
    this.entries.set(monster, { x: monster.x, y: monster.y, radii, keys, minCellX, maxCellX, minCellY, maxCellY });
  }

  nearby(center: Point, radius: number): Set<Monster> {
    const nearby = monsterCollisionCandidates(this.cells, center, radius);
    for (const other of nearby) {
      if (other.dead || !other.obstacle || !footprintsOverlap(center, radius, other, monsterBlockingRadii(other))) {
        nearby.delete(other);
      }
    }
    return nearby;
  }

  moveIsClear(monster: Monster, to: Point): boolean {
    return this.isClear(monster, to, true);
  }

  positionIsClear(monster: Monster, position: Point): boolean {
    return this.isClear(monster, position, false);
  }

  blockingMonsters(monster: Monster, position: Point): Set<Monster> {
    const radii = monsterBlockingRadii(monster);
    const candidates = monsterCollisionCandidates(this.cells, position, Math.max(radii.x, radii.y));
    for (const other of candidates) {
      if (other === monster || other.dead || !other.obstacle ||
        footprintMoveIsClear(monster, position, radii, other, monsterBlockingRadii(other))) candidates.delete(other);
    }
    return candidates;
  }

  private isClear(monster: Monster, position: Point, allowEscape: boolean): boolean {
    const radii = monsterBlockingRadii(monster);
    let clear = true;
    forSpatialCells(position.x - radii.x, position.x + radii.x,
      position.y - radii.y, position.y + radii.y, key => {
        if (!clear) return;
        for (const other of this.cells.get(key) ?? []) {
          if (other === monster || other.dead || !other.obstacle) continue;
          const otherRadii = monsterBlockingRadii(other);
          if (allowEscape ? !footprintMoveIsClear(monster, position, radii, other, otherRadii)
            : footprintsOverlap(position, radii, other, otherRadii)) {
            clear = false;
            return;
          }
        }
      });
    return clear;
  }
}

export function spatialCellKey(x: number, y: number): string {
  return `${Math.floor(x / SPATIAL_CELL_SIZE)},${Math.floor(y / SPATIAL_CELL_SIZE)}`;
}

export function forSpatialCells(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  visit: (key: string) => void,
): void {
  const firstX = Math.floor(minX / SPATIAL_CELL_SIZE);
  const lastX = Math.floor(maxX / SPATIAL_CELL_SIZE);
  const firstY = Math.floor(minY / SPATIAL_CELL_SIZE);
  const lastY = Math.floor(maxY / SPATIAL_CELL_SIZE);
  for (let cellX = firstX; cellX <= lastX; cellX += 1) {
    for (let cellY = firstY; cellY <= lastY; cellY += 1) visit(`${cellX},${cellY}`);
  }
}

export function indexMonsterHitboxes(monsters: readonly Monster[]): Map<string, Set<Monster>> {
  const cells = new Map<string, Set<Monster>>();
  for (const monster of monsters) {
    // An inactive monster may be activated when its room is revealed later in the same tick.
    if (monster.dead) continue;
    const offset = worldPoint(monster, "hitboxOffset");
    const radii = worldPoint(monster, "hitboxRadii");
    const centerX = monster.x + offset.x;
    const centerY = monster.y + offset.y;
    forSpatialCells(
      centerX - radii.x,
      centerX + radii.x,
      centerY - radii.y,
      centerY + radii.y,
      key => {
        const cell = cells.get(key) ?? new Set<Monster>();
        cell.add(monster);
        cells.set(key, cell);
      },
    );
  }
  return cells;
}

export function monsterCollisionCandidates(
  cells: ReadonlyMap<string, ReadonlySet<Monster>>,
  center: Point,
  radius: number,
): Set<Monster> {
  const candidates = new Set<Monster>();
  forSpatialCells(
    center.x - radius,
    center.x + radius,
    center.y - radius,
    center.y + radius,
    key => {
      for (const monster of cells.get(key) ?? []) candidates.add(monster);
    },
  );
  return candidates;
}
