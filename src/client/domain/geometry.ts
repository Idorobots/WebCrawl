import type { GraphNode, LayoutLink, Point } from "../types";
import { PLAYER_SPEC, WORLD_GEOMETRY } from "./specs";

export function pointInRoom(x: number, y: number, room: GraphNode, padding = PLAYER_SPEC.radius): boolean {
  const dx = Math.abs(x - room.x);
  const dy = Math.abs(y - room.y);
  const halfWidth = room.width / 2 - padding;
  const halfHeight = room.height / 2 - padding;
  if (halfWidth <= 0 || halfHeight <= 0 || dx > halfWidth || dy > halfHeight) return false;
  if (room.shape === "capsule") {
    const radius = Math.min(halfWidth, halfHeight);
    const straight = Math.max(0, halfWidth - radius);
    if (dx <= straight) return dy <= radius;
    return (dx - straight) ** 2 + dy ** 2 <= radius ** 2;
  }
  if (room.shape === "octagon") {
    const cut = Math.min(halfWidth, halfHeight) * 0.36;
    return dx + dy <= halfWidth + halfHeight - cut;
  }
  return true;
}

export function pointInRoomFloor(x: number, y: number, room: GraphNode, radius = PLAYER_SPEC.radius): boolean {
  const left = room.x - room.width / 2 + radius;
  const right = room.x + room.width / 2 - radius;
  const top = room.y - room.height / 2 + radius;
  const bottom = room.y + room.height / 2 - radius;
  return left <= right && top <= bottom && x >= left && x <= right && y >= top && y <= bottom;
}

/** Room ownership must agree with the rectangular floor used for movement. */
export function roomContainingFloorPoint(rooms: readonly GraphNode[], point: Point): GraphNode | null {
  return rooms.find(room => pointInRoomFloor(point.x, point.y, room, 0)) ?? null;
}

function pointInAxisAlignedSegment(point: Point, start: Point, end: Point, halfWidth: number, includeEnds = true): boolean {
  if (start.y === end.y) {
    const min = Math.min(start.x, end.x);
    const max = Math.max(start.x, end.x);
    const along = includeEnds ? point.x >= min && point.x <= max : point.x > min && point.x < max;
    return along && Math.abs(point.y - start.y) <= halfWidth;
  }
  const min = Math.min(start.y, end.y);
  const max = Math.max(start.y, end.y);
  const along = includeEnds ? point.y >= min && point.y <= max : point.y > min && point.y < max;
  return along && Math.abs(point.x - start.x) <= halfWidth;
}

function pointInCorridorBody(point: Point, start: Point, end: Point, width: number, radius: number): boolean {
  if (start.y === end.y) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const top = start.y - width / 2 + radius;
    const bottom = start.y + width / 2 - radius;
    return point.x > minX && point.x < maxX && point.y >= top && point.y <= bottom;
  }
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const left = start.x - width / 2 + radius;
  const right = start.x + width / 2 - radius;
  return point.y > minY && point.y < maxY && point.x >= left && point.x <= right;
}

