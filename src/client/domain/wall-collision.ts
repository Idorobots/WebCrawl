import type { DungeonLayout, EllipseRadii, Point } from "../types";
import { buildCorridorRenderPlan, buildRoomWalls, roomDoorsForLayout, type DoorModulePlan, type WallModulePlan } from "../render/corridor-render-plan";
import { forSpatialCells } from "./spatial";
import { WORLD_GEOMETRY } from "./specs";

export interface WallRect { x: number; y: number; width: number; height: number }
export type WallPiece = "wall-N" | "wall-E" | "wall-S" | "wall-W" |
  "top-left" | "top-right" | "bottom-left" | "bottom-right" |
  "door-N" | "door-E" | "door-S" | "door-W";

const s = WORLD_GEOMETRY.segmentSize;
const t = WORLD_GEOMETRY.wallThickness;
const halfDoor = WORLD_GEOMETRY.doorOpeningWidth / 2;
const doorY = WORLD_GEOMETRY.verticalDoorPassableOffsetY;

/** Edit the local rectangles for each piece variant here. Positions are relative to
 * the wall module's cell center or the door's boundary anchor, not its sprite.
 * Multiple rectangles allow L-shaped corners and split door jambs. */
export const WALL_FOOTPRINTS: Record<WallPiece, readonly WallRect[]> = {
  "wall-N": [{ x: -s / 2, y: -s / 2 - t, width: s, height: t }],
  "wall-E": [{ x: s / 2 - t, y: -s / 2, width: t, height: s }],
  "wall-S": [{ x: -s / 2, y: s / 2 - t, width: s, height: t }],
  "wall-W": [{ x: -s / 2 - t, y: -s / 2, width: t, height: s }],
  "top-left": [
    { x: -s / 2 - t, y: -s / 2 - t, width: t, height: s + t },
    { x: -s / 2, y: -s / 2 - t, width: s, height: t },
  ],
  "top-right": [
    { x: s / 2 - t, y: -s / 2, width: t, height: s},
    { x: -s / 2, y: -s / 2 - t, width: s, height: t },
  ],
  "bottom-left": [
    { x: -s / 2 - t, y: -s / 2, width: t, height: s },
    { x: -s / 2, y: s / 2 - t, width: s, height: t },
  ],
  "bottom-right": [
    { x: s / 2 - t, y: -s / 2, width: t, height: s },
    { x: -s / 2, y: s / 2 - t, width: s, height: t },
  ],
  "door-N": [
    { x: -s, y: -t, width: s - halfDoor, height: t },
    { x: halfDoor, y: -t, width: s - halfDoor, height: t },
  ],
  "door-S": [
    { x: -s, y: -t, width: s - halfDoor, height: t },
    { x: halfDoor, y: -t, width: s - halfDoor, height: t },
  ],
  "door-E": [
    { x: -t, y: -s, width: t, height: s + doorY - halfDoor },
    { x: -t, y: -doorY + halfDoor, width: t, height: s - halfDoor },
  ],
  "door-W": [
    { x: -t, y: -s, width: t, height: s + doorY - halfDoor },
    { x: -t, y: -doorY + halfDoor, width: t, height: s - halfDoor },
  ],
};

export const WALL_HITBOX_SHIFT_Y = -WORLD_GEOMETRY.segmentSize * 0.25;

export function wallPieceFootprints(piece: WallPiece, anchor: Point): WallRect[] {
  return WALL_FOOTPRINTS[piece].map(rect => ({
    x: anchor.x + rect.x, y: anchor.y + rect.y, width: rect.width, height: rect.height,
  }));
}

function wallPiece(module: WallModulePlan): WallPiece {
  return module.kind === "wall" ? `wall-${module.side}` : module.kind;
}

function doorPiece(door: DoorModulePlan): WallPiece {
  return `door-${door.side}`;
}

