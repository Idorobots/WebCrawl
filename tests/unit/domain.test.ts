import { describe, expect, it } from "vitest";
import { MAX_CORRIDOR_LENGTH, ROOM_HEIGHT, ROOM_WIDTH } from "../../src/client/config";
import { distanceSquared, pointInCorridor, pointInRoom } from "../../src/client/domain/geometry";
import {
  buildInteractiveObjects,
  buildSceneryDrops,
  decorationSpecsForCorridor,
  decorationSpecsForRoom,
  lootCountForRoom,
  monsterSpecsForCorridor,
  monsterSpecsForRoom,
  sceneryDropKindForSeed,
} from "../../src/client/domain/generation";
import { coalesceLeaves, domToGraph } from "../../src/client/domain/graph";
import { stableHash } from "../../src/client/domain/hash";
import { corridorEndpoints, corridorIntersectsRoom, corridorLength, layoutOrthogonal } from "../../src/client/domain/layout";
import { aStarPath, revealedRoomPath } from "../../src/client/domain/pathfinding";
import type { DungeonGraph, GraphNode } from "../../src/client/types";

const node = (id: number, parentId: number | null, depth: number, overrides: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId,
  depth,
  tag: "div",
  hrefs: [],
  coalescedCount: 0,
  label: `<div>#${id}`,
  title: "<div>",
  width: ROOM_WIDTH,
  height: ROOM_HEIGHT,
  lootSeed: id + 10,
  isRoot: parentId === null,
  isHidden: false,
  x: 0,
  y: 0,
  parentSide: null,
  directionFromParent: null,
  shape: "rectangle",
  childCount: 0,
  ...overrides,
});

describe("DOM graph generation", () => {
  it("uses stable hashes", () => {
    expect(stableHash("WebCrawl")).toBe(1_745_441_892);
    expect(stableHash("WebCrawl")).toBe(stableHash("WebCrawl"));
  });

  it("traverses breadth-first and resolves HTTP links", () => {
    const graph = domToGraph(`
      <body><main><h1>Title</h1><a href="/next">Next</a></main><footer>Footer</footer></body>
    `, "https://example.com/start");

    expect(graph.nodes.map(({ id, parentId, tag, depth }) => ({ id, parentId, tag, depth }))).toEqual([
      { id: 0, parentId: null, tag: "body", depth: 0 },
      { id: 1, parentId: 0, tag: "main", depth: 1 },
      { id: 2, parentId: 0, tag: "footer", depth: 1 },
      { id: 3, parentId: 1, tag: "h1", depth: 2 },
      { id: 4, parentId: 1, tag: "a", depth: 2 },
    ]);
    expect(graph.nodes[4]?.hrefs).toEqual(["https://example.com/next"]);
  });

  it("coalesces deepest leaves and promotes their links", () => {
    const nodes = [
      node(0, null, 0),
      node(1, 0, 1),
      node(2, 1, 2),
      node(3, 2, 3, { hrefs: ["https://example.com/deep"] }),
    ];
    const result = coalesceLeaves(nodes, 3);
    expect(result.map(({ id }) => id)).toEqual([0, 1, 2]);
    expect(result[2]?.hrefs).toEqual(["https://example.com/deep"]);
    expect(result[2]?.coalescedCount).toBe(1);
  });
});

