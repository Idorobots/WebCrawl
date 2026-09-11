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
  return pointInRoom(x, y, room, radius);
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function pointInCorridor(x: number, y: number, link: LayoutLink, radius = PLAYER_SPEC.radius): boolean {
  const half = Math.max(
    0,
    (link.width || WORLD_GEOMETRY.corridorHalfWidth * 2) / 2 - radius,
  );
  for (let index = 1; index < link.points.length; index += 1) {
    const originalStart = link.points[index - 1]!;
    const originalEnd = link.points[index]!;
    const dx = originalEnd.x - originalStart.x;
    const dy = originalEnd.y - originalStart.y;
    const length = Math.hypot(dx, dy);
    const doorwayDepth = radius;
    const start = index === 1 && length > 0
      ? { x: originalStart.x - dx / length * doorwayDepth, y: originalStart.y - dy / length * doorwayDepth }
      : originalStart;
    const end = index === link.points.length - 1 && length > 0
      ? { x: originalEnd.x + dx / length * doorwayDepth, y: originalEnd.y + dy / length * doorwayDepth }
      : originalEnd;
    if (pointToSegmentDistance({ x, y }, start, end) <= half) return true;
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