export function pointInCorridor(x: number, y: number, link: LayoutLink, radius = PLAYER_SPEC.radius): boolean {
  if (link.direct) {
    const door = link.points[0]!;
    const along = radius + WORLD_GEOMETRY.wallThickness;
    const across = WORLD_GEOMETRY.doorOpeningWidth / 2 - radius;
    if (across < 0) return false;
    return link.direction === "E" || link.direction === "W"
      ? Math.abs(x - door.x) <= along && Math.abs(y - door.y - WORLD_GEOMETRY.verticalDoorPassableOffsetY) <= across
      : Math.abs(y - door.y) <= along && Math.abs(x - door.x) <= across;
  }
  const width = link.width || WORLD_GEOMETRY.corridorHalfWidth * 2;
  for (let index = 1; index < link.points.length; index += 1) {
    const originalStart = link.points[index - 1]!;
    const originalEnd = link.points[index]!;
    const dx = originalEnd.x - originalStart.x;
    const dy = originalEnd.y - originalStart.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const unitX = dx / length;
    const unitY = dy / length;
    const point = { x, y };
    // Door ends carry a blocked band of the wall's thickness: the corridor
    // floor stops short of the door frame, and only the door opening cuts
    // through the band.
    const bodyStart = index === 1
      ? {
        x: originalStart.x + unitX * WORLD_GEOMETRY.wallThickness,
        y: originalStart.y + unitY * WORLD_GEOMETRY.wallThickness,
      }
      : originalStart;
    const bodyEnd = index === link.points.length - 1
      ? {
        x: originalEnd.x - unitX * WORLD_GEOMETRY.wallThickness,
        y: originalEnd.y - unitY * WORLD_GEOMETRY.wallThickness,
      }
      : originalEnd;
    if (pointInCorridorBody(point, bodyStart, bodyEnd, width, radius)) return true;

    // Consecutive runs meet at a square junction. Treat it as floor rather
    // than two exclusive segment endpoints so pathfinding can cross turns.
    if (index < link.points.length - 1) {
      const junction = originalEnd;
      const halfWidth = width / 2 - radius;
      const top = junction.y - width / 2 + radius;
      const bottom = junction.y + width / 2 - radius;
      if (
        halfWidth >= 0 &&
        x >= junction.x - halfWidth && x <= junction.x + halfWidth &&
        y >= top && y <= bottom
      ) return true;
    }

    const doorwayHalf = Math.max(0, WORLD_GEOMETRY.doorOpeningWidth / 2 - radius);
    const verticalDoorOffset = originalStart.y === originalEnd.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
    if (index === 1) {
      const insideStart = {
        x: originalStart.x - unitX * radius,
        y: originalStart.y - unitY * radius + verticalDoorOffset,
      };
      const outsideStart = {
        x: originalStart.x + unitX * WORLD_GEOMETRY.wallThickness,
        y: originalStart.y + unitY * WORLD_GEOMETRY.wallThickness + verticalDoorOffset,
      };
      if (pointInAxisAlignedSegment(point, insideStart, outsideStart, doorwayHalf)) return true;
    }
    if (index === link.points.length - 1) {
      const insideEnd = {
        x: originalEnd.x + unitX * radius,
        y: originalEnd.y + unitY * radius + verticalDoorOffset,
      };
      const outsideEnd = {
        x: originalEnd.x - unitX * WORLD_GEOMETRY.wallThickness,
        y: originalEnd.y - unitY * WORLD_GEOMETRY.wallThickness + verticalDoorOffset,
      };
      if (pointInAxisAlignedSegment(point, outsideEnd, insideEnd, doorwayHalf)) return true;
    }
  }
  return false;
}

export interface CircleObstacle extends Point {
  radius: number;
}

export function slideAlongObstacles(
  position: Point,
  movement: Point,
  radius: number,
  obstacles: readonly CircleObstacle[],
  canOccupy: (point: Point) => boolean,
): Point | null {
  const intended = { x: position.x + movement.x, y: position.y + movement.y };
  const blocker = obstacles.find(obstacle =>
    Math.hypot(intended.x - obstacle.x, intended.y - obstacle.y) < radius + obstacle.radius
  );
  if (!blocker) return null;

  const requiredDistance = radius + blocker.radius;
  const offsetX = position.x - blocker.x;
  const offsetY = position.y - blocker.y;
  const currentDistance = Math.hypot(offsetX, offsetY);
  const movementDistance = Math.hypot(movement.x, movement.y);
  const normal = currentDistance > 0.001
    ? { x: offsetX / currentDistance, y: offsetY / currentDistance }
    : movementDistance > 0.001
      ? { x: -movement.x / movementDistance, y: -movement.y / movementDistance }
      : { x: 1, y: 0 };
  const base = currentDistance < requiredDistance
    ? {
      x: blocker.x + normal.x * (requiredDistance + 0.01),
      y: blocker.y + normal.y * (requiredDistance + 0.01),
    }
    : position;
  const inward = movement.x * normal.x + movement.y * normal.y;
  const tangent = inward < 0
    ? { x: movement.x - normal.x * inward, y: movement.y - normal.y * inward }
    : movement;

  for (const scale of [1, 0.75, 0.5, 0.25]) {
    const candidate = { x: base.x + tangent.x * scale, y: base.y + tangent.y * scale };
    if (Math.hypot(candidate.x - base.x, candidate.y - base.y) > 0.001 && canOccupy(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function distanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}
