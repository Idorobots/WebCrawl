import {
  MAX_NODES,
  MAX_ROOMS_AFTER_COALESCE,
  ROOM_HEIGHT,
  ROOM_WIDTH,
} from "../config";
import type { ContentChunk, DungeonGraph, GraphNode } from "../types";
import { stableHash } from "./hash";

const MAX_ROOM_CONTENT_LENGTH = 48_000;
const CONTENT_TAGS = new Set([
  "a", "article", "aside", "b", "blockquote", "br", "code", "div", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "i", "img", "li",
  "main", "ol", "p", "pre", "section", "span", "strong", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "u", "ul",
]);
const CONTENT_OMIT_TAGS = new Set(["script", "style", "noscript", "template"]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>'\"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[char]!);
}

function safeUrl(rawUrl: string | null, pageUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function contentWrapper(element: Element, pageUrl: string): { open: string; close: string } | null {
  const tag = element.tagName.toLowerCase();
  if (!CONTENT_TAGS.has(tag) || tag === "img" || tag === "br") return null;
  if (tag === "a") {
    const href = safeUrl(element.getAttribute("href"), pageUrl);
    return href
      ? { open: `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`, close: "</a>" }
      : { open: "<span>", close: "</span>" };
  }
  return { open: `<${tag}>`, close: `</${tag}>` };
}

function collectContent(body: Element, byElement: ReadonlyMap<Element, GraphNode>, pageUrl: string): void {
  let order = 0;
  let lastOwner: GraphNode | null = null;
  const add = (owner: GraphNode, html: string): void => {
    if (!html) return;
    const chunks = owner.contentChunks!;
    const last = chunks.at(-1);
    if (last && lastOwner === owner && last.html.length + html.length <= MAX_ROOM_CONTENT_LENGTH) {
      last.html += html;
    } else {
      chunks.push({ order, html, label: owner.floorLabel });
    }
    order += 1;
    lastOwner = owner;
  };
  const visit = (element: Element, inheritedOwner: GraphNode, open: string, close: string): void => {
    if (CONTENT_OMIT_TAGS.has(element.tagName.toLowerCase())) return;
    const owner = byElement.get(element) ?? inheritedOwner;
    const wrapper = contentWrapper(element, pageUrl);
    const prefix = open + (wrapper?.open ?? "");
    const suffix = (wrapper?.close ?? "") + close;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent || "";
        // Retain spaces between inline elements and literal whitespace inside pre/code.
        if (!text.trim() && /[\r\n]/.test(text) && !element.closest("pre, code")) continue;
        // Split raw text before escaping so neither an entity nor an HTML tag is cut in half.
        const pieceSize = Math.max(1, Math.floor((MAX_ROOM_CONTENT_LENGTH - prefix.length - suffix.length) / 6));
        for (let start = 0; start < text.length;) {
          let end = Math.min(text.length, start + pieceSize);
          if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
          end = Math.max(start + 1, end);
          add(owner, prefix + escapeHtml(text.slice(start, end)) + suffix);
          start = end;
        }
      } else if (child instanceof Element) {
        const tag = child.tagName.toLowerCase();
        if (CONTENT_OMIT_TAGS.has(tag)) continue;
        if (tag === "br") add(byElement.get(child) ?? owner, prefix + "<br>" + suffix);
        else if (tag === "img") {
          const src = safeUrl(child.getAttribute("src"), pageUrl);
          if (src) add(byElement.get(child) ?? owner,
            `${prefix}<img src="${escapeHtml(src)}" alt="${escapeHtml(child.getAttribute("alt") || "")}">${suffix}`);
        } else visit(child, owner, prefix, suffix);
      }
    }
  };
  visit(body, byElement.get(body)!, "", "");
}

function nodeLootSeed(
  element: Element,
  text: string,
  structuralPath: string,
  pageUrl: string,
  floor: number,
): number {
  return stableHash([
    pageUrl,
    `floor-${floor}`,
    structuralPath,
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

function makeFloorLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const identity = element.id || element.classList[0] || tag;
  const label = identity.toUpperCase();
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
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

export function domToGraph(html: string, pageUrl: string, floor = 1): DungeonGraph {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const { body } = documentNode;
  if (!body) throw new Error("The fetched page did not contain a body element.");

  const nodes: GraphNode[] = [];
  const byElement = new Map<Element, GraphNode>();
  let nextId = 0;
  let truncated = false;

  const makeNode = (
    element: Element,
    parent: GraphNode | null,
    depth: number,
    structuralPath: string,
  ): GraphNode => {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    const hrefs = collectLinks(element, pageUrl);
    const node: GraphNode = {
      id: nextId++,
      parentId: parent?.id ?? null,
      tag,
      depth,
      hrefs,
      coalescedCount: 0,
      label: makeLabel(element, text),
      floorLabel: makeFloorLabel(element),
      title: makeTitle(element, text, hrefs[0] ?? null),
      contentHtml: null,
      contentChunks: [],
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
      lootSeed: nodeLootSeed(element, text, structuralPath, pageUrl, floor),
      isRoot: parent === null,
      isHidden: /(?:^|;)\s*display\s*:\s*none\s*(?:!important)?\s*(?:;|$)/i.test(
        element.getAttribute("style") || "",
      ),
      x: 0,
      y: 0,
      parentSide: null,
      directionFromParent: null,
      shape: "rectangle",
      childCount: 0,
    };
    byElement.set(element, node);
    return node;
  };

  const rootNode = makeNode(body, null, 0, "body");
  nodes.push(rootNode);
  const queue: Array<{ element: Element; node: GraphNode; depth: number; structuralPath: string }> = [
    { element: body, node: rootNode, depth: 0, structuralPath: "body" },
  ];

  while (queue.length && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (!current) break;
    const children = Array.from(current.element.children);

    for (const [childIndex, childElement] of children.entries()) {
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        break;
      }
      const childPath = `${current.structuralPath}/${childElement.tagName.toLowerCase()}[${childIndex}]`;
      const childNode = makeNode(childElement, current.node, current.depth + 1, childPath);
      nodes.push(childNode);
      queue.push({ element: childElement, node: childNode, depth: current.depth + 1, structuralPath: childPath });
    }
  }

  if (queue.length) truncated = true;
  collectContent(body, byElement, pageUrl);
  // Keep the bounded preview used by older consumers without dropping the full chunks.
  const previewById = new Map<number, ContentChunk[]>();
  for (const node of [...nodes].reverse()) {
    const preview = [...node.contentChunks!];
    for (const child of nodes.filter(child => child.parentId === node.id)) {
      preview.push(...previewById.get(child.id) ?? []);
    }
    preview.sort((left, right) => left.order - right.order);
    const bounded: ContentChunk[] = [];
    let length = 0;
    for (const chunk of preview) {
      if (length + chunk.html.length > MAX_ROOM_CONTENT_LENGTH) break;
      bounded.push(chunk);
      length += chunk.html.length;
    }
    previewById.set(node.id, bounded);
    node.contentHtml = bounded.length ? bounded.map(chunk => chunk.html).join("") : null;
  }
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

  const nodes: GraphNode[] = inputNodes.map((node) => ({
    ...node, hrefs: [...node.hrefs], contentChunks: node.contentChunks?.map(chunk => ({ ...chunk })),
  }));
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
      if (parent.contentChunks && leaf.contentChunks) {
        parent.contentChunks.push(...leaf.contentChunks);
        parent.contentChunks.sort((left, right) => left.order - right.order);
      }

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