describe("layout and geometry", () => {
  const graph: DungeonGraph = {
    nodes: [node(0, null, 0), node(1, 0, 1), node(2, 0, 1)],
    links: [{ source: 0, target: 1 }, { source: 0, target: 2 }],
    originalCount: 3,
    coalescedCount: 0,
    truncated: false,
  };
  const layout = layoutOrthogonal(graph, 800, 600);

  it("places every room deterministically with owned, routed corridors", () => {
    const repeated = layoutOrthogonal(graph, 800, 600);
    expect(layout.nodes.map(({ id, x, y, shape }) => ({ id, x, y, shape }))).toEqual(
      repeated.nodes.map(({ id, x, y, shape }) => ({ id, x, y, shape })),
    );
    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.hiddenCount).toBe(0);
    expect(layout.nodes[0]).toMatchObject({ x: 400, y: 300 });
    expect(layout.links[0]).toMatchObject({ id: "0->1", ownerRoomId: 0, width: 72 });
    const endpoints = corridorEndpoints(layout.links[0]!);
    expect(endpoints).toEqual({
      x1: layout.links[0]!.points[0]!.x,
      y1: layout.links[0]!.points[0]!.y,
      x2: layout.links[0]!.points.at(-1)!.x,
      y2: layout.links[0]!.points.at(-1)!.y,
    });
  });

  it("recognizes rooms, corridors, and point distances", () => {
    expect(pointInRoom(400, 300, layout.nodes[0]!)).toBe(true);
    const [start, end] = layout.links[0]!.points;
    expect(pointInCorridor((start!.x + end!.x) / 2, (start!.y + end!.y) / 2, layout.links[0]!)).toBe(true);
    expect(distanceSquared({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(25);
  });

  it("finds paths only through revealed rooms", () => {
    expect(revealedRoomPath(layout, new Set([0, 1, 2]), 1, 2)).toEqual([1, 0, 2]);
    expect(revealedRoomPath(layout, new Set([0, 1]), 1, 2)).toBeNull();
  });

  it("generates deterministic content owned by each corridor's parent room", () => {
    const link = layout.links[0]!;
    const decorations = decorationSpecsForCorridor(link);
    const monsters = monsterSpecsForCorridor(link, 3);
    expect(decorations).toEqual(decorationSpecsForCorridor(link));
    expect(monsters).toEqual(monsterSpecsForCorridor(link, 3));
    expect(monsters).toEqual([]);
    expect(decorations.every(item => item.roomId === link.source.id)).toBe(true);
    expect(monsters.every(item => item.spawnRoomId === link.source.id)).toBe(true);
  });

  it("skips rooms rather than forcing corridors through rooms or beyond the length limit", () => {
    const nodes = Array.from({ length: 100 }, (_, id) => node(
      id,
      id === 0 ? null : Math.floor((id - 1) / 5),
      id === 0 ? 0 : 1,
      { lootSeed: id + 100 },
    ));
    const denseLayout = layoutOrthogonal({
      nodes,
      links: [],
      originalCount: nodes.length,
      coalescedCount: 0,
      truncated: false,
    }, 1200, 800);

    expect(denseLayout.nodes.length).toBeGreaterThan(1);
    expect(denseLayout.nodes.length).toBeLessThan(nodes.length);
    expect(denseLayout.links).toHaveLength(denseLayout.nodes.length - 1);
    expect(denseLayout.hiddenCount).toBe(nodes.length - denseLayout.nodes.length);
    expect(new Set(denseLayout.nodes.map(room => room.shape)).size).toBeGreaterThan(1);
    for (const link of denseLayout.links) {
      expect(corridorLength(link.points)).toBeLessThanOrEqual(MAX_CORRIDOR_LENGTH);
      for (const room of denseLayout.nodes) {
        if (room.id === link.source.id || room.id === link.target.id) continue;
        expect(corridorIntersectsRoom(link, room)).toBe(false);
      }
    }
  });

  it("routes around blocked doorway geometry with A*", () => {
    const blocked = new Set(["18,18"]);
    const path = aStarPath(
      { x: 0, y: 0 },
      { x: 36, y: 36 },
      ({ x, y }) => !blocked.has(`${x},${y}`),
      18,
      200,
      { minX: -18, maxX: 54, minY: -18, maxY: 54 },
    );

    expect(path).not.toBeNull();
    expect(path?.some(point => point.x === 18 && point.y === 18)).toBe(false);
  });
});

describe("deterministic room contents", () => {
  const room = node(7, 0, 1, {
    x: 500,
    y: 400,
    tag: "img",
    lootSeed: stableHash("image-room"),
    hrefs: ["https://example.com/a", "https://example.com/b"],
  });
  const layout = { nodes: [room], links: [], hiddenCount: 0 };

  it("repeats decoration and monster specifications exactly", () => {
    const decorations = decorationSpecsForRoom(room);
    expect(decorations).toEqual(decorationSpecsForRoom(room));
    expect(decorations.length).toBeGreaterThanOrEqual(3);
    expect(decorations.length).toBeLessThanOrEqual(5);
    expect(decorations.filter(item => item.obstacle).length).toBeGreaterThanOrEqual(2);
    expect(new Set(decorations.map(item => `${item.x},${item.y}`)).size).toBe(decorations.length);
    expect(monsterSpecsForRoom(room)).toEqual([]);
  });

  it("creates rich image-room loot and capped stairs", () => {
    const generated = buildInteractiveObjects(layout, "https://example.com/", null, new Set());
    expect(lootCountForRoom(room)).toBeGreaterThanOrEqual(3);
    expect(lootCountForRoom(room)).toBeLessThanOrEqual(5);
    expect(generated.loot).toHaveLength(lootCountForRoom(room));
    expect(generated.stairs.map(({ url }) => url)).toEqual(room.hrefs);
  });

  it("generates denser deterministic monster and loot populations", () => {
    const rooms = Array.from({ length: 500 }, (_, index) => node(index + 20, 0, 1, {
      tag: "section",
      lootSeed: stableHash(`room-${index}`),
      isRoot: false,
    }));
    const floorOneCounts = rooms.map(candidate => monsterSpecsForRoom(candidate, 1).length);
    const floorFiveCounts = rooms.map(candidate => monsterSpecsForRoom(candidate, 5).length);
    const lootCounts = rooms.map(candidate => lootCountForRoom(candidate));

    expect(floorOneCounts.every(count => count === 2 || count === 3)).toBe(true);
    expect(floorFiveCounts.every(count => count === 4 || count === 5)).toBe(true);
    expect(floorFiveCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(
      floorOneCounts.reduce((sum, count) => sum + count, 0),
    );
    expect(lootCounts.filter(count => count > 0).length).toBeGreaterThan(100);
    expect(lootCounts.every(count => count >= 0 && count <= 2)).toBe(true);
  });

  it("scales monster stats and includes sentries on deeper floors", () => {
    const rooms = Array.from({ length: 200 }, (_, index) => node(index + 1200, 0, 1, {
      tag: "article",
      lootSeed: stableHash(`depth-room-${index}`),
      isRoot: false,
    }));
    const floorOne = rooms.flatMap(room => monsterSpecsForRoom(room, 1));
    const floorSeven = rooms.flatMap(room => monsterSpecsForRoom(room, 7));

    const earlyCombatant = floorOne.find(monster => monster.kind !== "sentry");
    const deepCombatant = floorSeven.find(monster => monster.kind === (earlyCombatant?.kind ?? "fast"));
    expect(earlyCombatant).toBeDefined();
    expect(deepCombatant).toBeDefined();
    expect((deepCombatant?.maxHp ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.maxHp ?? 0);
    expect((deepCombatant?.speed ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.speed ?? 0);
    expect((deepCombatant?.attackDamage ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.attackDamage ?? 0);

    const sentry = floorSeven.find(monster => monster.kind === "sentry");
    expect(sentry).toBeDefined();
    expect(sentry?.speed).toBe(0);
    expect(sentry?.projectileSpeed ?? 0).toBeGreaterThan(0);
    expect(sentry?.projectileRange ?? 0).toBeGreaterThan(0);
  });

  it("deterministically gives a small share of scenery loot and medkit drops", () => {
    const drops = Array.from({ length: 1_000 }, (_, index) =>
      sceneryDropKindForSeed(stableHash(`scenery-${index}`)),
    ).filter(kind => kind !== null);

    expect(drops.length).toBeGreaterThan(100);
    expect(drops.length).toBeLessThan(200);
    expect(drops).toContain("medkit");
    expect(drops.some(kind => kind !== "medkit")).toBe(true);
    expect(sceneryDropKindForSeed(12345)).toBe(sceneryDropKindForSeed(12345));
  });

  it("restores uncollected drops from destroyed scenery", () => {
    const decorations = Array.from({ length: 100 }, (_, index) =>
      decorationSpecsForRoom(node(index + 600, 0, 1, { lootSeed: stableHash(`decor-${index}`) })),
    ).flat();
    const droppingItem = decorations.find(item => item.obstacle && item.dropKind);
    if (!droppingItem) throw new Error("Expected deterministic scenery drop fixture");

    const destroyedItem = { ...droppingItem, hp: 0, destroyed: true };
    const drops = buildSceneryDrops([destroyedItem], "https://example.com/", new Set());

    expect(drops).toEqual([{
      id: `https://example.com/::${destroyedItem.id}::scenery-drop`,
      roomId: destroyedItem.roomId,
      x: destroyedItem.x,
      y: destroyedItem.y,
      kind: destroyedItem.dropKind,
    }]);
    expect(buildSceneryDrops([droppingItem], "https://example.com/", new Set())).toEqual([]);
    expect(buildSceneryDrops([destroyedItem], "https://example.com/", new Set([drops[0]!.id]))).toEqual([]);
  });
});
