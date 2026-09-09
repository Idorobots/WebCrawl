import { CORRIDOR_HALF_WIDTH, PLAYER_RADIUS } from "../config";
import type { GraphNode, LayoutLink, Point } from "../types";

export function pointInRoom(x: number, y: number, room: GraphNode, padding = PLAYER_RADIUS): boolean {
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

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function pointInCorridor(x: number, y: number, link: LayoutLink, radius = PLAYER_RADIUS): boolean {
  const half = Math.max(radius + 4, (link.width || CORRIDOR_HALF_WIDTH * 2) / 2 - radius * 0.15);
  for (let index = 1; index < link.points.length; index += 1) {
    if (pointToSegmentDistance({ x, y }, link.points[index - 1]!, link.points[index]!) <= half) return true;
  }
  return false;
}

export function distanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}
