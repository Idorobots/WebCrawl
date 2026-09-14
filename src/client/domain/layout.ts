import type {
  Direction,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  LayoutLink,
  Point,
} from "../types";
import { ROOM_DEFINITIONS, WORLD_GEOMETRY } from "./specs";

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const CARDINALS: Direction[] = ["N", "E", "S", "W"];
const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;

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
  const exitCount = childCount + (node.isRoot ? 0 : 1);
  node.shape = "rectangle";
  node.childCount = childCount;
  if (node.tag === "script" || exitCount > 8) {
    node.width = ROOM_DEFINITIONS.boss.width;
    node.height = ROOM_DEFINITIONS.boss.height;
    return;
  }
  if (exitCount > 4) {
    const definition = node.lootSeed % 2 ? ROOM_DEFINITIONS.wide : ROOM_DEFINITIONS.tall;
    node.width = definition.width;
    node.height = definition.height;
    return;
  }
  node.width = ROOM_DEFINITIONS.rectangle.width;
  node.height = ROOM_DEFINITIONS.rectangle.height;
}

function opposite(direction: Direction): Direction {
  return ({ N: "S", E: "W", S: "N", W: "E" } as const)[direction];
}

function sideSegmentCount(room: GraphNode, side: Direction): number {
  const length = side === "N" || side === "S" ? room.width : room.height;
  return Math.round(length / SEGMENT_SIZE);
}

export function doorCapacity(room: GraphNode, side: Direction): number {
  return Math.max(1, sideSegmentCount(room, side) / 2 - 1);
}

function doorOffsetForSlot(room: GraphNode, side: Direction, slot: number): number {
  if (slot < 0 || slot >= doorCapacity(room, side)) throw new Error(`Door slot ${slot} does not fit room ${room.id} ${side}`);
  if (slot === 0) return 0;
  const distance = Math.ceil(slot / 2) * SEGMENT_SIZE * 2;
  return slot % 2 ? -distance : distance;
}

export function doorPositionForSlot(room: GraphNode, side: Direction, slot: number): Point {
  const offset = doorOffsetForSlot(room, side, slot);
  switch (side) {
    case "N": return { x: room.x + offset, y: room.y - room.height / 2 };
    case "E": return { x: room.x + room.width / 2, y: room.y + offset };
    case "S": return { x: room.x + offset, y: room.y + room.height / 2 };
    case "W": return { x: room.x - room.width / 2, y: room.y + offset };
  }
}

function segmentBounds(start: Point, end: Point, margin = WORLD_GEOMETRY.corridorHalfWidth): Bounds {
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

export function corridorIntersectsRoom(link: LayoutLink, room: GraphNode, margin = WORLD_GEOMETRY.wallThickness): boolean {
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
    !corridorIntersectsBounds(points, roomBounds(room, room.x, room.y, WORLD_GEOMETRY.wallThickness))
  );
}

export function layoutOrthogonal(graph: DungeonGraph): DungeonLayout {
  const nodes = graph.nodes.map(node => ({ ...node, hrefs: [...node.hrefs] }));
  const childrenByParent = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const node of nodes) configureRoom(node, childrenByParent.get(node.id)?.length ?? 0);

  const root = nodes.find(node => node.isRoot) ?? nodes.find(node => node.parentId === null);
  if (!root) return { nodes: [], links: [], hiddenCount: nodes.length };
  root.x = 0;
  root.y = 0;
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
    const candidate = roomBounds(node, point.x, point.y, WORLD_GEOMETRY.roomCollisionMargin);
    if (placed.some(other => boundsOverlap(candidate, roomBounds(other, other.x, other.y, WORLD_GEOMETRY.roomCollisionMargin)))) return false;
    return links.every(link => !corridorIntersectsBounds(link.points, candidate));
  };

  const tryPlace = (node: GraphNode, parent: GraphNode): LayoutLink | null => {
    const rotation = node.lootSeed % CARDINALS.length;
    const directions = CARDINALS.map((_, index) => CARDINALS[(index + rotation) % CARDINALS.length]!);
    for (let gapSegments = 2; gapSegments <= 12; gapSegments += 1) {
      for (const direction of directions) {
        const sideKey = `${parent.id}:${direction}`;
        const slot = sideSlots.get(sideKey) ?? 0;
        if (slot >= doorCapacity(parent, direction)) continue;
        const start = doorPositionForSlot(parent, direction, slot);
        const horizontal = direction === "E" || direction === "W";
        const distance = horizontal
          ? (parent.width + node.width) / 2 + gapSegments * SEGMENT_SIZE
          : (parent.height + node.height) / 2 + gapSegments * SEGMENT_SIZE;
        const point = {
          x: horizontal ? parent.x + (direction === "E" ? distance : -distance) : start.x,
          y: horizontal ? start.y : parent.y + (direction === "S" ? distance : -distance),
        };
        if (!roomPlacementIsClear(node, point)) continue;
        node.x = point.x;
        node.y = point.y;
        const targetSide = opposite(direction);
        const end = doorPositionForSlot(node, targetSide, 0);
        const points = [start, end];
        if (corridorLength(points) > WORLD_GEOMETRY.maxCorridorLength || !routeIsClear(points, placed, parent.id, node.id)) continue;
        node.directionFromParent = direction;
        node.parentSide = targetSide;
        sideSlots.set(sideKey, slot + 1);
        sideSlots.set(`${node.id}:${targetSide}`, 1);
        return {
          id: `${parent.id}->${node.id}`,
          source: parent,
          target: node,
          direction,
          ownerRoomId: parent.id,
          width: WORLD_GEOMETRY.corridorHalfWidth * 2,
          points,
        };
      }
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
  return { nodes: placed, links, hiddenCount: nodes.length - placed.length };
}

export function corridorEndpoints(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } {
  const start = link.points[0]!;
  const end = link.points[link.points.length - 1]!;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
