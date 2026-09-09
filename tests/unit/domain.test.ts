import { describe, expect, it } from "vitest";
import { CORRIDOR_HALF_WIDTH, MAX_CORRIDOR_LENGTH, MONSTER_RADIUS, ROOM_HEIGHT, ROOM_WIDTH } from "../../src/client/config";
import { distanceSquared, pointInCorridor, pointInRoom } from "../../src/client/domain/geometry";
import {
  bossKindForRoom,
  bossLootDrops,
  bossSpecForRoom,
  buildDecorations,
  buildInteractiveObjects,
  buildMonsters,
  buildSceneryDrops,
  decorationSpecsForCorridor,
  decorationSpecsForRoom,
  lootCountForRoom,
  monsterSpecsForCorridor,
  monsterSpecsForRoom,
  monsterSpecForBossSummon,
  monsterSpecForSpawner,
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
    expect(layout.links[0]).toMatchObject({ id: "0->1", ownerRoomId: 0, width: CORRIDOR_HALF_WIDTH * 2 });
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

  it("keeps widened doorways and corridor obstacles traversable by monsters", () => {
    const decorations = buildDecorations(layout, new Map(), 1);
    for (const link of layout.links) {
      const path = aStarPath(
        link.source,
        link.target,
        point => {
          const inFloor = layout.nodes.some(room => pointInRoom(point.x, point.y, room, MONSTER_RADIUS)) ||
            layout.links.some(candidate => pointInCorridor(point.x, point.y, candidate, MONSTER_RADIUS));
          const blocked = decorations.some(item =>
            item.obstacle && !item.destroyed && Math.hypot(point.x - item.x, point.y - item.y) < item.radius + MONSTER_RADIUS
          );
          return inFloor && !blocked;
        },
        18,
        6_000,
        {
          minX: Math.min(link.source.x, link.target.x) - 220,
          maxX: Math.max(link.source.x, link.target.x) + 220,
          minY: Math.min(link.source.y, link.target.y) - 220,
          maxY: Math.max(link.source.y, link.target.y) + 220,
        },
      );
      expect(path).not.toBeNull();
    }
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
    expect(decorations.some(item => item.obstacle)).toBe(true);
    expect(decorations.filter(item => item.obstacle).every(item =>
      item.radius + MONSTER_RADIUS < link.width / 2
    )).toBe(true);
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
      expect(pointInRoom(link.points[0]!.x, link.points[0]!.y, link.source, 0)).toBe(true);
      expect(pointInRoom(link.points.at(-1)!.x, link.points.at(-1)!.y, link.target, 0)).toBe(true);
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
    expect(decorations.length).toBeGreaterThanOrEqual(5);
    expect(decorations.length).toBeLessThanOrEqual(7);
    expect(decorations.filter(item => item.obstacle).length).toBeGreaterThanOrEqual(4);
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

  it("turns every script room into a scaled boss arena without removing ambient threats", () => {
    const root = node(0, null, 0);
    const scriptRoom = node(1, 0, 1, {
      tag: "script",
      lootSeed: stableHash("boss-script"),
    });
    const bossLayout = layoutOrthogonal({
      nodes: [root, scriptRoom],
      links: [{ source: 0, target: 1 }],
      originalCount: 2,
      coalescedCount: 0,
      truncated: false,
    }, 1_200, 800);
    const arena = bossLayout.nodes.find(room => room.tag === "script")!;
    expect(arena).toMatchObject({ shape: "octagon", width: 900, height: 650 });

    const floorOne = monsterSpecsForRoom(arena, 1);
    const floorEight = monsterSpecsForRoom(arena, 8);
    expect(floorOne.filter(monster => monster.bossKind)).toHaveLength(1);
    expect(floorOne.filter(monster => !monster.bossKind).length).toBeGreaterThanOrEqual(2);
    expect(floorEight.find(monster => monster.bossKind)!.maxHp).toBeGreaterThan(
      floorOne.find(monster => monster.bossKind)!.maxHp,
    );
    const boss = floorOne.find(monster => monster.bossKind)!;
    const earlyLoot = bossLootDrops(boss, "boss-floor-1", 1);
    const deepLoot = bossLootDrops(boss, "boss-floor-10", 10);
    expect(earlyLoot).toHaveLength(8);
    expect(deepLoot.length).toBeGreaterThan(earlyLoot.length);
    expect(earlyLoot[0]?.kind).toBe("medkit");
    expect(earlyLoot.some(item => item.kind === "core")).toBe(true);
    expect(new Set(earlyLoot.map(item => item.id)).size).toBe(earlyLoot.length);

    const sampledScripts = Array.from({ length: 200 }, (_, index) => node(index + 3_000, 0, 1, {
      tag: "script",
      lootSeed: stableHash(`boss-kind-${index}`),
      isRoot: false,
    }));
    expect(new Set(sampledScripts.map(bossKindForRoom))).toEqual(
      new Set(["packet-storm", "fork-bomb", "heap-titan"]),
    );
    const rosterRoot = node(5_000, null, 0, { lootSeed: stableHash("boss-roster-root") });
    const rosterScripts = Array.from({ length: 6 }, (_, index) => node(5_001 + index, rosterRoot.id, 1, {
      tag: "script",
      lootSeed: stableHash(`roster-script-${index}`),
      isRoot: false,
      x: index * 1_000,
    }));
    const roster = buildMonsters(
      { nodes: [rosterRoot, ...rosterScripts], links: [], hiddenCount: 0 },
      new Map(),
      new Set(),
      1,
    ).filter(monster => monster.bossKind);
    expect(new Set(roster.map(monster => monster.bossKind))).toEqual(
      new Set(["packet-storm", "fork-bomb", "heap-titan"]),
    );
    expect(roster.map(monster => monster.bossKind).slice(0, 3)).toEqual(
      roster.map(monster => monster.bossKind).slice(3, 6),
    );
    expect(sampledScripts.some(room => decorationSpecsForRoom(room, 10).some(item => item.spawner))).toBe(true);
  });

  it("reconstructs deterministic Fork Bomb summons from boss state", () => {
    const scriptRooms = Array.from({ length: 100 }, (_, index) => node(index + 4_000, 0, 1, {
      tag: "script",
      lootSeed: stableHash(`summoner-boss-${index}`),
      isRoot: false,
      x: 500,
      y: 400,
    }));
    const room = scriptRooms.find(candidate => bossKindForRoom(candidate) === "fork-bomb")!;
    const boss = bossSpecForRoom(room, 6);
    const firstSummon = monsterSpecForBossSummon(boss, 6, 0);
    expect(firstSummon).toEqual(monsterSpecForBossSummon(boss, 6, 0));
    const monsters = buildMonsters(
      { nodes: [room], links: [], hiddenCount: 0 },
      new Map([[
        boss.id,
        {
          x: boss.x,
          y: boss.y,
          roomId: room.id,
          hp: boss.maxHp - 5,
          dead: false,
          active: true,
          droppedLoot: false,
          dropId: null,
          dropX: null,
          dropY: null,
          dropKind: null,
          attackSequence: 3,
          summonedCount: 3,
        },
      ]]),
      new Set([room.id]),
      6,
    );
    expect(monsters.filter(monster => monster.id.startsWith(`${boss.id}::summon-`))).toHaveLength(3);
    expect(monsters.find(monster => monster.id === boss.id)).toMatchObject({
      hp: boss.maxHp - 5,
      attackSequence: 3,
      summonedCount: 3,
    });
  });

  it("adds stronger, persistent monster spawners as floors deepen", () => {
    const combatRooms = Array.from({ length: 500 }, (_, index) => node(index + 2_000, 0, 1, {
      tag: "section",
      isRoot: false,
      lootSeed: stableHash(`spawner-room-${index}`),
    }));
    const floorOneCounts = combatRooms.map(room =>
      decorationSpecsForRoom(room, 1).filter(item => item.spawner).length
    );
    const floorFourCounts = combatRooms.map(room =>
      decorationSpecsForRoom(room, 4).filter(item => item.spawner).length
    );
    const floorSevenCounts = combatRooms.map(room =>
      decorationSpecsForRoom(room, 7).filter(item => item.spawner).length
    );
    const floorTenCounts = combatRooms.map(room =>
      decorationSpecsForRoom(room, 10).filter(item => item.spawner).length
    );
    expect(floorOneCounts.every(count => count >= 0 && count <= 4)).toBe(true);
    expect(floorTenCounts.every(count => count >= 0 && count <= 4)).toBe(true);
    expect(floorOneCounts).toContain(0);
    expect(floorTenCounts).toContain(4);
    expect(floorOneCounts.filter(Boolean).length).toBeLessThan(combatRooms.length / 4);
    const totals = [floorOneCounts, floorFourCounts, floorSevenCounts, floorTenCounts]
      .map(counts => counts.reduce((sum, count) => sum + count, 0));
    expect(totals[1]).toBeGreaterThan(totals[0]!);
    expect(totals[2]).toBeGreaterThan(totals[1]!);
    expect(totals[3]).toBeGreaterThan(totals[2]!);
    expect(floorOneCounts.every((count, index) => count === 0 || floorTenCounts[index]! > 0)).toBe(true);

    const combatRoom = combatRooms.find(room =>
      decorationSpecsForRoom(room, 1).some(item => item.spawner) &&
      decorationSpecsForRoom(room, 10).some(item => item.spawner)
    );
    if (!combatRoom) throw new Error("Expected a room with spawners on both sampled floors");
    const combatLayout = { nodes: [combatRoom], links: [], hiddenCount: 0 };
    const floorOne = decorationSpecsForRoom(combatRoom, 1);
    const floorTen = decorationSpecsForRoom(combatRoom, 10);
    const earlySpawners = floorOne.filter(item => item.spawner);
    const deepSpawners = floorTen.filter(item => item.spawner);

    expect(deepSpawners[0]!.maxHp).toBeGreaterThan(earlySpawners[0]!.maxHp);
    expect(deepSpawners[0]!.spawnLimit).toBeGreaterThan(earlySpawners[0]!.spawnLimit ?? 0);
    expect(deepSpawners[0]!.spawnIntervalMs).toBeLessThan(earlySpawners[0]!.spawnIntervalMs ?? Infinity);

    const spawner = deepSpawners[0]!;
    const restoredDecorations = buildDecorations(combatLayout, new Map([[
      spawner.id,
      { hp: 2, destroyed: false, spawnedCount: 2 },
    ]]), 10);
    const restoredSpawner = restoredDecorations.find(item => item.id === spawner.id)!;
    expect(restoredSpawner).toMatchObject({ hp: 2, spawnedCount: 2 });

    const reinforcement = monsterSpecForSpawner(restoredSpawner, 10, 0);
    const restoredMonsters = buildMonsters(combatLayout, new Map([[
      reinforcement.id,
      {
        x: reinforcement.x + 31,
        y: reinforcement.y - 17,
        roomId: combatRoom.id,
        hp: 1,
        dead: false,
        active: true,
        droppedLoot: false,
        dropId: null,
        dropX: null,
        dropY: null,
        dropKind: null,
      },
    ]]), new Set([combatRoom.id]), 10, restoredDecorations);
    expect(restoredMonsters.find(item => item.id === reinforcement.id)).toMatchObject({
      x: reinforcement.x + 31,
      y: reinforcement.y - 17,
      hp: 1,
      active: true,
    });
  });

  it("namespaces collected loot to a specific floor instance", () => {
    const floorOne = buildInteractiveObjects(layout, "https://example.com/::floor-1", null, new Set());
    const floorTwo = buildInteractiveObjects(layout, "https://example.com/::floor-2", null, new Set());
    expect(floorOne.loot.length).toBeGreaterThan(0);
    expect(floorOne.loot.map(item => item.id)).not.toEqual(floorTwo.loot.map(item => item.id));
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
