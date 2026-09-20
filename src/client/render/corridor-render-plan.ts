import type { Direction, DungeonLayout, LayoutLink, Point } from "../types";

export type CorridorCornerKind = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface CorridorSegmentPlan {
  ownerLinkId: string;
  start: Point;
  end: Point;
  width: number;
  seed: number;
}

export interface CorridorWallPlan extends Point {
  ownerLinkId: string;
  side: Direction;
}

export interface CorridorCornerPlan extends Point {
  ownerLinkId: string;
  kind: CorridorCornerKind;
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
  walls: CorridorWallPlan[];
  junctionFloors: CorridorJunctionFloorPlan[];
  outerCorners: CorridorCornerPlan[];
  corners: CorridorCornerPlan[];
  markings: CorridorMarkingPlan[];
}

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

function pointInSegmentFloor(point: Point, segment: CorridorSegmentPlan): boolean {
  const halfWidth = segment.width / 2;
  if (segment.start.y === segment.end.y) {
    return point.x >= Math.min(segment.start.x, segment.end.x) &&
      point.x <= Math.max(segment.start.x, segment.end.x) &&
      point.y >= segment.start.y - halfWidth &&
      point.y <= segment.start.y + halfWidth;
  }
  return point.y >= Math.min(segment.start.y, segment.end.y) &&
    point.y <= Math.max(segment.start.y, segment.end.y) &&
    point.x >= segment.start.x - halfWidth &&
    point.x <= segment.start.x + halfWidth;
}

function wallIsInterior(
  segment: CorridorSegmentPlan,
  side: Direction,
  axisPosition: number,
  allSegments: readonly CorridorSegmentPlan[],
): boolean {
  const halfWidth = segment.width / 2;
  const probeOffset = 0.01;
  const probe = segment.start.y === segment.end.y
    ? {
        x: axisPosition,
        y: segment.start.y + (side === "N" ? -halfWidth - probeOffset : halfWidth + probeOffset),
      }
    : {
        x: segment.start.x + (side === "W" ? -halfWidth - probeOffset : halfWidth + probeOffset),
        y: axisPosition,
      };
  return allSegments.some(candidate => candidate !== segment && pointInSegmentFloor(probe, candidate));
}

function buildWalls(
  segments: readonly CorridorSegmentPlan[],
  segmentSize: number,
): CorridorWallPlan[] {
  const walls: CorridorWallPlan[] = [];
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
        });
        if (!wallIsInterior(segment, "S", x, segments)) walls.push({
          ownerLinkId: segment.ownerLinkId,
          x,
          y: segment.start.y + segment.width / 2 - segmentSize / 2,
          side: "S",
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
      });
      if (!wallIsInterior(segment, "E", y, segments)) walls.push({
        ownerLinkId: segment.ownerLinkId,
        x: segment.start.x + segment.width / 2 - segmentSize / 2,
        y,
        side: "E",
      });
    }
  }
  return walls;
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

function buildJunctions(
  segments: readonly CorridorSegmentPlan[],
  segmentSize: number,
): {
  junctionFloors: CorridorJunctionFloorPlan[];
  outerCorners: CorridorCornerPlan[];
  corners: CorridorCornerPlan[];
} {
  const junctions = new Map<string, Point>();
  for (const segment of segments) {
    junctions.set(pointKey(segment.start), segment.start);
    junctions.set(pointKey(segment.end), segment.end);
  }

  const junctionFloors: CorridorJunctionFloorPlan[] = [];
  const outerCorners: CorridorCornerPlan[] = [];
  const corners: CorridorCornerPlan[] = [];
  for (const point of junctions.values()) {
    const directions = directionsAt(point, segments);
    const kinds = cornerKinds(directions);
    if (!kinds.length) continue;
    const owners = segments
      .filter(segment => pointEquals(segment.start, point) || pointEquals(segment.end, point))
      .sort((left, right) => left.ownerLinkId.localeCompare(right.ownerLinkId));
    const owner = owners[0];
    if (!owner) continue;
    for (const kind of kinds) {
      const namedCellCorner = (cornerKind: CorridorCornerKind) => ({
        ownerLinkId: owner.ownerLinkId,
        x: point.x + (cornerKind.endsWith("left") ? -segmentSize / 2 : segmentSize / 2),
        y: point.y + (cornerKind.startsWith("top") ? -segmentSize / 2 : segmentSize / 2),
        kind: cornerKind,
      });
      const outerCorner = namedCellCorner(kind);
      if (directions.size === 2) {
        // L bend: the inner wedge is diagonally opposite the outer corner and
        // carries the opposite kind so it hugs the two inner wall ends.
        corners.push(namedCellCorner(oppositeCornerKind(kind)));
        outerCorners.push(outerCorner);
        junctionFloors.push({
          ownerLinkId: owner.ownerLinkId,
          x: outerCorner.x,
          y: outerCorner.y,
          seed: owner.seed,
        });
      } else {
        corners.push(outerCorner);
      }
    }
  }
  return { junctionFloors, outerCorners, corners };
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
      lateralOffset: -segmentSize / 3,
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
        lateralOffset: -segmentSize / 3,
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
  return {
    segments,
    walls: buildWalls(segments, segmentSize),
    ...junctions,
    markings: buildMarkings(layout, segmentSize),
  };
}