function footprintsForModules(modules: readonly WallModulePlan[]): WallRect[] {
  // Corner sprites may be supplemented by straight wall sprites in the same
  // cell. Their collision belongs to the configurable corner variant alone.
  const corners = new Set(modules.filter(module => module.kind !== "wall")
    .map(module => `${module.x}:${module.y}`));
  return modules
    .filter(module => module.kind !== "wall" || !corners.has(`${module.x}:${module.y}`))
    .flatMap(module => wallPieceFootprints(wallPiece(module), module));
}

export function buildWallFootprints(layout: DungeonLayout): WallRect[] {
  const plan = buildCorridorRenderPlan(layout, s);
  const rectangles = footprintsForModules([...plan.walls, ...plan.corners]);
  for (const room of layout.nodes) {
    const doors = roomDoorsForLayout(layout, room);
    rectangles.push(...footprintsForModules(buildRoomWalls(room, doors, s)));
    rectangles.push(...doors.filter(door => !door.sharedTarget)
      .flatMap(door => wallPieceFootprints(doorPiece(door), door.position)));
  }
  return rectangles.filter(rect => rect.width > 0 && rect.height > 0);
}

export function wallHitboxes(footprints: readonly WallRect[]): WallRect[] {
  return footprints.map(rect => ({ ...rect, y: rect.y + WALL_HITBOX_SHIFT_Y }));
}

export class WallRectIndex {
  readonly rects: readonly WallRect[];
  private readonly cells = new Map<string, Set<WallRect>>();

  constructor(rects: readonly WallRect[]) {
    this.rects = rects;
    for (const rect of rects) {
      forSpatialCells(rect.x, rect.x + rect.width, rect.y, rect.y + rect.height, key => {
        const cell = this.cells.get(key) ?? new Set<WallRect>();
        cell.add(rect);
        this.cells.set(key, cell);
      });
    }
  }

  candidates(from: Point, to: Point, radii: EllipseRadii): Set<WallRect> {
    const result = new Set<WallRect>();
    forSpatialCells(
      Math.min(from.x, to.x) - radii.x, Math.max(from.x, to.x) + radii.x,
      Math.min(from.y, to.y) - radii.y, Math.max(from.y, to.y) + radii.y,
      key => { for (const rect of this.cells.get(key) ?? []) result.add(rect); },
    );
    return result;
  }
}

function normalizedDistanceSquared(point: Point, radii: EllipseRadii, rect: WallRect): number {
  const nearX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const nearY = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return ((point.x - nearX) / radii.x) ** 2 + ((point.y - nearY) / radii.y) ** 2;
}

export function wallOverlapsEllipse(point: Point, radii: EllipseRadii, index: WallRectIndex): boolean {
  if (radii.x <= 0 || radii.y <= 0) return false;
  for (const rect of index.candidates(point, point, radii)) {
    if (normalizedDistanceSquared(point, radii, rect) < 1) return true;
  }
  return false;
}

/** Convex distance from the moving ellipse center to a rectangle; minimizes
 * across the entire step, including a thin wall between the endpoints. */
export function wallBlocksSegment(from: Point, to: Point, radii: EllipseRadii, index: WallRectIndex): boolean {
  if (radii.x <= 0 || radii.y <= 0) return false;
  if (from.x === to.x && from.y === to.y) return wallOverlapsEllipse(from, radii, index);
  for (const rect of index.candidates(from, to, radii)) {
    if (Math.max(from.x, to.x) + radii.x <= rect.x ||
        Math.min(from.x, to.x) - radii.x >= rect.x + rect.width ||
        Math.max(from.y, to.y) + radii.y <= rect.y ||
        Math.min(from.y, to.y) - radii.y >= rect.y + rect.height) continue;
    const distanceAt = (fraction: number) => normalizedDistanceSquared({
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
    }, radii, rect);
    if (distanceAt(0) < 1 || distanceAt(1) < 1) return true;
    let left = 0;
    let right = 1;
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const a = left + (right - left) / 3;
      const b = right - (right - left) / 3;
      if (distanceAt(a) < distanceAt(b)) right = b;
      else left = a;
    }
    if (distanceAt((left + right) / 2) < 1) return true;
  }
  return false;
}
