import type { EllipseRadii, GraphNode, LayoutLink, Point } from "../types";
import { PLAYER_SPEC, WORLD_GEOMETRY } from "./world-specs";

export function pointInRoom(x: number, y: number, room: GraphNode, padding: number | EllipseRadii = PLAYER_SPEC.footprintRadii): boolean {
  const dx = Math.abs(x - room.x);
  const dy = Math.abs(y - room.y);
  const halfWidth = room.width / 2 - ellipseRadii(padding).x;
  const halfHeight = room.height / 2 - ellipseRadii(padding).y;
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

/** Floor ownership only; actor clearance is checked against piece footprints. */
export function pointInRoomFloor(x: number, y: number, room: GraphNode): boolean {
  return x >= room.x - room.width / 2 && x <= room.x + room.width / 2 &&
    y >= room.y - room.height / 2 && y <= room.y + room.height / 2;
}

/** Room ownership must agree with the rectangular floor used for movement. */
export function roomContainingFloorPoint(rooms: readonly GraphNode[], point: Point): GraphNode | null {
  return rooms.find(room => pointInRoomFloor(point.x, point.y, room)) ?? null;
}

/** Reveal an attached room when approaching its shared doorway from the known side. */
export function pointNearDirectDoor(point: Point, room: GraphNode, link: LayoutLink): boolean {
  if (!link.direct || (room.id !== link.source.id && room.id !== link.target.id)) return false;
  if (!pointInRoomFloor(point.x, point.y, room)) return false;
  const door = link.points[0]!;
  const offsetY = link.direction === "E" || link.direction === "W"
    ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
  const range = WORLD_GEOMETRY.segmentSize / 2;
  return (point.x - door.x) ** 2 + (point.y - door.y - offsetY) ** 2 <= range ** 2;
}

/** Floor membership only. Door openings and wall blocking come exclusively from
 * the configurable piece footprints/hitboxes, not this corridor outline. */
export function pointInCorridor(x: number, y: number, link: LayoutLink): boolean {
  if (link.direct) return false; // The adjacent rooms already cover the shared doorway.
  const width = link.width || WORLD_GEOMETRY.corridorHalfWidth * 2;
  for (let index = 1; index < link.points.length; index += 1) {
    const start = link.points[index - 1]!;
    const end = link.points[index]!;
    if (start.y === end.y && x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) &&
        Math.abs(y - start.y) <= width / 2) return true;
    if (start.x === end.x && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y) &&
        Math.abs(x - start.x) <= width / 2) return true;
  }
  return false;
}

export type EllipseObstacle = Point & { radii: EllipseRadii };

export function ellipseRadii(radii: number | EllipseRadii): EllipseRadii {
  return typeof radii === "number" ? { x: radii, y: radii } : radii;
}

/** Support point of the Minkowski difference of two axis-aligned ellipses. */
function ellipseDifferenceSupport(a: Point, aRadii: EllipseRadii, b: Point, bRadii: EllipseRadii, dx: number, dy: number): Point {
  const aLength = Math.hypot(aRadii.x * dx, aRadii.y * dy) || 1;
  const bLength = Math.hypot(bRadii.x * dx, bRadii.y * dy) || 1;
  return {
    x: a.x - b.x + aRadii.x ** 2 * dx / aLength + bRadii.x ** 2 * dx / bLength,
    y: a.y - b.y + aRadii.y ** 2 * dy / aLength + bRadii.y ** 2 * dy / bLength,
  };
}

