import {
  DIRECTIONS,
  ROOM_COLLISION_MARGIN,
  ROOM_X_SPACING,
  ROOM_Y_SPACING,
} from "../config";
import type { Direction, DungeonGraph, DungeonLayout, GraphNode, LayoutLink } from "../types";

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function directionOrder(parentSide: Direction | null, node: GraphNode): Direction[] {
  if (!parentSide) {
    const rootOrders: Direction[][] = [
      ["N", "E", "S", "W"],
      ["E", "S", "W", "N"],
      ["S", "W", "N", "E"],
      ["W", "N", "E", "S"],
    ];
    return [...(rootOrders[node.id % rootOrders.length] ?? rootOrders[0]!)];
  }

  const away = DIRECTIONS[parentSide].opposite;
  const sidePair: Direction[] = parentSide === "N" || parentSide === "S"
    ? ["E", "W"]
    : ["N", "S"];
  if (node.id % 2) sidePair.reverse();
  return [away, ...sidePair];
}

export function roomBounds(node: GraphNode, x = node.x, y = node.y, margin = 0): Bounds {
  return {
    left: x - node.width / 2 - margin,
    right: x + node.width / 2 + margin,
    top: y - node.height / 2 - margin,
    bottom: y + node.height / 2 + margin,
  };
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return !(
    left.right <= right.left || left.left >= right.right ||
    left.bottom <= right.top || left.top >= right.bottom
  );
}

export function layoutOrthogonal(graph: DungeonGraph, width: number, height: number): DungeonLayout {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const root = graph.nodes.find((node) => node.isRoot) ??
    graph.nodes.find((node) => node.parentId === null);
  if (!root) return { nodes: [], links: [], hiddenCount: graph.nodes.length };

  const placed: GraphNode[] = [];
  const placedIds = new Set<number>();
  const visualParentById = new Map<number, number>();
  const promotedHrefMap = new Map<number, Set<string>>();

  const addPromotedHrefs = (target: GraphNode, hrefs: string[]): void => {
    if (!hrefs.length) return;
    const promoted = promotedHrefMap.get(target.id) ?? new Set(target.hrefs);
    for (const href of hrefs) promoted.add(href);
    promotedHrefMap.set(target.id, promoted);
  };
  const collides = (node: GraphNode, x: number, y: number): boolean => {
    const candidate = roomBounds(node, x, y, ROOM_COLLISION_MARGIN);
    return placed.some((other) => boundsOverlap(
      candidate,
      roomBounds(other, other.x, other.y, ROOM_COLLISION_MARGIN),
    ));
  };

  root.x = width / 2;
  root.y = height / 2;
  root.parentSide = null;
  root.directionFromParent = null;
  placed.push(root);
  placedIds.add(root.id);

  const tryPlaceNode = (
    node: GraphNode,
    visualParent: GraphNode,
    availableDirections: Direction[],
  ): boolean => {
    for (let index = 0; index < availableDirections.length; index += 1) {
      const directionName = availableDirections[index];
      if (!directionName) continue;
      const direction = DIRECTIONS[directionName];
      const x = visualParent.x + direction.dx * ROOM_X_SPACING;
      const y = visualParent.y + direction.dy * ROOM_Y_SPACING;
      if (collides(node, x, y)) continue;

      availableDirections.splice(index, 1);
      node.x = x;
      node.y = y;
      node.directionFromParent = direction.name;
      node.parentSide = direction.opposite;
      placed.push(node);
      placedIds.add(node.id);
      visualParentById.set(node.id, visualParent.id);
      return true;
    }
    return false;
  };

  const collectSubtreeHrefs = (node: GraphNode, visualParent: GraphNode): void => {
    addPromotedHrefs(visualParent, node.hrefs);
    for (const child of childrenByParent.get(node.id) ?? []) collectSubtreeHrefs(child, visualParent);
  };

  const placeChildren = (parent: GraphNode): void => {
    const availableDirections = directionOrder(parent.parentSide, parent);
    for (const child of childrenByParent.get(parent.id) ?? []) {
      if (!availableDirections.length) {
        collectSubtreeHrefs(child, parent);
      } else if (tryPlaceNode(child, parent, availableDirections)) {
        placeChildren(child);
      } else {
        promoteSubtree(child, parent, availableDirections);
      }
    }
  };

  const promoteSubtree = (
    hiddenNode: GraphNode,
    visualParent: GraphNode,
    availableDirections: Direction[],
  ): void => {
    addPromotedHrefs(visualParent, hiddenNode.hrefs);
    for (const descendant of childrenByParent.get(hiddenNode.id) ?? []) {
      if (!availableDirections.length) {
        collectSubtreeHrefs(descendant, visualParent);
      } else if (tryPlaceNode(descendant, visualParent, availableDirections)) {
        placeChildren(descendant);
      } else {
        promoteSubtree(descendant, visualParent, availableDirections);
      }
    }
  };

  placeChildren(root);
  for (const node of placed) {
    const promoted = promotedHrefMap.get(node.id);
    if (promoted) node.hrefs = [...promoted].slice(0, 10);
  }

  const visibleLinks: LayoutLink[] = [];
  for (const node of placed) {
    if (node.id === root.id) continue;
    const visualParentId = visualParentById.get(node.id) ?? node.parentId;
    const visualParent = visualParentId === null ? undefined : nodesById.get(visualParentId);
    if (visualParent && placedIds.has(visualParent.id) && node.directionFromParent) {
      visibleLinks.push({ source: visualParent, target: node, direction: node.directionFromParent });
    }
  }
  return { nodes: placed, links: visibleLinks, hiddenCount: graph.nodes.length - placed.length };
}

export function corridorEndpoints(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } {
  const { source, target } = link;
  switch (link.direction) {
    case "N": return { x1: source.x, y1: source.y - source.height / 2, x2: target.x, y2: target.y + target.height / 2 };
    case "E": return { x1: source.x + source.width / 2, y1: source.y, x2: target.x - target.width / 2, y2: target.y };
    case "S": return { x1: source.x, y1: source.y + source.height / 2, x2: target.x, y2: target.y - target.height / 2 };
    case "W": return { x1: source.x - source.width / 2, y1: source.y, x2: target.x + target.width / 2, y2: target.y };
  }
}
