import {
  MAX_CHILDREN_PER_ROOM,
  MAX_NODES,
  MAX_ROOMS_AFTER_COALESCE,
  ROOM_HEIGHT,
  ROOM_WIDTH,
} from "../config";
import type { DungeonGraph, GraphNode } from "../types";
import { stableHash } from "./hash";

function nodeLootSeed(element: Element, text: string): number {
  return stableHash([
    element.tagName.toLowerCase(),
    element.id || "",
    typeof element.className === "string" ? element.className : "",
    element.getAttribute("href") || "",
    element.getAttribute("src") || "",
    text.slice(0, 240),
  ].join("|"));
}

export function collectLinks(element: Element, pageUrl: string): string[] {
  if (element.tagName.toLowerCase() !== "a") return [];
  const rawHref = element.getAttribute("href");
  if (!rawHref) return [];

  try {
    const resolved = new URL(rawHref, pageUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? [resolved.href]
      : [];
  } catch {
    return [];
  }
}

function makeLabel(element: Element, text: string): string {
  const tag = element.tagName.toLowerCase();
  let extra = "";
  if (element.id) extra = `#${element.id}`;
  else if (element.classList.length) extra = `.${element.classList[0]}`;
  else if (tag === "a" && text) extra = ` ${text.slice(0, 16)}`;

  const label = `<${tag}>${extra}`;
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

function makeTitle(element: Element, text: string, href: string | null): string {
  const parts = [`<${element.tagName.toLowerCase()}>`];
  if (element.id) parts.push(`#${element.id}`);
  if (typeof element.className === "string" && element.className) {
    parts.push(`.${element.className.trim().replace(/\s+/g, ".")}`);
  }
  if (text) parts.push(text.slice(0, 120));
  if (href) parts.push(`→ ${href}`);
  return parts.join("\n");
}

export function domToGraph(html: string, pageUrl: string): DungeonGraph {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const { body } = documentNode;
  if (!body) throw new Error("The fetched page did not contain a body element.");

  const nodes: GraphNode[] = [];
  let nextId = 0;
  let truncated = false;

  const makeNode = (element: Element, parent: GraphNode | null, depth: number): GraphNode => {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    const hrefs = collectLinks(element, pageUrl);
    return {
      id: nextId++,
      parentId: parent?.id ?? null,
      tag,
      depth,
      hrefs,
      coalescedCount: 0,
      label: makeLabel(element, text),
      title: makeTitle(element, text, hrefs[0] ?? null),
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
      lootSeed: nodeLootSeed(element, text),
      isRoot: parent === null,
      isHidden: /(?:^|;)\s*display\s*:\s*none\s*(?:!important)?\s*(?:;|$)/i.test(
        element.getAttribute("style") || "",
      ),
      x: 0,
      y: 0,
      parentSide: null,
      directionFromParent: null,
    };
  };

  const rootNode = makeNode(body, null, 0);
  nodes.push(rootNode);
  const queue: Array<{ element: Element; node: GraphNode; depth: number }> = [
    { element: body, node: rootNode, depth: 0 },
  ];

  while (queue.length && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (!current) break;
    const children = Array.from(current.element.children).slice(0, MAX_CHILDREN_PER_ROOM);

    for (const childElement of children) {
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        break;
      }
      const childNode = makeNode(childElement, current.node, current.depth + 1);
      nodes.push(childNode);
      queue.push({ element: childElement, node: childNode, depth: current.depth + 1 });
    }
  }

  if (queue.length) truncated = true;
  const originalCount = nodes.length;
  const coalescedNodes = coalesceLeaves(nodes, MAX_ROOMS_AFTER_COALESCE);
  const survivingIds = new Set(coalescedNodes.map((node) => node.id));
  const survivingLinks = coalescedNodes
    .filter((node) => node.parentId !== null && survivingIds.has(node.parentId))
    .map((node) => ({ source: node.parentId as number, target: node.id }));

  return {
    nodes: coalescedNodes,
    links: survivingLinks,
    originalCount,
    coalescedCount: originalCount - coalescedNodes.length,
    truncated,
  };
}

export function coalesceLeaves(inputNodes: GraphNode[], limit: number): GraphNode[] {
  if (inputNodes.length <= limit) return inputNodes;

  const nodes = inputNodes.map((node) => ({ ...node, hrefs: [...node.hrefs] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const alive = new Set(nodes.map((node) => node.id));

  const childCounts = (): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const id of alive) counts.set(id, 0);
    for (const id of alive) {
      const node = byId.get(id);
      if (node?.parentId !== null && node && alive.has(node.parentId)) {
        counts.set(node.parentId, (counts.get(node.parentId) || 0) + 1);
      }
    }
    return counts;
  };

  while (alive.size > limit) {
    const counts = childCounts();
    let leaves = [...alive]
      .map((id) => byId.get(id))
      .filter((node): node is GraphNode => Boolean(
        node && node.parentId !== null && alive.has(node.parentId) && (counts.get(node.id) || 0) === 0,
      ));
    if (!leaves.length) break;

    const deepestLeafDepth = Math.max(...leaves.map((node) => node.depth));
    leaves = leaves.filter((node) => node.depth === deepestLeafDepth);
    const nonLinkLeaves = leaves.filter((node) => node.hrefs.length === 0);
    if (nonLinkLeaves.length) leaves = nonLinkLeaves;
    leaves.sort((left, right) => right.id - left.id);

    const toRemove = Math.min(leaves.length, alive.size - limit);
    for (const leaf of leaves.slice(0, toRemove)) {
      const parent = leaf.parentId === null ? undefined : byId.get(leaf.parentId);
      if (!parent || !alive.has(parent.id)) continue;
      parent.coalescedCount += 1 + leaf.coalescedCount;
      parent.hrefs = [...new Set([...parent.hrefs, ...leaf.hrefs])];

      if (leaf.hrefs.length || leaf.coalescedCount) {
        const extra: string[] = [];
        if (leaf.hrefs.length) extra.push(`${leaf.hrefs.length} inherited link${leaf.hrefs.length === 1 ? "" : "s"}`);
        if (leaf.coalescedCount) extra.push(`${leaf.coalescedCount} nested room${leaf.coalescedCount === 1 ? "" : "s"}`);
        parent.title += `\nFolded <${leaf.tag}> (${extra.join(", ") || "leaf room"})`;
      }
      alive.delete(leaf.id);
    }
  }

  return nodes.filter((node) => alive.has(node.id)).map((node) => {
    if (node.coalescedCount > 0) {
      node.label = `${node.label} +${node.coalescedCount}`;
      if (node.label.length > 24) node.label = `${node.label.slice(0, 23)}…`;
      node.title += `\nCoalesced rooms: ${node.coalescedCount}`;
    }
    if (node.hrefs.length) node.title += `\nLinks: ${node.hrefs.join("\n")}`;
    return node;
  });
}