function convexOverlap(support: (dx: number, dy: number) => Point, initial: Point, inclusive: boolean): boolean {
  const triple = (u: Point, v: Point, w: Point): Point => ({
    x: v.x * (u.x * w.x + u.y * w.y) - u.x * (v.x * w.x + v.y * w.y),
    y: v.y * (u.x * w.x + u.y * w.y) - u.y * (v.x * w.x + v.y * w.y),
  });
  const dot = (u: Point, v: Point) => u.x * v.x + u.y * v.y;
  let dx = initial.x || 1;
  let dy = initial.y;
  const simplex: Point[] = [];
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const point = support(dx, dy);
    if (point.x * dx + point.y * dy < (inclusive ? -1e-8 : 1e-8)) return false;
    simplex.push(point);
    if (simplex.length === 2) {
      const [b, aPoint] = simplex;
      const ab = { x: b!.x - aPoint!.x, y: b!.y - aPoint!.y };
      const ao = { x: -aPoint!.x, y: -aPoint!.y };
      if (dot(ab, ao) <= 0) { simplex.shift(); dx = ao.x; dy = ao.y; }
      else {
        const direction = triple(ab, ao, ab);
        dx = direction.x;
        dy = direction.y;
        if (dx * dx + dy * dy < 1e-12) { dx = -ab.y; dy = ab.x; }
      }
    } else if (simplex.length === 3) {
      const [c, b, aPoint] = simplex;
      const ab = { x: b!.x - aPoint!.x, y: b!.y - aPoint!.y };
      const ac = { x: c!.x - aPoint!.x, y: c!.y - aPoint!.y };
      const ao = { x: -aPoint!.x, y: -aPoint!.y };
      const abPerp = triple(ac, ab, ab);
      const acPerp = triple(ab, ac, ac);
      if (dot(abPerp, ao) > 0) { simplex.shift(); dx = abPerp.x; dy = abPerp.y; }
      else if (dot(acPerp, ao) > 0) { simplex.splice(1, 1); dx = acPerp.x; dy = acPerp.y; }
      else return true;
    }
    if (simplex.length === 1) { dx = -simplex[0]!.x; dy = -simplex[0]!.y; }
    if (dx * dx + dy * dy < 1e-12) return true;
  }
  return true;
}

/** Convex-support intersection handles different ellipse aspect ratios without corner false positives. */
export function ellipsesOverlap(a: Point, aRadii: EllipseRadii, b: Point, bRadii: EllipseRadii, inclusive = false): boolean {
  if (aRadii.x <= 0 || aRadii.y <= 0 || bRadii.x <= 0 || bRadii.y <= 0) return false;
  if (aRadii.x === aRadii.y && bRadii.x === bRadii.y) {
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    return inclusive ? distance <= aRadii.x + bRadii.x : distance < aRadii.x + bRadii.x;
  }
  if (Math.abs(a.x - b.x) > aRadii.x + bRadii.x ||
      Math.abs(a.y - b.y) > aRadii.y + bRadii.y) return false;
  return convexOverlap((dx, dy) => ellipseDifferenceSupport(a, aRadii, b, bRadii, dx, dy),
    { x: b.x - a.x, y: b.y - a.y }, inclusive);
}

/** The swept footprint is the convex hull of the ellipse at both endpoints. */
export function sweptEllipsesOverlap(from: Point, to: Point, mover: EllipseRadii, target: Point, targetRadii: EllipseRadii): boolean {
  if (mover.x <= 0 || mover.y <= 0 || targetRadii.x <= 0 || targetRadii.y <= 0) return false;
  if (Math.max(from.x, to.x) + mover.x < target.x - targetRadii.x ||
      Math.min(from.x, to.x) - mover.x > target.x + targetRadii.x ||
      Math.max(from.y, to.y) + mover.y < target.y - targetRadii.y ||
      Math.min(from.y, to.y) - mover.y > target.y + targetRadii.y) return false;
  return convexOverlap((dx, dy) => {
    const end = (to.x - from.x) * dx + (to.y - from.y) * dy > 0 ? to : from;
    return ellipseDifferenceSupport(end, mover, target, targetRadii, dx, dy);
  }, { x: target.x - from.x, y: target.y - from.y }, true);
}

export function footprintsOverlap(a: Point, aRadius: number | EllipseRadii, b: Point, bRadius: number | EllipseRadii): boolean {
  return ellipsesOverlap(a, ellipseRadii(aRadius), b, ellipseRadii(bRadius));
}

