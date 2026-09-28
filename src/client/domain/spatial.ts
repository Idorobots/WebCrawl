import type { Monster, Point } from "../types";
import { WORLD_GEOMETRY } from "./specs";

const SPATIAL_CELL_SIZE = WORLD_GEOMETRY.spatialCellSize;

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
    const centerX = monster.x + monster.hitboxOffset.x;
    const centerY = monster.y + monster.hitboxOffset.y;
    forSpatialCells(
      centerX - monster.hitboxRadii.x,
      centerX + monster.hitboxRadii.x,
      centerY - monster.hitboxRadii.y,
      centerY + monster.hitboxRadii.y,
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
