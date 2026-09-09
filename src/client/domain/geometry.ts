import { CORRIDOR_HALF_WIDTH, PLAYER_RADIUS } from "../config";
import type { GraphNode, LayoutLink, Point } from "../types";
import { corridorEndpoints } from "./layout";

export function pointInRoom(x: number, y: number, room: GraphNode, padding = PLAYER_RADIUS): boolean {
  return x >= room.x - room.width / 2 + padding &&
    x <= room.x + room.width / 2 - padding &&
    y >= room.y - room.height / 2 + padding &&
    y <= room.y + room.height / 2 - padding;
}

export function pointInCorridor(x: number, y: number, link: LayoutLink, radius = PLAYER_RADIUS): boolean {
  const endpoints = corridorEndpoints(link);
  const half = Math.max(radius + 4, CORRIDOR_HALF_WIDTH - radius * 0.15);
  const overlap = radius + 6;
  if (Math.abs(endpoints.y1 - endpoints.y2) < 0.001) {
    return x >= Math.min(endpoints.x1, endpoints.x2) - overlap &&
      x <= Math.max(endpoints.x1, endpoints.x2) + overlap &&
      Math.abs(y - endpoints.y1) <= half;
  }
  return y >= Math.min(endpoints.y1, endpoints.y2) - overlap &&
    y <= Math.max(endpoints.y1, endpoints.y2) + overlap &&
    Math.abs(x - endpoints.x1) <= half;
}

export function distanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}
