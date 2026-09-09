import { CORRIDOR_HALF_WIDTH, ROOM_COLLISION_MARGIN } from "../config";
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

function pointOnSide(room: GraphNode, side: Direction, slot: number, count: number): Point {
  const spread = Math.min(
    (side === "N" || side === "S" ? room.width : room.height) - 150,
    Math.max(0, (count - 1) * 88),
  );
  const offset = count <= 1 ? 0 : -spread / 2 + spread * slot / (count - 1);
  switch (side) {
    case "N": return { x: room.x + offset, y: room.y - room.height / 2 };
    case "E": return { x: room.x + room.width / 2, y: room.y + offset };
    case "S": return { x: room.x + offset, y: room.y + room.height / 2 };
    case "W": return { x: room.x - room.width / 2, y: room.y + offset };
  }
}

function routeScore(points: Point[], rooms: readonly GraphNode[], sourceId: number, targetId: number): number {
  let score = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const segmentBounds: Bounds = {
      left: Math.min(start.x, end.x) - CORRIDOR_HALF_WIDTH,
      right: Math.max(start.x, end.x) + CORRIDOR_HALF_WIDTH,
      top: Math.min(start.y, end.y) - CORRIDOR_HALF_WIDTH,
      bottom: Math.max(start.y, end.y) + CORRIDOR_HALF_WIDTH,
    };
    for (const room of rooms) {
      if (room.id === sourceId || room.id === targetId) continue;
      if (boundsOverlap(segmentBounds, roomBounds(room, room.x, room.y, 20))) score += 1;
    }
  }
  return score;
}

function corridorRoute(start: Point, end: Point, rooms: readonly GraphNode[], sourceId: number, targetId: number): Point[] {
  if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return [start, end];
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const routes: Point[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
  ];
  return routes.sort((left, right) =>
    routeScore(left, rooms, sourceId, targetId) - routeScore(right, rooms, sourceId, targetId) || left.length - right.length
  )[0]!;
}

export function layoutOrthogonal(graph: DungeonGraph, width: number, height: number): DungeonLayout {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
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
  const collides = (node: GraphNode, point: Point): boolean => {
    const candidate = roomBounds(node, point.x, point.y, ROOM_COLLISION_MARGIN + 70);
    return placed.some(other => boundsOverlap(candidate, roomBounds(other, other.x, other.y, ROOM_COLLISION_MARGIN + 70)));
  };

  for (const node of graph.nodes) {
    if (node.id === root.id) continue;
    const parent = nodesById.get(node.parentId ?? root.id) ?? root;
    let point = placementCandidates(parent, node).find(candidate => !collides(node, candidate));
    if (!point) {
      const index = placed.length;
      const angle = index * 2.399963;
      const radius = 900 + index * 170;
      point = { x: root.x + Math.cos(angle) * radius, y: root.y + Math.sin(angle) * radius };
      while (collides(node, point)) {
        point = { x: point.x + Math.cos(angle) * 240, y: point.y + Math.sin(angle) * 240 };
      }
    }
    node.x = point.x;
    node.y = point.y;
    node.directionFromParent = directionForDelta(node.x - parent.x, node.y - parent.y);
    node.parentSide = opposite(node.directionFromParent);
    placed.push(node);
  }

  const pending = placed.filter(node => node.id !== root.id).map(node => {
    const source = nodesById.get(node.parentId ?? root.id) ?? root;
    const sourceSide = directionForDelta(node.x - source.x, node.y - source.y);
    return { node, source, sourceSide, targetSide: opposite(sourceSide) };
  });
  const sideTotals = new Map<string, number>();
  for (const item of pending) {
    const key = `${item.source.id}:${item.sourceSide}`;
    sideTotals.set(key, (sideTotals.get(key) ?? 0) + 1);
  }
  const sideSlots = new Map<string, number>();
  const links: LayoutLink[] = pending.map(item => {
    const key = `${item.source.id}:${item.sourceSide}`;
    const slot = sideSlots.get(key) ?? 0;
    sideSlots.set(key, slot + 1);
    const start = pointOnSide(item.source, item.sourceSide, slot, sideTotals.get(key) ?? 1);
    const end = pointOnSide(item.node, item.targetSide, 0, 1);
    return {
      id: `${item.source.id}->${item.node.id}`,
      source: item.source,
      target: item.node,
      direction: item.sourceSide,
      ownerRoomId: item.source.id,
      width: CORRIDOR_HALF_WIDTH * 2,
      points: corridorRoute(start, end, placed, item.source.id, item.node.id),
    };
  });
  return { nodes: placed, links, hiddenCount: 0 };
}

export function corridorEndpoints(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } {
  const start = link.points[0]!;
  const end = link.points[link.points.length - 1]!;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
