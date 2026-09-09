import { CORRIDOR_HALF_WIDTH, MAX_CORRIDOR_LENGTH, ROOM_COLLISION_MARGIN } from "../config";
import type {
  Direction,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  LayoutLink,
  Point,
  RoomShape,
} from "../types";

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const SHAPES: RoomShape[] = ["rectangle", "wide", "tall", "capsule", "octagon"];
const CARDINALS: Direction[] = ["N", "E", "S", "W"];

export function roomBounds(node: GraphNode, x = node.x, y = node.y, margin = 0): Bounds {
  return {
    left: x - node.width / 2 - margin,
    right: x + node.width / 2 + margin,
    top: y - node.height / 2 - margin,
    bottom: y + node.height / 2 + margin,
  };
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return !(left.right <= right.left || left.left >= right.right || left.bottom <= right.top || left.top >= right.bottom);
}

function configureRoom(node: GraphNode, childCount: number): void {
  const shape = SHAPES[node.lootSeed % SHAPES.length] ?? "rectangle";
  const exitBonus = Math.max(0, childCount - 3) * 46;
  node.shape = shape;
  node.childCount = childCount;
  switch (shape) {
    case "wide":
      node.width = 720 + exitBonus;
      node.height = 360;
      break;
    case "tall":
      node.width = 460;
      node.height = 560 + exitBonus;
      break;
    case "capsule":
      node.width = 640 + exitBonus;
      node.height = 380;
      break;
    case "octagon":
      node.width = 580 + exitBonus;
      node.height = 460;
      break;
    default:
      node.width = 580 + exitBonus;
      node.height = 400;
  }
  if (node.isRoot) {
    node.width = Math.max(node.width, 700);
    node.height = Math.max(node.height, 480);
  }
}

function directionForDelta(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "S" : "N";
}

function opposite(direction: Direction): Direction {
  return ({ N: "S", E: "W", S: "N", W: "E" } as const)[direction];
}

function placementCandidates(parent: GraphNode, node: GraphNode): Point[] {
  const candidates: Point[] = [];
  const rotation = node.lootSeed % CARDINALS.length;
  const order = CARDINALS.map((_, index) => CARDINALS[(index + rotation) % CARDINALS.length]!);
  for (let ring = 0; ring < 18; ring += 1) {
    const lateral = [0, -1, 1, -2, 2, -3, 3][ring % 7]! * 170;
    const reach = 160 + Math.floor(ring / 7) * 250;
    for (const direction of order) {
      const horizontal = direction === "E" || direction === "W";
      const distance = horizontal
        ? (parent.width + node.width) / 2 + reach
        : (parent.height + node.height) / 2 + reach;
      candidates.push({
        x: parent.x + (direction === "E" ? distance : direction === "W" ? -distance : lateral),
        y: parent.y + (direction === "S" ? distance : direction === "N" ? -distance : lateral),
      });
    }
  }
  return candidates;
}

function pointOnSide(room: GraphNode, side: Direction, slot: number): Point {
  const extent = (side === "N" || side === "S" ? room.width : room.height) / 2 - 75;
  const step = Math.min(88, Math.max(0, extent / 2));
  const sequence = slot === 0 ? 0 : Math.ceil(slot / 2) * (slot % 2 ? -1 : 1);
  const offset = Math.max(-extent, Math.min(extent, sequence * step));
  const halfWidth = room.width / 2;
  const halfHeight = room.height / 2;
  if (room.shape === "capsule") {
    const radius = Math.min(halfWidth, halfHeight);
    const straight = Math.max(0, halfWidth - radius);
    if (side === "E" || side === "W") {
      const y = Math.max(-radius, Math.min(radius, offset));
      const x = straight + Math.sqrt(Math.max(0, radius ** 2 - y ** 2));
      return { x: room.x + (side === "E" ? x : -x), y: room.y + y };
    }
    const x = Math.max(-halfWidth, Math.min(halfWidth, offset));
    const curveX = Math.max(0, Math.abs(x) - straight);
    const y = Math.sqrt(Math.max(0, radius ** 2 - curveX ** 2));
    return { x: room.x + x, y: room.y + (side === "S" ? y : -y) };
  }
  if (room.shape === "octagon") {
    const cut = Math.min(room.width, room.height) * 0.18;
    if (side === "E" || side === "W") {
      const inset = Math.max(0, Math.abs(offset) - (halfHeight - cut));
      const x = halfWidth - inset;
      return { x: room.x + (side === "E" ? x : -x), y: room.y + offset };
    }
    const inset = Math.max(0, Math.abs(offset) - (halfWidth - cut));
    const y = halfHeight - inset;
    return { x: room.x + offset, y: room.y + (side === "S" ? y : -y) };
  }
  switch (side) {
    case "N": return { x: room.x + offset, y: room.y - room.height / 2 };
    case "E": return { x: room.x + room.width / 2, y: room.y + offset };
    case "S": return { x: room.x + offset, y: room.y + room.height / 2 };
    case "W": return { x: room.x - room.width / 2, y: room.y + offset };
  }
}

function segmentBounds(start: Point, end: Point, margin = CORRIDOR_HALF_WIDTH): Bounds {
  return {
    left: Math.min(start.x, end.x) - margin,
    right: Math.max(start.x, end.x) + margin,
    top: Math.min(start.y, end.y) - margin,
    bottom: Math.max(start.y, end.y) + margin,
  };
}