/** Every point of the inner ellipse must lie inside the outer ellipse. */
export function ellipseContainsEllipse(outer: Point, outerRadii: EllipseRadii, inner: Point, innerRadii: EllipseRadii): boolean {
  if (outerRadii.x < innerRadii.x || outerRadii.y < innerRadii.y ||
      outerRadii.x <= 0 || outerRadii.y <= 0) return false;
  const dx = Math.abs(inner.x - outer.x);
  const dy = Math.abs(inner.y - outer.y);
  if (dx + innerRadii.x > outerRadii.x || dy + innerRadii.y > outerRadii.y) return false;
  const score = (angle: number) =>
    ((dx + innerRadii.x * Math.cos(angle)) / outerRadii.x) ** 2 +
    ((dy + innerRadii.y * Math.sin(angle)) / outerRadii.y) ** 2;
  const steps = 32;
  const values = Array.from({ length: steps + 1 }, (_, i) => score(i * Math.PI / (2 * steps)));
  if (values.some(value => value > 1 + 1e-10)) return false;
  for (let i = 1; i < steps; i += 1) {
    if (values[i]! < values[i - 1]! || values[i]! < values[i + 1]!) continue;
    let left = (i - 1) * Math.PI / (2 * steps);
    let right = (i + 1) * Math.PI / (2 * steps);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const a = left + (right - left) * 0.382;
      const b = right - (right - left) * 0.382;
      if (score(a) < score(b)) left = a;
      else right = b;
    }
    if (score((left + right) / 2) > 1 + 1e-10) return false;
  }
  return true;
}

/** Allow an actor already overlapping a footprint to leave it, but never move deeper in. */
export function footprintMoveIsClear(
  from: Point,
  to: Point,
  radius: number | EllipseRadii,
  blocker: Point,
  blockerRadius: number | EllipseRadii,
): boolean {
  if (!footprintsOverlap(to, radius, blocker, blockerRadius)) return true;
  if (!footprintsOverlap(from, radius, blocker, blockerRadius)) return false;
  const awayX = from.x - blocker.x;
  const awayY = from.y - blocker.y;
  const combined = { x: ellipseRadii(radius).x + ellipseRadii(blockerRadius).x,
    y: ellipseRadii(radius).y + ellipseRadii(blockerRadius).y };
  const normalizedDistance = (point: Point) => Math.hypot((point.x - blocker.x) / combined.x, (point.y - blocker.y) / combined.y);
  return ((awayX / combined.x ** 2) * (to.x - from.x) +
    (awayY / combined.y ** 2) * (to.y - from.y) > 0 ||
    (awayX === 0 && awayY === 0 && (to.x !== from.x || to.y !== from.y))) &&
    normalizedDistance(to) >= normalizedDistance(from);
}

export function slideAlongObstacles(
  position: Point,
  movement: Point,
  radius: number | EllipseRadii,
  obstacles: readonly EllipseObstacle[],
  canOccupy: (point: Point) => boolean,
): Point | null {
  const intended = { x: position.x + movement.x, y: position.y + movement.y };
  const blocker = obstacles.find(obstacle =>
    footprintsOverlap(intended, radius, obstacle, obstacle.radii)
  );
  if (!blocker) return null;

  const blockerRadii = blocker.radii;
  const combined = { x: ellipseRadii(radius).x + blockerRadii.x, y: ellipseRadii(radius).y + blockerRadii.y };
  const offsetX = position.x - blocker.x;
  const offsetY = position.y - blocker.y;
  const currentDistance = Math.hypot(offsetX, offsetY);
  const movementDistance = Math.hypot(movement.x, movement.y);
  const normal = currentDistance > 0.001
    ? { x: offsetX / (combined.x * combined.x), y: offsetY / (combined.y * combined.y) }
    : movementDistance > 0.001
      ? { x: -movement.x / movementDistance, y: -movement.y / movementDistance }
      : { x: 1, y: 0 };
  const normalLength = Math.hypot(normal.x, normal.y) || 1;
  normal.x /= normalLength;
  normal.y /= normalLength;
  const boundaryDistance = 1 / Math.hypot(normal.x / combined.x, normal.y / combined.y);
  const base = currentDistance < boundaryDistance
    ? {
      x: blocker.x + normal.x * (boundaryDistance + 0.01),
      y: blocker.y + normal.y * (boundaryDistance + 0.01),
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
