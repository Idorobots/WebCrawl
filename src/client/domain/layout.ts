import type {
  Direction,
  DungeonGraph,
  DungeonLayout,
  ContentChunk,
  GraphNode,
  LayoutLink,
  Point,
} from "../types";
import { stableHash } from "./hash";
import { ROOM_DEFINITIONS, WORLD_GEOMETRY } from "./specs";

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const CARDINALS: Direction[] = ["N", "E", "S", "W"];
const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;
const MAX_FORK_BRANCHES = 8;
const MAX_FORKS_PER_ROOM = 4;
const MAX_CORRIDOR_GAP_SEGMENTS = 48;
const FORK_TRUNK_SEGMENTS = 3;
const MULTI_FORK_TRUNK_SEGMENTS = 9;
const FORK_BRANCH_SPACING_SEGMENTS = 6;
const FORK_BRANCH_GAP_SEGMENTS = 3;

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

function directionVector(direction: Direction): Point {
  switch (direction) {
    case "N": return { x: 0, y: -1 };
    case "E": return { x: 1, y: 0 };
    case "S": return { x: 0, y: 1 };
    case "W": return { x: -1, y: 0 };
  }
}

function forkBranchDirection(mainDirection: Direction, index: number): Direction {
  const positive = index % 2 === 0;
  if (mainDirection === "E" || mainDirection === "W") return positive ? "N" : "S";
  return positive ? "W" : "E";
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

function routeOverlapsOtherCorridor(
  points: readonly Point[],
  links: readonly LayoutLink[],
  forkId?: string,
): boolean {
  return links.some(link => {
    if (link.direct) return false;
    // Branches of the same fork deliberately share a trunk and junctions.
    if (forkId && link.forkId === forkId) return false;
    for (let index = 1; index < points.length; index += 1) {
      const candidate = segmentBounds(points[index - 1]!, points[index]!);
      for (let otherIndex = 1; otherIndex < link.points.length; otherIndex += 1) {
        const existing = segmentBounds(link.points[otherIndex - 1]!, link.points[otherIndex]!, link.width / 2);
        if (boundsOverlap(candidate, existing)) return true;
      }
    }
    return false;
  });
}

export function layoutOrthogonal(graph: DungeonGraph): DungeonLayout {
  const nodes = graph.nodes.map(node => ({
    ...node, hrefs: [...node.hrefs], contentChunks: node.contentChunks?.map(chunk => ({ ...chunk })),
  }));
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
  const promotedContentMap = new Map<number, ContentChunk[]>();

  const addPromotedHrefs = (target: GraphNode, hrefs: readonly string[]): void => {
    if (!hrefs.length) return;
    const promoted = promotedHrefMap.get(target.id) ?? new Set(target.hrefs);
    for (const href of hrefs) promoted.add(href);
    promotedHrefMap.set(target.id, promoted);
  };
  const collectSubtreeContent = (node: GraphNode, target: GraphNode, subtree = node): void => {
    addPromotedHrefs(target, node.hrefs);
    const chunks = node.contentChunks ?? (node.contentHtml
      ? [{ order: node.id, html: node.contentHtml, label: node.floorLabel }] : []);
    if (chunks.length) {
      const promoted = promotedContentMap.get(target.id) ?? [];
      promoted.push(...chunks.map(chunk => ({
        ...chunk, sourceSubtreeId: subtree.id, label: subtree.floorLabel,
      })));
      promotedContentMap.set(target.id, promoted);
    }
    for (const child of childrenByParent.get(node.id) ?? []) collectSubtreeContent(child, target, subtree);
  };
  const roomPlacementIsClear = (node: GraphNode, point: Point, touchingParent?: GraphNode): boolean => {
    const margin = WORLD_GEOMETRY.roomCollisionMargin;
    const candidate = roomBounds(node, point.x, point.y, margin);
    if (placed.some(other => other.id === touchingParent?.id
      ? boundsOverlap(roomBounds(node, point.x, point.y), roomBounds(other))
      : boundsOverlap(candidate, roomBounds(other, other.x, other.y, margin)))) return false;
    return links.every(link => link.direct || !corridorIntersectsBounds(link.points, candidate));
  };

  const tryPlace = (node: GraphNode, parent: GraphNode): LayoutLink | null => {
    const rotation = node.lootSeed % CARDINALS.length;
    const directions = CARDINALS.map((_, index) => CARDINALS[(index + rotation) % CARDINALS.length]!);
    // Short one-to-one links usually look better as shared doorways. Long
    // forked corridors still come from the parent's separate fork preference.
    const preferDirect = (stableHash(`${parent.lootSeed}|${node.lootSeed}|direct`) >>> 16) % 5 < 4;
    for (let gapSegments = preferDirect ? 0 : 2; gapSegments <= MAX_CORRIDOR_GAP_SEGMENTS;
      gapSegments += gapSegments === 0 ? 2 : 1) {
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
        const direct = gapSegments === 0;
        if (!roomPlacementIsClear(node, point, direct ? parent : undefined)) continue;
        node.x = point.x;
        node.y = point.y;
        const targetSide = opposite(direction);
        const end = doorPositionForSlot(node, targetSide, 0);
        const points = [start, end];
        if (direct && (start.x !== end.x || start.y !== end.y)) continue;
        if (!direct && !routeIsClear(points, placed, parent.id, node.id)) continue;
        if (routeOverlapsOtherCorridor(points, links)) continue;
        node.directionFromParent = direction;
        node.parentSide = targetSide;
        sideSlots.set(sideKey, slot + 1);
        sideSlots.set(`${node.id}:${targetSide}`, 1);
        return {
          id: `${parent.id}->${node.id}`,
          source: parent,
          target: node,
          direction,
          targetDirection: targetSide,
          ownerRoomId: parent.id,
          width: WORLD_GEOMETRY.corridorHalfWidth * 2,
          points,
          ...(direct ? { direct: true } : {}),
        };
      }
    }
    return null;
  };

  const tryPlaceForkChild = (
    node: GraphNode,
    parent: GraphNode,
    mainDirection: Direction,
    index: number,
    slot: number,
    singleSide: boolean,
    trunkSegments: number,
    branchSpacing: number,
  ): LayoutLink | null => {
    const sideKey = `${parent.id}:${mainDirection}`;
    if (slot >= doorCapacity(parent, mainDirection)) return null;
    const start = doorPositionForSlot(parent, mainDirection, slot);
    const main = directionVector(mainDirection);
    // Parallel fork trunks branch away from each other, never across the other trunk.
    const branchDirection = singleSide
      ? forkBranchDirection(mainDirection, slot === 0 ? 1 : 0)
      : forkBranchDirection(mainDirection, index);
    const branch = directionVector(branchDirection);
    const branchOffset = trunkSegments + (singleSide ? index : Math.floor(index / 2)) * branchSpacing;
    const fork = {
      x: start.x + main.x * branchOffset * SEGMENT_SIZE,
      y: start.y + main.y * branchOffset * SEGMENT_SIZE,
    };
    const targetSide = opposite(branchDirection);
    const targetHalfSize = branchDirection === "E" || branchDirection === "W"
      ? node.width / 2
      : node.height / 2;
    const point = {
      x: fork.x + branch.x * (FORK_BRANCH_GAP_SEGMENTS * SEGMENT_SIZE + targetHalfSize),
      y: fork.y + branch.y * (FORK_BRANCH_GAP_SEGMENTS * SEGMENT_SIZE + targetHalfSize),
    };
    if (!roomPlacementIsClear(node, point)) return null;
    node.x = point.x;
    node.y = point.y;
    const end = doorPositionForSlot(node, targetSide, 0);
    const points = [start, fork, end];
    if (!routeIsClear(points, placed, parent.id, node.id)) return null;
    const forkId = `${parent.id}:${mainDirection}:${slot}`;
    if (routeOverlapsOtherCorridor(points, links, forkId)) return null;
    node.directionFromParent = branchDirection;
    node.parentSide = targetSide;
    sideSlots.set(sideKey, Math.max(sideSlots.get(sideKey) ?? 0, slot + 1));
    sideSlots.set(`${node.id}:${targetSide}`, 1);
    return {
      id: `${parent.id}->${node.id}`,
      source: parent,
      target: node,
      direction: mainDirection,
      targetDirection: targetSide,
      ownerRoomId: parent.id,
      width: WORLD_GEOMETRY.corridorHalfWidth * 2,
      points,
      forkId,
      forkPointIndex: 1,
    };
  };

  const placeChildren = (parent: GraphNode): void => {
    const children = childrenByParent.get(parent.id) ?? [];
    // Choose the sibling layout per room, independently of its room dimensions.
    const preferCorridorForks = ((stableHash(`${parent.lootSeed}|fork-style`) >>> 16) & 1) === 0;
    const useFork = preferCorridorForks ? children.length > 1 : children.length > 4;
    const rotation = (parent.lootSeed + parent.id) % CARDINALS.length;
    const directions = CARDINALS.map((_, index) => CARDINALS[(index + rotation) % CARDINALS.length]!)
      .filter(direction => direction !== parent.parentSide);
    const forkCount = useFork
      ? Math.min(MAX_FORKS_PER_ROOM, Math.ceil(Math.min(children.length, MAX_FORKS_PER_ROOM * MAX_FORK_BRANCHES)
        / (preferCorridorForks ? MAX_FORK_BRANCHES : 2)))
      : 0;
    if (forkCount > directions.length) {
      const oppositeSide = opposite(parent.parentSide!);
      const extra = [...directions]
        .filter(direction => (sideSlots.get(`${parent.id}:${direction}`) ?? 0) + 1 < doorCapacity(parent, direction))
        .sort((left, right) =>
          (right === oppositeSide ? 1 : 0) - (left === oppositeSide ? 1 : 0) ||
          doorCapacity(parent, right) - doorCapacity(parent, left)
        )[0];
      if (extra) directions.push(extra);
    }
    const forkSides = directions.slice(0, forkCount);
    const reservedSlots = new Map<string, number>();
    const forkSlots = forkSides.map(direction => {
      const sideKey = `${parent.id}:${direction}`;
      const slot = reservedSlots.get(sideKey) ?? sideSlots.get(sideKey) ?? 0;
      reservedSlots.set(sideKey, slot + 1);
      return slot;
    });
    const maxChildSegments = Math.ceil(Math.max(0, ...children.map(child => Math.max(child.width, child.height))) / SEGMENT_SIZE);
    const trunkSegments = (forkCount > 1 ? MULTI_FORK_TRUNK_SEGMENTS : FORK_TRUNK_SEGMENTS)
      + Math.max(0, maxChildSegments - 4);
    const branchSpacing = Math.max(FORK_BRANCH_SPACING_SEGMENTS, maxChildSegments + 2);
    const placedChildren: GraphNode[] = [];
    const forkBranchCounts = forkSides.map(() => 0);
    for (const [index, child] of children.entries()) {
      let link: LayoutLink | null = null;
      if (useFork && index < MAX_FORKS_PER_ROOM * MAX_FORK_BRANCHES) {
        // Room forks spread children over entrances; corridor forks fill a long trunk first.
        for (let attempt = 0; attempt < forkSides.length && !link; attempt += 1) {
          const forkIndex = ((preferCorridorForks ? Math.floor(index / MAX_FORK_BRANCHES) : index) + attempt) % forkSides.length;
          const direction = forkSides[forkIndex]!;
          const branchIndex = forkBranchCounts[forkIndex]!;
          if (branchIndex >= MAX_FORK_BRANCHES) continue;
          link = tryPlaceForkChild(
            child, parent, direction, branchIndex, forkSlots[forkIndex]!,
            forkSides.indexOf(direction) !== forkSides.lastIndexOf(direction),
            trunkSegments, branchSpacing,
          );
          if (link) forkBranchCounts[forkIndex] = branchIndex + 1;
        }
      } else if (!useFork) link = tryPlace(child, parent);
      if (!link) {
        collectSubtreeContent(child, parent);
        continue;
      }
      placed.push(child);
      links.push(link);
      if (useFork) placedChildren.push(child);
      else placeChildren(child);
    }
    for (const child of placedChildren) placeChildren(child);
  };
  placeChildren(root);

  for (const room of placed) {
    const promoted = promotedHrefMap.get(room.id);
    if (promoted) room.hrefs = [...promoted].slice(0, 10);
    const content = promotedContentMap.get(room.id);
    if (content) room.contentChunks = [...room.contentChunks ?? [], ...content]
      .sort((left, right) => left.order - right.order);
  }
  return { nodes: placed, links, hiddenCount: nodes.length - placed.length };
}

export function corridorEndpoints(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } {
  const start = link.points[0]!;
  const end = link.points[link.points.length - 1]!;
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}
