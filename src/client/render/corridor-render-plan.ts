import { ASSETS } from "../config";
import type { Direction, DungeonLayout, GraphNode, LayoutLink, Point } from "../types";

export type CorridorCornerKind = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WallModuleKind = "wall" | CorridorCornerKind;

export interface CorridorSegmentPlan {
  ownerLinkId: string;
  start: Point;
  end: Point;
  width: number;
  seed: number;
}

export interface WallModulePlan extends Point {
  ownerLinkId?: string;
  side: Direction;
  kind: WallModuleKind;
}

export interface DoorModulePlan {
  position: Point;
  side: "N" | "E" | "S" | "W";
}

export interface CorridorJunctionFloorPlan extends Point {
  ownerLinkId: string;
  seed: number;
}

export interface CorridorMarkingPlan {
  ownerLinkId: string;
  start: Point;
  end: Point;
  position: Point;
  label: string;
  lateralOffset: number;
}

export interface CorridorRenderPlan {
  segments: CorridorSegmentPlan[];
  walls: WallModulePlan[];
  junctionFloors: CorridorJunctionFloorPlan[];
  corners: WallModulePlan[];
  markings: CorridorMarkingPlan[];
}

export interface WallModuleStyle {
  asset: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Vertical door sprites are three segments tall with the passable opening
 * centered this many segments above the sprite's bottom edge; the module is
 * anchored so the opening lines up with the corridor centerline.
 */
const VERTICAL_DOOR_OPENING_SEGMENTS_FROM_BOTTOM = 1;

function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

function segmentKey(start: Point, end: Point): string {
  return [
    Math.min(start.x, end.x),
    Math.min(start.y, end.y),
    Math.max(start.x, end.x),
    Math.max(start.y, end.y),
  ].join(":");
}

function pointEquals(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function validForkLink(link: LayoutLink): boolean {
  return link.forkId !== undefined && link.forkPointIndex !== undefined;
}

function buildPhysicalSegments(layout: DungeonLayout): CorridorSegmentPlan[] {
  const segments = new Map<string, CorridorSegmentPlan>();
  const addSegment = (segment: CorridorSegmentPlan): void => {
    if (pointEquals(segment.start, segment.end)) return;
    const key = segmentKey(segment.start, segment.end);
    if (!segments.has(key)) segments.set(key, segment);
  };
  const forkGroups = new Map<string, LayoutLink[]>();

  for (const link of layout.links) {
    if (validForkLink(link)) {
      const group = forkGroups.get(link.forkId!) ?? [];
      group.push(link);
      forkGroups.set(link.forkId!, group);
      continue;
    }
    for (let index = 1; index < link.points.length; index += 1) {
      addSegment({
        ownerLinkId: link.id,
        start: link.points[index - 1]!,
        end: link.points[index]!,
        width: link.width,
        seed: link.source.lootSeed,
      });
    }
  }

  for (const links of forkGroups.values()) {
    const start = links[0]!.points[0]!;
    const trunk = links
      .map(link => ({ link, point: link.points[link.forkPointIndex!]! }))
      .sort((left, right) => {
        const leftLength = Math.hypot(left.point.x - start.x, left.point.y - start.y);
        const rightLength = Math.hypot(right.point.x - start.x, right.point.y - start.y);
        return rightLength - leftLength || left.link.id.localeCompare(right.link.id);
      })[0]!;
    addSegment({
      ownerLinkId: trunk.link.id,
      start,
      end: trunk.point,
      width: trunk.link.width,
      seed: trunk.link.source.lootSeed,
    });

    for (const link of links) {
      const forkIndex = link.forkPointIndex!;
      for (let index = forkIndex + 1; index < link.points.length; index += 1) {
        addSegment({
          ownerLinkId: link.id,
          start: link.points[index - 1]!,
          end: link.points[index]!,
          width: link.width,
          seed: link.source.lootSeed,
        });
      }
    }
  }

  return [...segments.values()];
}

function wallIsInterior(
  segment: CorridorSegmentPlan,
  side: Direction,
  axisPosition: number,
  allSegments: readonly CorridorSegmentPlan[],
): boolean {
  const horizontal = segment.start.y === segment.end.y;
  const halfWidth = segment.width / 2;
  // The wall's face line. Only corridors that pass through this line (floor on
  // both sides of it at the probed cell) open a gap in the wall. Corridors that
  // merely run alongside - adjacent parallel bands of a compound corridor -
  // keep their shared wall instead of silently merging with no junction.
  const wallLine = horizontal
    ? segment.start.y + (side === "N" ? -halfWidth : halfWidth)
    : segment.start.x + (side === "W" ? -halfWidth : halfWidth);
  return allSegments.some(candidate => {
    if (candidate === segment) return false;
    const candidateHalfWidth = candidate.width / 2;
    const candidateHorizontal = candidate.start.y === candidate.end.y;
    const alongStart = horizontal
      ? Math.min(candidate.start.x, candidate.end.x)
      : Math.min(candidate.start.y, candidate.end.y);
    const alongEnd = horizontal
      ? Math.max(candidate.start.x, candidate.end.x)
      : Math.max(candidate.start.y, candidate.end.y);
    if (candidateHorizontal === horizontal) {
      // Parallel corridor: only its floor band straddling the wall line
      // (a partial overlap, not a flush side-by-side run) opens the wall.
      const band = horizontal ? candidate.start.y : candidate.start.x;
      if (!(band - candidateHalfWidth < wallLine && wallLine < band + candidateHalfWidth)) return false;
      return axisPosition >= alongStart && axisPosition <= alongEnd;
    }
    // Perpendicular corridor: its run must cross the wall line within the
    // width of its own band.
    const band = candidateHorizontal ? candidate.start.y : candidate.start.x;
    if (!(axisPosition >= band - candidateHalfWidth && axisPosition <= band + candidateHalfWidth)) return false;
    const runStart = horizontal
      ? Math.min(candidate.start.y, candidate.end.y)
      : Math.min(candidate.start.x, candidate.end.x);
    const runEnd = horizontal
      ? Math.max(candidate.start.y, candidate.end.y)
      : Math.max(candidate.start.x, candidate.end.x);
    return runStart < wallLine && wallLine < runEnd;
  });
}

function buildWalls(
  segments: readonly CorridorSegmentPlan[],
  segmentSize: number,
): WallModulePlan[] {
  const walls: WallModulePlan[] = [];
  for (const segment of segments) {
    if (segment.start.y === segment.end.y) {
      const left = Math.min(segment.start.x, segment.end.x);
      const columns = Math.round(Math.abs(segment.end.x - segment.start.x) / segmentSize);
      for (let column = 0; column < columns; column += 1) {
        const x = left + (column + 0.5) * segmentSize;
        if (!wallIsInterior(segment, "N", x, segments)) walls.push({
          ownerLinkId: segment.ownerLinkId,
          x,
          y: segment.start.y - segment.width / 2 + segmentSize / 2,
          side: "N",
          kind: "wall",
        });
        if (!wallIsInterior(segment, "S", x, segments)) walls.push({
          ownerLinkId: segment.ownerLinkId,
          x,
          y: segment.start.y + segment.width / 2 - segmentSize / 2,
          side: "S",
          kind: "wall",
        });
      }
      continue;
    }

    const top = Math.min(segment.start.y, segment.end.y);
    const rows = Math.round(Math.abs(segment.end.y - segment.start.y) / segmentSize);
    for (let row = 0; row < rows; row += 1) {
      const y = top + (row + 0.5) * segmentSize;
      if (!wallIsInterior(segment, "W", y, segments)) walls.push({
        ownerLinkId: segment.ownerLinkId,
        x: segment.start.x - segment.width / 2 + segmentSize / 2,
        y,
        side: "W",
        kind: "wall",
      });
      if (!wallIsInterior(segment, "E", y, segments)) walls.push({
        ownerLinkId: segment.ownerLinkId,
        x: segment.start.x + segment.width / 2 - segmentSize / 2,
        y,
        side: "E",
        kind: "wall",
      });
    }
  }
  return walls;
}

/**
 * Room-corner construction for a corner cell: the corner module plus the
 * extra wall segments the corner cell needs next to its corner sprite
 * (the sprite only carries one band/face orientation).
 */
function cornerConstruction(
  kind: CorridorCornerKind,
  x: number,
  y: number,
  ownerLinkId?: string,
): WallModulePlan[] {
  const corner: WallModulePlan = { x, y, ownerLinkId, side: kind.endsWith("left") ? "W" : "E", kind };
  const extras: WallModulePlan[] = [];
  if (kind === "top-left") {
    extras.push({ x, y, ownerLinkId, side: "W", kind: "wall" });
    extras.push({ x, y, ownerLinkId, side: "N", kind: "wall" });
  } else if (kind === "top-right") {
    extras.push({ x, y, ownerLinkId, side: "E", kind: "wall" });
  } else if (kind === "bottom-left") {
    extras.push({ x, y, ownerLinkId, side: "S", kind: "wall" });
  }
  return [corner, ...extras];
}

/**
 * Sprite placement per wall module. The module anchor is the center of the
 * grid cell the module occupies; offsets express the shared-variety shifts:
 * horizontal walls come in a southern variety (northern walls shift one
 * segment up), vertical walls come in an eastern variety (western walls
 * shift one segment left), and taller-than-a-segment sprites are
 * bottom-anchored so their top overlaps the segment above.
 */
export function wallModuleStyle(module: WallModulePlan, segmentSize: number): WallModuleStyle {
  const s = segmentSize;
  switch (module.kind) {
    case "wall":
      if (module.side === "N") return { asset: ASSETS.wallHorizontal, width: s, height: s, offsetX: 0, offsetY: -s };
      if (module.side === "S") return { asset: ASSETS.wallHorizontal, width: s, height: s, offsetX: 0, offsetY: 0 };
      if (module.side === "W") return { asset: ASSETS.wallVertical, width: s, height: 2 * s, offsetX: -s, offsetY: -s / 2 };
      return { asset: ASSETS.wallVertical, width: s, height: 2 * s, offsetX: 0, offsetY: -s / 2 };
    case "top-left":
      return { asset: ASSETS.wallCornerTopLeft, width: s, height: s, offsetX: -s, offsetY: -s };
    case "top-right":
      return { asset: ASSETS.wallCornerTopRight, width: s, height: s, offsetX: 0, offsetY: -s };
    case "bottom-left":
      return { asset: ASSETS.wallCornerBottomLeft, width: s, height: 2 * s, offsetX: -s, offsetY: -s / 2 };
    case "bottom-right":
      return { asset: ASSETS.wallCornerBottomRight, width: s, height: 2 * s, offsetX: 0, offsetY: -s / 2 };
  }
}

export function doorModuleStyle(side: DoorModulePlan["side"], segmentSize: number): WallModuleStyle {
  const s = segmentSize;
  return side === "N" || side === "S"
    ? { asset: ASSETS.doorHorizontal, width: 2 * s, height: s, offsetX: 0, offsetY: -s / 2 }
    : {
        asset: ASSETS.doorVertical,
        width: s,
        height: 3 * s,
        offsetX: -s / 2,
        offsetY: -(1.5 - VERTICAL_DOOR_OPENING_SEGMENTS_FROM_BOTTOM) * s,
      };
}

function directionsAt(point: Point, segments: readonly CorridorSegmentPlan[]): Set<Direction> {
  const directions = new Set<Direction>();
  for (const segment of segments) {
    if (segment.start.y === segment.end.y && point.y === segment.start.y) {
      const left = Math.min(segment.start.x, segment.end.x);
      const right = Math.max(segment.start.x, segment.end.x);
      if (point.x > left && point.x <= right) directions.add("W");
      if (point.x >= left && point.x < right) directions.add("E");
    } else if (segment.start.x === segment.end.x && point.x === segment.start.x) {
      const top = Math.min(segment.start.y, segment.end.y);
      const bottom = Math.max(segment.start.y, segment.end.y);
      if (point.y > top && point.y <= bottom) directions.add("N");
      if (point.y >= top && point.y < bottom) directions.add("S");
    }
  }
  return directions;
}

function cornerKinds(directions: ReadonlySet<Direction>): CorridorCornerKind[] {
  const has = (direction: Direction): boolean => directions.has(direction);
  if (directions.size === 2) {
    if (has("N") && has("W")) return ["bottom-right"];
    if (has("N") && has("E")) return ["bottom-left"];
    if (has("S") && has("W")) return ["top-right"];
    if (has("S") && has("E")) return ["top-left"];
    return [];
  }
  if (directions.size === 3) {
    if (has("W") && has("E") && has("N")) return ["top-right", "top-left"];
    if (has("W") && has("E") && has("S")) return ["bottom-right", "bottom-left"];
    if (has("N") && has("S") && has("E")) return ["bottom-right", "top-right"];
    if (has("N") && has("S") && has("W")) return ["bottom-left", "top-left"];
  }
  if (directions.size === 4) {
    return ["top-left", "top-right", "bottom-left", "bottom-right"];
  }
  return [];
}

function oppositeCornerKind(kind: CorridorCornerKind): CorridorCornerKind {
  const vertical = kind.startsWith("top") ? "bottom" : "top";
  const horizontal = kind.endsWith("left") ? "right" : "left";
  return `${vertical}-${horizontal}` as CorridorCornerKind;
}

  /**
 * Cells cleared of straight wall modules around an inner corner: the corner
 * cell itself plus whichever flanking arm wall modules the corner construct
 * makes redundant. A construct covers the wall line its band/face occupies:
 * bottom-right covers both lines, bottom-left the vertical one, top-right the
 * horizontal one, and top-left covers neither.
 */
function innerClearedCells(
  constructionKind: CorridorCornerKind,
  cell: Point,
  shift: Point,
): Point[] {
  const horizontalFlank = { x: cell.x + shift.x, y: cell.y };
  const verticalFlank = { x: cell.x, y: cell.y + shift.y };
  switch (constructionKind) {
    case "bottom-right": return [cell, horizontalFlank, verticalFlank];
    case "bottom-left": return [cell, verticalFlank];
    case "top-right": return [cell, horizontalFlank];
    case "top-left": return [cell];
  }
}

function buildJunctions(
  segments: readonly CorridorSegmentPlan[],
  segmentSize: number,
): {
  junctionFloors: CorridorJunctionFloorPlan[];
  corners: WallModulePlan[];
  cornerCells: Point[];
} {
  const junctions = new Map<string, Point>();
  for (const segment of segments) {
    junctions.set(pointKey(segment.start), segment.start);
    junctions.set(pointKey(segment.end), segment.end);
  }

  const junctionFloors: CorridorJunctionFloorPlan[] = [];
  const corners: WallModulePlan[] = [];
  const cornerCells: Point[] = [];
  for (const point of junctions.values()) {
    const directions = directionsAt(point, segments);
    const kinds = cornerKinds(directions);
    if (!kinds.length) continue;
    const owners = segments
      .filter(segment => pointEquals(segment.start, point) || pointEquals(segment.end, point))
      .sort((left, right) => left.ownerLinkId.localeCompare(right.ownerLinkId));
    const owner = owners[0];
    if (!owner) continue;
    const namedCell = (cornerKind: CorridorCornerKind): Point => ({
      x: point.x + (cornerKind.endsWith("left") ? -segmentSize / 2 : segmentSize / 2),
      y: point.y + (cornerKind.startsWith("top") ? -segmentSize / 2 : segmentSize / 2),
    });
    // Inner corner constructs sit one segment further into their own quadrant
    // than the junction's corner cell.
    const quadrantShift = (cornerKind: CorridorCornerKind): Point => ({
      x: cornerKind.endsWith("left") ? -segmentSize : segmentSize,
      y: cornerKind.startsWith("top") ? -segmentSize : segmentSize,
    });
    for (const kind of kinds) {
      const outerCell = namedCell(kind);
      if (directions.size === 2) {
        // Convex outer corner: built like the analogous room corner.
        corners.push(...cornerConstruction(kind, outerCell.x, outerCell.y, owner.ownerLinkId));
        // Concave inner corner at the diagonally opposite cell: the same
        // element as the outer corner, pushed one segment into its quadrant.
        const innerKindCell = oppositeCornerKind(kind);
        const innerCell = namedCell(innerKindCell);
        const innerShift = quadrantShift(innerKindCell);
        corners.push({
          ownerLinkId: owner.ownerLinkId,
          x: innerCell.x + innerShift.x,
          y: innerCell.y + innerShift.y,
          side: kind.endsWith("left") ? "W" : "E",
          kind,
        });
        // The inner corner sprite leaves a transparent notch; the floor
        // tile beneath it is missing and must be filled.
        if (kind === "bottom-right") {
          junctionFloors.push({
            ownerLinkId: owner.ownerLinkId,
            x: innerCell.x + innerShift.x + segmentSize/2,
            y: innerCell.y + innerShift.y + segmentSize/2,
            seed: owner.seed,
          });
        }
        cornerCells.push(...innerClearedCells(kind, innerCell, innerShift));
        junctionFloors.push({
          ownerLinkId: owner.ownerLinkId,
          x: outerCell.x,
          y: outerCell.y,
          seed: owner.seed,
        });
      } else {
        // Concave junction corner: the diagonally opposite room corner
        // construction, pushed one segment into its own quadrant.
        const innerKind = oppositeCornerKind(kind);
        const innerShift = quadrantShift(kind);
        corners.push({
          ownerLinkId: owner.ownerLinkId,
          x: outerCell.x + innerShift.x,
          y: outerCell.y + innerShift.y,
          side: innerKind.endsWith("left") ? "W" : "E",
          kind: innerKind,
        });
        if (innerKind === "bottom-right") {
          junctionFloors.push({
            ownerLinkId: owner.ownerLinkId,
            x: outerCell.x + innerShift.x + segmentSize/2,
            y: outerCell.y + innerShift.y + segmentSize/2,
            seed: owner.seed,
          });
        }
        cornerCells.push(...innerClearedCells(innerKind, outerCell, innerShift));
      }
    }
  }
  return { junctionFloors, corners, cornerCells };
}

function pointAlongSegment(start: Point, end: Point, distance: number): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!length) return { ...start };
  const progress = Math.min(distance, length) / length;
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

function buildMarkings(layout: DungeonLayout, segmentSize: number): CorridorMarkingPlan[] {
  const markings: CorridorMarkingPlan[] = [];
  const forkGroups = new Map<string, LayoutLink[]>();
  for (const link of layout.links) {
    if (validForkLink(link)) {
      const group = forkGroups.get(link.forkId!) ?? [];
      group.push(link);
      forkGroups.set(link.forkId!, group);
      continue;
    }
    const start = link.points[0]!;
    const end = link.points[1]!;
    markings.push({
      ownerLinkId: link.id,
      start,
      end,
      position: pointAlongSegment(start, end, segmentSize / 2),
      label: link.target.floorLabel,
      lateralOffset: -(segmentSize / 3 + segmentSize / 2),
    });
    const returnStart = link.points.at(-1)!;
    const returnEnd = link.points.at(-2)!;
    markings.push({
      ownerLinkId: link.id,
      start: returnStart,
      end: returnEnd,
      position: pointAlongSegment(returnStart, returnEnd, segmentSize / 2),
      label: link.source.floorLabel,
      lateralOffset: segmentSize / 3,
    });
  }

  for (const links of forkGroups.values()) {
    const start = links[0]!.points[0]!;
    const byDistance = links
      .map(link => ({ link, point: link.points[link.forkPointIndex!]! }))
      .sort((left, right) => {
        const leftLength = Math.hypot(left.point.x - start.x, left.point.y - start.y);
        const rightLength = Math.hypot(right.point.x - start.x, right.point.y - start.y);
        return leftLength - rightLength || left.link.id.localeCompare(right.link.id);
      });
    const entrance = byDistance[0]!;
    const trunkOwner = byDistance.at(-1)!.link.id;
    markings.push({
      ownerLinkId: trunkOwner,
      start,
      end: entrance.point,
      position: pointAlongSegment(start, entrance.point, segmentSize / 2),
      label: "",
      lateralOffset: 0,
    });
    for (const { link, point } of byDistance) {
      const branchEnd = link.points.at(-1)!;
      markings.push({
        ownerLinkId: link.id,
        start: point,
        end: branchEnd,
        position: pointAlongSegment(point, branchEnd, link.width / 2 + segmentSize / 2),
        label: link.target.floorLabel,
        lateralOffset: -(segmentSize / 3 + segmentSize / 2),
      });
      markings.push({
        ownerLinkId: link.id,
        start: branchEnd,
        end: point,
        position: pointAlongSegment(branchEnd, point, segmentSize / 2),
        label: link.source.floorLabel,
        lateralOffset: segmentSize / 3,
      });
    }
  }
  return markings;
}

export function buildCorridorRenderPlan(
  layout: DungeonLayout,
  segmentSize: number,
): CorridorRenderPlan {
  const segments = buildPhysicalSegments(layout);
  const junctions = buildJunctions(segments, segmentSize);
  const cornerCells = new Set(junctions.cornerCells.map(cell => `${cell.x}:${cell.y}`));
  return {
    segments,
    walls: buildWalls(segments, segmentSize)
      .filter(wall => wall.kind !== "wall" || !cornerCells.has(`${wall.x}:${wall.y}`)),
    junctionFloors: junctions.junctionFloors,
    corners: junctions.corners,
    markings: buildMarkings(layout, segmentSize),
  };
}

/**
 * Wall modules for a room perimeter. Door sprites replace wall modules on
 * their reserved cells: horizontal doors span the two cells flanking the
 * boundary line, vertical doors span their own cell plus the two cells above
 * (the sprite's frame content covers them).
 */
export function buildRoomWalls(
  room: GraphNode,
  doors: readonly DoorModulePlan[],
  segmentSize: number,
): WallModulePlan[] {
  const s = segmentSize;
  const left = room.x - room.width / 2;
  const top = room.y - room.height / 2;
  const columns = Math.round(room.width / s);
  const rows = Math.round(room.height / s);
  const modules: WallModulePlan[] = [];

  const occupied = new Map<string, Set<number>>();
  for (const door of doors) {
    const horizontal = door.side === "N" || door.side === "S";
    const axisStart = horizontal ? left : top;
    const axisPosition = horizontal ? door.position.x : door.position.y;
    const boundaryIndex = Math.round((axisPosition - axisStart) / s);
    const span = horizontal ? 2 : 3;
    const first = horizontal ? boundaryIndex - 1 : boundaryIndex - 2;
    const cells = occupied.get(door.side) ?? new Set<number>();
    for (let index = 0; index < span; index += 1) cells.add(first + index);
    occupied.set(door.side, cells);
  }
  const isDoorCell = (side: string, index: number): boolean => occupied.get(side)?.has(index) ?? false;

  modules.push(...cornerConstruction("top-left", left + s / 2, top + s / 2));
  modules.push(...cornerConstruction("top-right", left + room.width - s / 2, top + s / 2));
  modules.push(...cornerConstruction("bottom-left", left + s / 2, top + room.height - s / 2));
  modules.push(...cornerConstruction("bottom-right", left + room.width - s / 2, top + room.height - s / 2));

  for (let column = 1; column < columns - 1; column += 1) {
    const x = left + (column + 0.5) * s;
    if (!isDoorCell("N", column)) modules.push({ x, y: top + s / 2, side: "N", kind: "wall" });
    if (!isDoorCell("S", column)) modules.push({ x, y: top + room.height - s / 2, side: "S", kind: "wall" });
  }
  for (let row = 1; row < rows - 1; row += 1) {
    const y = top + (row + 0.5) * s;
    if (!isDoorCell("W", row)) modules.push({ x: left + s / 2, y, side: "W", kind: "wall" });
    if (!isDoorCell("E", row)) modules.push({ x: left + room.width - s / 2, y, side: "E", kind: "wall" });
  }
  return modules;
}