function corridorIntersectsBounds(points: readonly Point[], bounds: Bounds): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (boundsOverlap(segmentBounds(points[index - 1]!, points[index]!), bounds)) return true;
  }
  return false;
}

export function corridorIntersectsRoom(link: LayoutLink, room: GraphNode, margin = 20): boolean {
  return corridorIntersectsBounds(link.points, roomBounds(room, room.x, room.y, margin));
}

export function corridorLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return length;
}

function routeIsClear(points: readonly Point[], rooms: readonly GraphNode[], sourceId: number, targetId: number): boolean {
  return rooms.every(room =>
    room.id === sourceId || room.id === targetId ||
    !corridorIntersectsBounds(points, roomBounds(room, room.x, room.y, 20))
  );
}

function corridorRoute(
  start: Point,
  end: Point,
  direction: Direction,
  rooms: readonly GraphNode[],
  sourceId: number,
  targetId: number,
): Point[] | null {
  const routes: Point[][] = [];
  if (direction === "E" || direction === "W") {
    if (Math.abs(start.y - end.y) < 1) routes.push([start, end]);
    for (const fraction of [0.5, 0.33, 0.67]) {
      const x = start.x + (end.x - start.x) * fraction;
      routes.push([start, { x, y: start.y }, { x, y: end.y }, end]);
    }
  } else {
    if (Math.abs(start.x - end.x) < 1) routes.push([start, end]);
    for (const fraction of [0.5, 0.33, 0.67]) {
      const y = start.y + (end.y - start.y) * fraction;
      routes.push([start, { x: start.x, y }, { x: end.x, y }, end]);
    }
  }
  return routes.find(points =>
    corridorLength(points) <= MAX_CORRIDOR_LENGTH && routeIsClear(points, rooms, sourceId, targetId)
  ) ?? null;
}

export function layoutOrthogonal(graph: DungeonGraph, width: number, height: number): DungeonLayout {
  const childrenByParent = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const node of graph.nodes) configureRoom(node, childrenByParent.get(node.id)?.length ?? 0);

  const root = graph.nodes.find(node => node.isRoot) ?? graph.nodes.find(node => node.parentId === null);
  if (!root) return { nodes: [], links: [], hiddenCount: graph.nodes.length };
  root.x = width / 2;
  root.y = height / 2;
  root.parentSide = null;
  root.directionFromParent = null;

  const placed: GraphNode[] = [root];
  const links: LayoutLink[] = [];
  const sideSlots = new Map<string, number>();
  const promotedHrefMap = new Map<number, Set<string>>();

  const addPromotedHrefs = (target: GraphNode, hrefs: readonly string[]): void => {
    if (!hrefs.length) return;
    const promoted = promotedHrefMap.get(target.id) ?? new Set(target.hrefs);
    for (const href of hrefs) promoted.add(href);
    promotedHrefMap.set(target.id, promoted);
  };
  const collectSubtreeHrefs = (node: GraphNode, target: GraphNode): void => {
    addPromotedHrefs(target, node.hrefs);
    for (const child of childrenByParent.get(node.id) ?? []) collectSubtreeHrefs(child, target);
  };
  const roomPlacementIsClear = (node: GraphNode, point: Point): boolean => {
    const candidate = roomBounds(node, point.x, point.y, ROOM_COLLISION_MARGIN + 70);
    if (placed.some(other => boundsOverlap(candidate, roomBounds(other, other.x, other.y, ROOM_COLLISION_MARGIN + 70)))) return false;
    return links.every(link => !corridorIntersectsBounds(link.points, roomBounds(node, point.x, point.y, 20)));
  };

  const tryPlace = (node: GraphNode, parent: GraphNode): LayoutLink | null => {
    for (const point of placementCandidates(parent, node)) {
      if (!roomPlacementIsClear(node, point)) continue;
      node.x = point.x;
      node.y = point.y;
      const direction = directionForDelta(node.x - parent.x, node.y - parent.y);
      const sideKey = `${parent.id}:${direction}`;
      const slot = sideSlots.get(sideKey) ?? 0;
      const start = pointOnSide(parent, direction, slot);
      const end = pointOnSide(node, opposite(direction), 0);
      const points = corridorRoute(start, end, direction, placed, parent.id, node.id);
      if (!points) continue;
      node.directionFromParent = direction;
      node.parentSide = opposite(direction);
      sideSlots.set(sideKey, slot + 1);
      return {
        id: `${parent.id}->${node.id}`,
        source: parent,
        target: node,
        direction,
        ownerRoomId: parent.id,
        width: CORRIDOR_HALF_WIDTH * 2,
        points,
      };
    }
    return null;
  };

  const placeChildren = (parent: GraphNode): void => {
    for (const child of childrenByParent.get(parent.id) ?? []) {
      const link = tryPlace(child, parent);
      if (!link) {
        collectSubtreeHrefs(child, parent);
        continue;
      }
      placed.push(child);
      links.push(link);
      placeChildren(child);
    }
  };
  placeChildren(root);

  for (const room of placed) {
    const promoted = promotedHrefMap.get(room.id);
    if (promoted) room.hrefs = [...promoted].slice(0, 10);
  }
  return { nodes: placed, links, hiddenCount: graph.nodes.length - placed.length };
}

export function corridorEndpoints(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } {
  const start = link.points[0]!;
  const end = link.points[link.points.length - 1]!;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
