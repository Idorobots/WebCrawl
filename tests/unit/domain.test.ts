import { describe, expect, it } from "vitest";
import {
  ASSETS,
  BASE_FLOOR_ASSETS,
  DAMAGED_FLOOR_ASSETS,
  DEBRIS_ASSETS,
  EFFECT_FRAMES,
  ENVIRONMENT_SEGMENT_SIZE,
  FLOOR_ASSETS,
  MONSTER_FRAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  WORLD_SCALE,
  world,
} from "../../src/client/config";
import {
  applyObstacleDamage,
  actorAimDirection,
  actorCollisionCenter,
  actorProjectileOrigin,
  enemyVolleyProjectiles,
  monsterAttackIsReady,
  monsterEngagementRange,
  projectileHitsCircle,
  projectileHitsDecoration,
} from "../../src/client/domain/combat";
import {
  distanceSquared,
  pointInCorridor,
  pointInRoom,
  pointInRoomFloor,
  slideAlongObstacles,
} from "../../src/client/domain/geometry";
import {
  bossKindForRoom,
  bossLootDrops,
  bossSpecForRoom,
  buildDecorations,
  buildInteractiveObjects,
  buildMonsters,
  buildSceneryDrops,
  contentBrowserForRoom,
  decorationSpecsForCorridor,
  decorationSpecsForRoom,
  lootCountForRoom,
  lootPositions,
  monsterSpecsForCorridor,
  monsterSpecsForRoom,
  monsterPositionIsClear,
  monsterSpecForBossSummon,
  monsterSpecForSpawner,
  roomSceneryThemeForRoom,
  staircasePositions,
  weaponLootForRoom,
  weaponPedestalForRoom,
  sceneryDropKindForSeed,
} from "../../src/client/domain/generation";
import { coalesceLeaves, domToGraph } from "../../src/client/domain/graph";
import { stableHash } from "../../src/client/domain/hash";
import { corridorEndpoints, corridorIntersectsRoom, corridorLength, layoutOrthogonal } from "../../src/client/domain/layout";
import { aStarPath, monsterEscapeStep, revealedRoomPath } from "../../src/client/domain/pathfinding";
import { entryPortalFor, initialPlayerPosition, updatePortalContacts } from "../../src/client/domain/portals";
import {
  DECORATION_DEFINITIONS,
  HEAP_TITAN_WAVE,
  MAX_REGULAR_MONSTER_RADIUS,
  MINIBOSS_CHANCE_PERCENT,
  MINIBOSS_DAMAGE_MULTIPLIER,
  MINIBOSS_HP_MULTIPLIER,
  MINIBOSS_SIZE_MULTIPLIER,
  MONSTER_VISUAL_DEFINITIONS,
  MONSTER_WALK_REFERENCE_SPEED,
  monsterHealthBarY,
  monsterWalkElapsed,
  monsterVisualCenterOffsetY,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  REGULAR_MONSTER_DEFINITIONS,
  ROOM_SCENERY_THEMES,
  ROOM_DEFINITIONS,
  WEAPON_VISUAL_DEFINITIONS,
  WORLD_GEOMETRY,
  monsterDisplaySize,
} from "../../src/client/domain/specs";
import {
  DEFAULT_WEAPON,
  MINIBOSS_WEAPON_DROP_CHANCE_PER_10K,
  monsterDropsWeapon,
  projectilesForWeapon,
  REGULAR_MONSTER_WEAPON_DROP_CHANCE_PER_10K,
  replenishWeaponAmmo,
  weaponForMonster,
  weaponForRoom,
  weaponKinds,
} from "../../src/client/domain/weapons";
import type { Decoration, DungeonGraph, GraphNode, LayoutLink, MonsterVisualKind, Point, RegularMonsterKind, SpriteClip, Stair } from "../../src/client/types";

const node = (id: number, parentId: number | null, depth: number, overrides: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId,
  depth,
  tag: "div",
  hrefs: [],
  coalescedCount: 0,
  label: `<div>#${id}`,
  floorLabel: `<div>#${id}`,
  title: "<div>",
  contentHtml: null,
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

  it("keeps more than ten direct DOM children for forked level placement", () => {
    const children = Array.from({ length: 12 }, (_, index) => `<li>Item ${index}</li>`).join("");
    const graph = domToGraph(`<body><ul>${children}</ul></body>`, "https://example.com/start");
    const list = graph.nodes.find(node => node.tag === "ul");
    expect(graph.nodes.filter(node => node.parentId === list?.id)).toHaveLength(12);
  });

  it("includes page url, floor and structural paths in deterministic room seeds", () => {
    const html = "<body><main><div>same</div><div>same</div></main></body>";
    const first = domToGraph(html, "https://example.com/one");
    const second = domToGraph(html, "https://example.net/two");
    const repeat = domToGraph(html, "https://example.com/one");
    const deeper = domToGraph(html, "https://example.com/one", 2);
    expect(first.nodes.map(room => room.lootSeed)).toEqual(repeat.nodes.map(room => room.lootSeed));
    expect(first.nodes.map(room => room.lootSeed)).not.toEqual(second.nodes.map(room => room.lootSeed));
    expect(first.nodes.map(room => room.lootSeed)).not.toEqual(deeper.nodes.map(room => room.lootSeed));
    expect(first.nodes[2]?.lootSeed).not.toBe(first.nodes[3]?.lootSeed);
  });

  it("keeps safe rich room content and floor labels from DOM elements", () => {
    const graph = domToGraph(`
      <body><article id="story" class="feature primary"><h1>Hello</h1><p onclick="bad()">Safe <strong>markup</strong></p><img src="/cover.png" alt="Cover"><script>alert(1)</script><a href="javascript:bad()">Nope</a></article><section class="room-class"><aside>Fallback</aside></section></body>
    `, "https://example.com/page");
    const article = graph.nodes.find(room => room.tag === "article");
    const section = graph.nodes.find(room => room.tag === "section");
    const aside = graph.nodes.find(room => room.tag === "aside");

    expect(article?.floorLabel).toBe("STORY");
    expect(section?.floorLabel).toBe("ROOM-CLASS");
    expect(aside?.floorLabel).toBe("ASIDE");
    expect(article?.contentHtml).toContain("<h1>Hello</h1>");
    expect(article?.contentHtml).toContain('src="https://example.com/cover.png"');
    expect(article?.contentHtml).not.toContain("onclick");
    expect(article?.contentHtml).not.toContain("script");
    expect(article?.contentHtml).not.toContain("javascript:");
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
  const layout = layoutOrthogonal(graph);

  it("scales world definitions from authored dimensions", () => {
    expect(ROOM_DEFINITIONS.rectangle).toEqual({ width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 4 });
    expect(PLAYER_SPEC.radius).toBe(world(36));
    expect(WORLD_GEOMETRY.segmentSize).toBe(world(64) * 2);
    expect(WORLD_GEOMETRY.floorTileSize).toBe(world(64));
    expect(WORLD_GEOMETRY.segmentSize).toBe(WORLD_GEOMETRY.floorTileSize * 2);
  });

  it("reserves damaged floor tiles for sparse flavour instead of base floors", () => {
    const base = new Set<string>(BASE_FLOOR_ASSETS);
    expect(base.size).toBeGreaterThanOrEqual(4);
    expect(base.has(ASSETS.floorRock)).toBe(false);
    expect(base.has(ASSETS.floorHatch)).toBe(false);
    for (const asset of DAMAGED_FLOOR_ASSETS) {
      expect(base.has(asset), `${asset} must not be a base floor`).toBe(false);
      expect(FLOOR_ASSETS).toContain(asset);
    }
    expect(FLOOR_ASSETS).toHaveLength(BASE_FLOOR_ASSETS.length + DAMAGED_FLOOR_ASSETS.length);
  });

  it("aligns visual content with collision centers and normalizes monster animations", () => {
    expect(PLAYER_SPEC.visual.directions.down?.normal.origin).toEqual({ x: 0.5, y: 0.90625 });
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].size).toBe(world(137 * 1.25));
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].size).toBe(world(183 * 1.25));
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].size).toBe(world(185));
    expect(monsterDisplaySize(200, "scout", "melee")).toBe(200);
    expect(monsterDisplaySize(200, "scout", "walk")).toBe(200);
    expect(MONSTER_VISUAL_DEFINITIONS.scout.directions.down?.melee?.origin.y).toBeCloseTo(0.90625);
    expect(PLAYER_SPEC.visualCenterOffsetY).toBeLessThan(0);
    expect(monsterVisualCenterOffsetY(200, "scout")).toBe(-40);
    expect(monsterHealthBarY(200, "scout")).toBeLessThan(-80);
    expect(DECORATION_DEFINITIONS.crateCargo.origin).toEqual({ x: 0.5, y: 0.9375 });
    expect(WEAPON_VISUAL_DEFINITIONS["pulse-rifle"].pedestalYOffset).toBeLessThan(0);
  });

  it("places every room deterministically with owned, routed corridors", () => {
    const originalGraph = structuredClone(graph);
    const repeated = layoutOrthogonal(graph);
    expect(layout.nodes.map(({ id, x, y, shape }) => ({ id, x, y, shape }))).toEqual(
      repeated.nodes.map(({ id, x, y, shape }) => ({ id, x, y, shape })),
    );
    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.hiddenCount).toBe(0);
    expect(graph).toEqual(originalGraph);
    expect(layout.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.links[0]).toMatchObject({ id: "0->1", ownerRoomId: 0, width: WORLD_GEOMETRY.corridorHalfWidth * 2 });
    const endpoints = corridorEndpoints(layout.links[0]!);
    expect(endpoints).toEqual({
      x1: layout.links[0]!.points[0]!.x,
      y1: layout.links[0]!.points[0]!.y,
      x2: layout.links[0]!.points.at(-1)!.x,
      y2: layout.links[0]!.points.at(-1)!.y,
    });
  });

  it("recognizes rooms, corridors, and point distances", () => {
    expect(pointInRoom(0, 0, layout.nodes[0]!)).toBe(true);
    const [start, end] = layout.links[0]!.points;
    expect(pointInCorridor((start!.x + end!.x) / 2, (start!.y + end!.y) / 2, layout.links[0]!)).toBe(true);
    expect(distanceSquared({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(25);
  });

  it("blocks room walls halfway through their segment and admits only the middle of doors", () => {
    const room = layout.nodes[0]!;
    const topWallEdge = room.y - room.height / 2;
    expect(pointInRoomFloor(room.x, topWallEdge, room, 0)).toBe(true);
    expect(pointInRoomFloor(room.x, topWallEdge - 1, room, 0)).toBe(false);
    expect(pointInRoomFloor(room.x, topWallEdge + PLAYER_SPEC.radius, room, PLAYER_SPEC.radius)).toBe(true);
    expect(pointInRoomFloor(room.x, topWallEdge + PLAYER_SPEC.radius - 1, room, PLAYER_SPEC.radius)).toBe(false);
    expect(pointInRoomFloor(room.x + room.width / 2, room.y, room, 0)).toBe(true);
    expect(pointInRoomFloor(room.x, room.y + room.height / 2, room, 0)).toBe(true);
    expect(pointInRoomFloor(room.x + room.width / 2 + 1, room.y, room, 0)).toBe(false);

    const link = layout.links[0]!;
    const start = link.points[0]!;
    const end = link.points[1]!;
    const length = corridorLength(link.points);
    const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const lateral = { x: -unit.y, y: unit.x };
    const insideDoor = start;
    expect(pointInCorridor(insideDoor.x, insideDoor.y, link, 0)).toBe(true);
    expect(pointInCorridor(
      insideDoor.x + lateral.x * (WORLD_GEOMETRY.doorOpeningWidth / 2 + 1),
      insideDoor.y + lateral.y * (WORLD_GEOMETRY.doorOpeningWidth / 2 + 1),
      link,
      0,
    )).toBe(false);
    const playerInsideDoor = {
      x: start.x - unit.x * PLAYER_SPEC.radius / 2,
      y: start.y - unit.y * PLAYER_SPEC.radius / 2,
    };
    expect(pointInCorridor(playerInsideDoor.x, playerInsideDoor.y, link, PLAYER_SPEC.radius)).toBe(true);
    expect(pointInCorridor(
      playerInsideDoor.x + lateral.x * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
      playerInsideDoor.y + lateral.y * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
      link,
      PLAYER_SPEC.radius,
    )).toBe(false);

    // The door's blocked band spans the wall thickness into the corridor:
    // walkable only through the opening, blocked everywhere else.
    const bandHalf = WORLD_GEOMETRY.wallThickness / 2;
    const bandOpening = {
      x: start.x + unit.x * bandHalf,
      y: start.y + unit.y * bandHalf + (start.y === end.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0),
    };
    expect(pointInCorridor(bandOpening.x, bandOpening.y, link, PLAYER_SPEC.radius)).toBe(true);
    const bandEdge = {
      x: bandOpening.x + lateral.x * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
      y: bandOpening.y + lateral.y * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
    };
    expect(pointInCorridor(bandEdge.x, bandEdge.y, link, PLAYER_SPEC.radius), "Expected blocked door band edge").toBe(false);

    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    expect(pointInCorridor(midpoint.x, midpoint.y, link, PLAYER_SPEC.radius)).toBe(true);
    expect(pointInCorridor(
      midpoint.x,
      midpoint.y + link.width / 2 + 1,
      link,
      0,
    )).toBe(false);
    if (start.y === end.y) {
      const topWallEdge = midpoint.y - link.width / 2;
      expect(pointInCorridor(midpoint.x, topWallEdge, link, 0)).toBe(true);
      expect(pointInCorridor(midpoint.x, topWallEdge - 1, link, 0)).toBe(false);
      expect(pointInCorridor(midpoint.x, midpoint.y + link.width / 2, link, 0)).toBe(true);
    } else {
      expect(pointInCorridor(midpoint.x - link.width / 2, midpoint.y, link, 0)).toBe(true);
      expect(pointInCorridor(midpoint.x - link.width / 2 - 1, midpoint.y, link, 0)).toBe(false);
      expect(pointInCorridor(midpoint.x + link.width / 2, midpoint.y, link, 0)).toBe(true);
    }
  });

  it("keeps widened doorways and corridor obstacles traversable by monsters", () => {
    const decorations = buildDecorations(layout, new Map(), 1);
    for (const link of layout.links) {
      const path = aStarPath(
        link.source,
        link.target,
        point => {
          const inFloor = layout.nodes.some(room => pointInRoomFloor(point.x, point.y, room, MAX_REGULAR_MONSTER_RADIUS)) ||
            layout.links.some(candidate => pointInCorridor(point.x, point.y, candidate, MAX_REGULAR_MONSTER_RADIUS));
          const blocked = decorations.some(item =>
            item.obstacle &&
            !item.destroyed &&
            Math.hypot(point.x - item.x, point.y - item.y) < (item.footprint ?? item.radius) + MAX_REGULAR_MONSTER_RADIUS
          );
          return inFloor && !blocked;
        },
        18,
        6_000,
        {
          minX: Math.min(link.source.x, link.target.x) - world(220),
          maxX: Math.max(link.source.x, link.target.x) + world(220),
          minY: Math.min(link.source.y, link.target.y) - world(220),
          maxY: Math.max(link.source.y, link.target.y) + world(220),
        },
      );
      expect(path, `Expected route through ${JSON.stringify(link.points)}`).not.toBeNull();
    }
  });

  it("blocks every door edge across the combined room and corridor floor", () => {
    const onFloor = (point: { x: number; y: number }, radius: number): boolean =>
      layout.nodes.some(room => pointInRoomFloor(point.x, point.y, room, radius)) ||
      layout.links.some(link => pointInCorridor(point.x, point.y, link, radius));

    for (const link of layout.links) {
      const start = link.points[0]!;
      const end = link.points.at(-1)!;
      const length = corridorLength(link.points);
      const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      const lateral = { x: -unit.y, y: unit.x };
      const targetSide = ({ N: "S", E: "W", S: "N", W: "E" } as const)[link.direction];
      const verticalShift = start.y === end.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
      const doors = [
        { boundary: start, inward: { x: -unit.x, y: -unit.y }, side: link.direction },
        { boundary: end, inward: unit, side: targetSide },
      ];
      for (const door of doors) {
        const depth = PLAYER_SPEC.radius;
        const center = {
          x: door.boundary.x + door.inward.x * depth / 2,
          y: door.boundary.y + door.inward.y * depth / 2 + verticalShift,
        };
        const blockedEdge = {
          x: center.x + lateral.x * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
          y: center.y + lateral.y * (WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius + 1),
        };
        expect(onFloor(center, PLAYER_SPEC.radius)).toBe(true);
        expect(onFloor(blockedEdge, PLAYER_SPEC.radius), `Expected blocked ${door.side} door edge`).toBe(false);
      }
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
    expect(decorations.every(item => !item.obstacle && item.footprint === 0)).toBe(true);
    expect(monsters).toEqual(monsterSpecsForCorridor(link, 3));
    expect(monsters).toEqual([]);
    expect(decorations.every(item => item.roomId === link.source.id)).toBe(true);
    expect(monsters.every(item => item.spawnRoomId === link.source.id)).toBe(true);
  });

  it("routes up to eight siblings through one shared fork corridor", () => {
    const nodes = [
      node(0, null, 0),
      ...Array.from({ length: 8 }, (_, index) => node(index + 1, 0, 1)),
    ];
    const forkLayout = layoutOrthogonal({
      nodes,
      links: [],
      originalCount: nodes.length,
      coalescedCount: 0,
      truncated: false,
    });

    expect(forkLayout.nodes).toHaveLength(nodes.length);
    expect(forkLayout.hiddenCount).toBe(0);
    expect(forkLayout.links).toHaveLength(8);
    expect(new Set(forkLayout.links.map(link => link.forkId)).size).toBe(1);
    expect(new Set(forkLayout.links.map(link => JSON.stringify(link.points[0]))).size).toBe(1);
    expect(new Set(forkLayout.links.map(link => `${link.points[1]!.x}:${link.points[1]!.y}`)).size).toBe(4);
    for (const link of forkLayout.links) {
      expect(link.points).toHaveLength(3);
      expect(link.forkPointIndex).toBe(1);
      expect(link.targetDirection).toBeDefined();
      expect(corridorLength(link.points) % WORLD_GEOMETRY.segmentSize).toBe(0);
      for (const room of forkLayout.nodes) {
        if (room.id === link.source.id || room.id === link.target.id) continue;
        expect(corridorIntersectsRoom(link, room)).toBe(false);
      }
    }
    const forkLink = forkLayout.links[0]!;
    const forkPoint = forkLink.points[forkLink.forkPointIndex!]!;
    expect(pointInCorridor(forkPoint.x, forkPoint.y, forkLink, PLAYER_SPEC.radius)).toBe(true);
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

  it("sidesteps monsters away from blocked forward movement", () => {
    const escaped = monsterEscapeStep(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      12,
      point => point.y > 0,
      0,
    );
    expect(escaped?.x ?? Infinity).toBeCloseTo(0);
    expect(escaped?.y).toBeCloseTo(12);
  });

  it("projects diagonal movement along obstacle surfaces without entering them", () => {
    const obstacle = { x: 0, y: 0, radius: 10 };
    const slid = slideAlongObstacles(
      { x: -20, y: 0 },
      { x: 10, y: 8 },
      5,
      [obstacle],
      point => Math.hypot(point.x, point.y) >= 15,
    );
    expect(slid).not.toBeNull();
    expect(slid!.y).toBeGreaterThan(0);
    expect(Math.hypot(slid!.x, slid!.y)).toBeGreaterThanOrEqual(15);
    expect(slideAlongObstacles(
      { x: -20, y: 0 },
      { x: 10, y: 0 },
      5,
      [obstacle],
      point => Math.hypot(point.x, point.y) >= 15,
    )).toBeNull();
  });
});

describe("portal entry", () => {
  const portal: Stair = {
    id: "room-1::portal-down-0",
    type: "down",
    roomId: 1,
    url: "https://example.com/next",
    enabled: true,
    x: 100,
    y: 100,
  };

  it("requires leaving a portal occupied at spawn before it can activate", () => {
    const contacts = new Set<string>();
    updatePortalContacts([portal], portal, 56, contacts);
    expect(updatePortalContacts([portal], portal, 56, contacts)).toBeNull();
    expect(updatePortalContacts([portal], { x: 200, y: 100 }, 56, contacts)).toBeNull();
    expect(updatePortalContacts([portal], portal, 56, contacts)).toEqual(portal);
  });

  it("uses the portal energy ring rather than the low sprite anchor", () => {
    const contacts = new Set<string>();
    const { contactOffset, contactRadius, spawnOffset } = PORTAL_DEFINITION;
    expect(updatePortalContacts(
      [portal],
      { x: portal.x + contactOffset.x, y: portal.y + contactOffset.y },
      contactRadius,
      contacts,
      contactOffset,
    )).toEqual(portal);
    contacts.clear();
    expect(updatePortalContacts(
      [portal],
      { x: portal.x + spawnOffset.x, y: portal.y + spawnOffset.y },
      contactRadius,
      contacts,
      contactOffset,
    )).toBeNull();
  });

  it("selects the entry portal by explicit url, then the up portal, then the first room stair", () => {
    const up: Stair = { ...portal, id: "room-1::portal-up-0", type: "up", url: null };
    const matchingDown: Stair = { ...portal, id: "room-1::portal-down-1" };
    expect(entryPortalFor([up, matchingDown], "https://example.com/next")).toEqual(matchingDown);
    expect(entryPortalFor([up, matchingDown], null)).toEqual(up);
    expect(entryPortalFor([matchingDown], null)).toEqual(matchingDown);
    expect(entryPortalFor([], null)).toBeNull();
  });

  it("places the player in front of the portal when spawning", () => {
    const { spawnOffset } = PORTAL_DEFINITION;
    expect(spawnOffset.y).toBeGreaterThan(0);
    expect(initialPlayerPosition(portal, { x: 500, y: 500 })).toEqual({
      x: portal.x + spawnOffset.x,
      y: portal.y + spawnOffset.y,
    });
    expect(initialPlayerPosition(null, { x: 500, y: 500 })).toEqual({ x: 500, y: 500 });
  });
});

describe("monster animation pacing", () => {
  const walk: SpriteClip = {
    frames: ["a", "b", "c", "d"],
    frameDurationMs: 125,
    sizeScale: 1,
    origin: { x: 0.5, y: 0.90625 },
    loop: true,
  };

  it("offsets walk cycles per monster seed so equally fast enemies desynchronize", () => {
    const first = monsterWalkElapsed(walk, 1_000, 1, world(120));
    const second = monsterWalkElapsed(walk, 1_000, 2, world(120));
    expect(first).not.toBe(second);
    expect(monsterWalkElapsed(walk, 1_000, 1, world(120))).toBe(first);
  });

  it("scales walk playback rate with monster speed and clamps extremes", () => {
    expect(MONSTER_WALK_REFERENCE_SPEED).toBe(world(120));
    expect(monsterWalkElapsed(walk, 1_000, 0, 0)).toBe(500);
    expect(monsterWalkElapsed(walk, 1_000, 0, world(600))).toBe(2_000);
    expect(monsterWalkElapsed(walk, 1_000, 0, world(120))).toBe(1_000);
    expect(monsterWalkElapsed(walk, 1_000, 0, world(60))).toBe(500);
  });
});

describe("health bar geometry", () => {
  it("raises boss bars above the sprite body and keeps tuned regular bar positions", () => {
    for (const kind of ["boss-arc", "boss-missile", "boss-fortress", "boss-laser", "boss-siege"] as MonsterVisualKind[]) {
      expect(MONSTER_VISUAL_DEFINITIONS[kind].healthBarHeight, kind).toBeCloseTo(0.84375, 5);
    }
    expect(MONSTER_VISUAL_DEFINITIONS.scout.healthBarHeight).toBe(0.42);
    expect(MONSTER_VISUAL_DEFINITIONS.heavy.healthBarHeight).toBe(0.42);
    expect(monsterHealthBarY(400, "boss-arc")).toBeCloseTo(-400 * 0.84375 - world(8), 5);
    expect(monsterHealthBarY(200, "scout")).toBeLessThan(-80);
  });

  it("aligns decoration bars with measured sprite content", () => {
    expect(DECORATION_DEFINITIONS.spawner.healthBarTop).toBeCloseTo(0.5273, 2);
    expect(DECORATION_DEFINITIONS.barricade.healthBarTop).toBeCloseTo(0.5508, 2);
    expect(DECORATION_DEFINITIONS.terminal.healthBarTop).toBeUndefined();
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

  it("uses deterministic configurable themes and keeps neighboring scenery separated", () => {
    const themedRooms = Array.from({ length: 600 }, (_, index) => node(index + 10_000, 0, 1, {
      isRoot: false,
      tag: "img",
      lootSeed: stableHash(`themed-room-${index}`),
    }));
    const labRooms = themedRooms.filter(candidate => roomSceneryThemeForRoom(candidate) === "lab");
    const labDecorations = labRooms.flatMap(candidate => decorationSpecsForRoom(candidate));
    const medicalCrates = labDecorations.filter(item => item.definitionId === "crate-medical").length;
    expect(roomSceneryThemeForRoom(labRooms[0]!)).toBe(roomSceneryThemeForRoom(labRooms[0]!));
    expect(ROOM_SCENERY_THEMES.lab.primary.find(entry =>
      entry.definition.definitionId === "crate-medical"
    )?.weight).toBe(6);
    expect(medicalCrates).toBeGreaterThan(labDecorations.filter(item =>
      item.definitionId === "crate-cargo"
    ).length);

    for (const candidate of themedRooms.slice(0, 100)) {
      const decorations = decorationSpecsForRoom(candidate, 10);
      for (const [index, item] of decorations.entries()) {
        for (const other of decorations.slice(index + 1)) {
          const minimum = Math.max(world(10), item.footprint ?? 0) +
            Math.max(world(10), other.footprint ?? 0) + world(8);
          expect(Math.hypot(item.x - other.x, item.y - other.y)).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  it("relocates generated monsters away from obstacle footprints", () => {
    const combatRoom = node(9, 0, 1, {
      x: 500,
      y: 400,
      tag: "section",
      isRoot: false,
      lootSeed: stableHash("blocked-monster-room"),
    });
    const combatLayout = { nodes: [combatRoom], links: [], hiddenCount: 0 };
    const original = monsterSpecsForRoom(combatRoom, 1)[0]!;
    const blocker = {
      ...DECORATION_DEFINITIONS.crateCargo,
      id: "spawn-blocker",
      roomId: combatRoom.id,
      x: original.x,
      y: original.y,
      maxHp: 10,
      hp: 10,
      destroyed: false,
      dropKind: null,
    };
    const monsters = buildMonsters(combatLayout, new Map(), new Set(), 1, [blocker]);
    const relocated = monsters.find(monster => monster.id === original.id)!;
    expect(relocated).toBeDefined();
    expect(relocated).not.toMatchObject({ x: original.x, y: original.y });
    expect(monsterPositionIsClear(relocated, relocated.radius, combatLayout, [blocker])).toBe(true);
  });

  it("scatters generated monsters and loot so no two items share the same space", () => {
    const rooms = Array.from({ length: 40 }, (_, index) => node(index + 30_000, 0, 1, {
      tag: index % 4 === 3 ? "img" : "section",
      isRoot: false,
      x: index * ROOM_WIDTH * 2,
      y: (index % 5) * ROOM_HEIGHT * 2,
      lootSeed: stableHash(`scatter-room-${index}`),
    }));
    const layout = { nodes: rooms, links: [], hiddenCount: 0 };
    const decorations = rooms.flatMap(room => decorationSpecsForRoom(room, 5));
    const monsters = buildMonsters(layout, new Map(), new Set(), 5, decorations);
    const group = [...monsters, ...decorations];
    for (const [index, item] of group.entries()) {
      for (const other of group.slice(index + 1)) {
        if (item.roomId !== other.roomId) continue;
        const itemIsDecoration = "footprint" in item;
        const otherIsDecoration = "footprint" in other;
        // Monsters only keep their distance from obstacle scenery; non-obstacle
        // low scenery is intentionally walkable. Decoration pairs always separate.
        if (itemIsDecoration !== otherIsDecoration) {
          const decoration = itemIsDecoration ? item : other;
          if (!(decoration as Decoration).obstacle) continue;
        }
        const minimum = ("footprint" in item ? item.footprint ?? item.radius : item.radius) +
          ("footprint" in other ? other.footprint ?? other.radius : other.radius);
        expect(Math.hypot(item.x - other.x, item.y - other.y), `${item.id} vs ${other.id}`)
          .toBeGreaterThanOrEqual(minimum);
      }
    }
    for (const room of rooms) {
      const positions = lootPositions(room, lootCountForRoom(room));
      for (const [index, position] of positions.entries()) {
        for (const other of positions.slice(index + 1)) {
          expect(Math.hypot(position.x - other.x, position.y - other.y))
            .toBeGreaterThanOrEqual(world(66));
        }
      }
    }
  });

  it("creates rich image-room loot and capped stairs", () => {
    const generated = buildInteractiveObjects(layout, "https://example.com/", null, new Set());
    expect(lootCountForRoom(room)).toBeGreaterThanOrEqual(3);
    expect(lootCountForRoom(room)).toBeLessThanOrEqual(7);
    expect(generated.loot.filter(item => item.kind !== "weapon")).toHaveLength(lootCountForRoom(room));
    expect(generated.stairs.map(({ url }) => url)).toEqual(room.hrefs);
    expect(new Set(generated.stairs.map(({ id }) => id)).size).toBe(generated.stairs.length);
  });

  it("caps dense portal grids at eight and fits them to each room width", () => {
    const tallRoom = node(8, 0, 1, {
      width: Math.round(460 * WORLD_SCALE),
      height: Math.round(560 * WORLD_SCALE),
      shape: "tall",
    });
    const positions = staircasePositions(tallRoom, 10);
    const distances = positions.flatMap((position, index) =>
      positions.slice(index + 1).map(other => Math.hypot(position.x - other.x, position.y - other.y))
    );
    expect(positions).toHaveLength(8);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(Math.round(100 * WORLD_SCALE));
  });

  it("limits every room to eight total portals", () => {
    const hrefs = Array.from({ length: 12 }, (_, index) => `https://example.com/${index}`);
    const rootRoom = node(80, null, 0, { hrefs });
    const childRoom = node(81, 80, 1, { hrefs, isRoot: false });
    const generated = buildInteractiveObjects(
      { nodes: [rootRoom, childRoom], links: [], hiddenCount: 0 },
      "https://example.com/::floor-2",
      "https://example.com/previous",
      new Set(),
    );
    const rootPortals = generated.stairs.filter(stair => stair.roomId === rootRoom.id);
    const childPortals = generated.stairs.filter(stair => stair.roomId === childRoom.id);

    expect(rootPortals).toHaveLength(8);
    expect(rootPortals.filter(stair => stair.type === "up")).toHaveLength(1);
    expect(rootPortals.filter(stair => stair.type === "down")).toHaveLength(7);
    expect(childPortals).toHaveLength(8);
    expect(childPortals.every(stair => stair.type === "down")).toBe(true);
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

  it("scales room populations with room size at a constant density", () => {
    const standard = node(0, null, 0, {
      tag: "section",
      lootSeed: stableHash("density-room"),
      isRoot: false,
    });
    const large = node(1, null, 0, {
      tag: "section",
      lootSeed: stableHash("density-room"),
      isRoot: false,
      width: ROOM_WIDTH * 2,
      height: ROOM_HEIGHT,
    });
    const huge = node(2, null, 0, {
      tag: "section",
      lootSeed: stableHash("density-room"),
      isRoot: false,
      width: ROOM_WIDTH * 2,
      height: ROOM_HEIGHT * 2,
    });

    for (const floor of [1, 5]) {
      const monsterCounts = [standard, large, huge].map(room => monsterSpecsForRoom(room, floor).length);
      const decorationCounts = [standard, large, huge].map(room => decorationSpecsForRoom(room, floor).length);
      expect(monsterCounts[1]!).toBeGreaterThan(monsterCounts[0]!);
      expect(monsterCounts[2]!).toBeGreaterThan(monsterCounts[1]!);
      expect(decorationCounts[1]!).toBeGreaterThan(decorationCounts[0]!);
      expect(decorationCounts[2]!).toBeGreaterThan(decorationCounts[1]!);
    }
  });

  it("hosts fewer enemies per segment in boss arenas but scenery as usual", () => {
    const section = node(0, null, 0, {
      tag: "section",
      lootSeed: stableHash("arena-density"),
      isRoot: false,
      width: ROOM_DEFINITIONS.boss.width,
      height: ROOM_DEFINITIONS.boss.height,
    });
    const script = node(1, null, 0, {
      tag: "script",
      lootSeed: stableHash("arena-density"),
      isRoot: false,
      width: ROOM_DEFINITIONS.boss.width,
      height: ROOM_DEFINITIONS.boss.height,
    });

    const sectionRegular = monsterSpecsForRoom(section, 1).length;
    const arena = monsterSpecsForRoom(script, 1);
    const arenaRegular = arena.filter(monster => !monster.bossKind).length;
    expect(arena).toHaveLength(arenaRegular + 1);
    expect(arenaRegular / sectionRegular).toBeGreaterThanOrEqual(0.25);
    expect(arenaRegular / sectionRegular).toBeLessThanOrEqual(0.4);
    const sceneryFor = (room: GraphNode) => decorationSpecsForRoom(room, 1)
      .map(item => ({ kind: item.kind, obstacle: item.obstacle, destructible: item.destructible, origin: item.origin }));
    expect(sceneryFor(script)).toEqual(sceneryFor(section));
  });

  it("never spawns enemies in corridors", () => {
    const source = node(0, null, 0, { isRoot: false });
    const target = node(1, 0, 1);
    const corridor = (length: number, id: string): LayoutLink => ({
      id,
      source,
      target,
      direction: "S",
      ownerRoomId: source.id,
      width: WORLD_GEOMETRY.corridorHalfWidth * 2,
      points: [{ x: 0, y: 0 }, { x: 0, y: length * ENVIRONMENT_SEGMENT_SIZE }],
    });

    const shortLink = corridor(4, "short");
    const longLink = corridor(12, "long");
    expect(monsterSpecsForCorridor(shortLink, 1)).toEqual([]);
    expect(monsterSpecsForCorridor(longLink, 1)).toEqual([]);
    expect(decorationSpecsForCorridor(shortLink, 1).length).toBeLessThan(decorationSpecsForCorridor(longLink, 1).length);
  });

  it("scales monster stats and includes sentries on deeper floors", () => {
    const rooms = Array.from({ length: 200 }, (_, index) => node(index + 1200, 0, 1, {
      tag: "article",
      lootSeed: stableHash(`depth-room-${index}`),
      isRoot: false,
    }));
    const floorOne = rooms.flatMap(room => monsterSpecsForRoom(room, 1));
    const floorSeven = rooms.flatMap(room => monsterSpecsForRoom(room, 7));

    const earlyCombatant = floorOne.find(monster => monster.speed > 0 && !monster.miniboss);
    const deepCombatant = floorSeven.find(monster => monster.kind === earlyCombatant?.kind && !monster.miniboss);
    expect(earlyCombatant).toBeDefined();
    expect(deepCombatant).toBeDefined();
    expect((deepCombatant?.maxHp ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.maxHp ?? 0);
    expect((deepCombatant?.speed ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.speed ?? 0);
    expect((deepCombatant?.attackDamage ?? 0)).toBeGreaterThanOrEqual(earlyCombatant?.attackDamage ?? 0);

    const sentry = floorSeven.find(monster => monster.kind.startsWith("sentry-") && !monster.miniboss);
    expect(sentry).toBeDefined();
    expect(sentry?.speed).toBe(0);
    expect(sentry?.projectileSpeed ?? 0).toBeGreaterThan(0);
    expect(sentry?.projectileRange ?? 0).toBeGreaterThan(0);
    const scout = floorSeven.find(monster => monster.fast && !monster.miniboss);
    const heavy = floorSeven.find(monster => monster.kind.endsWith("heavy") && monster.speed > 0 && !monster.miniboss);
    expect(scout).toBeDefined();
    expect(heavy).toBeDefined();
    expect(scout!.size).toBeLessThan(heavy!.size);
    expect(scout!.radius).toBeLessThan(heavy!.radius);
  });

  it("generates all seven deterministic archetypes with distinct combat roles", () => {
    const rooms = Array.from({ length: 600 }, (_, index) => node(index + 10_000, 0, 1, {
      tag: "article",
      lootSeed: stableHash(`archetype-room-${index}`),
      isRoot: false,
    }));
    const monsters = rooms.flatMap(room => monsterSpecsForRoom(room, 4));
    const expectedKinds = new Set<RegularMonsterKind>([
      "melee-heavy",
      "melee-light",
      "shooter-light",
      "shooter-heavy",
      "sentry-light",
      "sentry-heavy",
      "sentry-scatter",
    ]);

    expect(new Set(monsters.map(monster => monster.kind))).toEqual(expectedKinds);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].baseHp)
      .toBeGreaterThan(REGULAR_MONSTER_DEFINITIONS["melee-light"].baseHp);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].attackDamage)
      .toBeGreaterThan(REGULAR_MONSTER_DEFINITIONS["melee-light"].attackDamage);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].speed)
      .toBeLessThan(REGULAR_MONSTER_DEFINITIONS["melee-light"].speed);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].projectileSpeed).toBe(0);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].projectileSpeed).toBe(0);
    expect(REGULAR_MONSTER_DEFINITIONS["shooter-light"].attackCooldownMs)
      .toBeLessThan(REGULAR_MONSTER_DEFINITIONS["shooter-heavy"].attackCooldownMs);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"]).toMatchObject({ speed: 0, attackPattern: "single" });
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-heavy"]).toMatchObject({ speed: 0, attackPattern: "double" });
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-scatter"]).toMatchObject({ speed: 0, attackPattern: "scatter" });
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-heavy"].attackCooldownMs)
      .toBeGreaterThan(REGULAR_MONSTER_DEFINITIONS["shooter-light"].attackCooldownMs);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].attackCooldownMs)
      .toBe(400);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].attackCooldownMs)
      .toBeLessThan(REGULAR_MONSTER_DEFINITIONS["sentry-heavy"].attackCooldownMs);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-scatter"].attackCooldownMs)
      .toBeGreaterThan(REGULAR_MONSTER_DEFINITIONS["sentry-heavy"].attackCooldownMs);
    expect(monsterEngagementRange(REGULAR_MONSTER_DEFINITIONS["sentry-light"]))
      .toBe(REGULAR_MONSTER_DEFINITIONS["sentry-light"].projectileRange);
    expect(monsterEngagementRange(REGULAR_MONSTER_DEFINITIONS["shooter-light"]))
      .toBe(REGULAR_MONSTER_DEFINITIONS["shooter-light"].attackRange);
    const lightSentry = monsters.find(monster => monster.kind === "sentry-light")!;
    lightSentry.attackKind = "ranged";
    lightSentry.lastAttackAt = 1_000;
    expect(lightSentry.attackCooldownMs).toBe(400);
    expect(lightSentry.visual.directions.down?.ranged?.frameDurationMs).toBe(125);
    expect(monsterAttackIsReady(lightSentry, 1_399)).toBe(false);
    expect(monsterAttackIsReady(lightSentry, 1_400)).toBe(true);
    lightSentry.attackWarmupUntil = 1_450;
    expect(monsterAttackIsReady(lightSentry, 1_449)).toBe(false);
    expect(monsterAttackIsReady(lightSentry, 1_450)).toBe(true);
    delete lightSentry.attackWarmupUntil;
    expect(monsterAttackIsReady(lightSentry, 1_400)).toBe(true);
  });

  it("promotes at most one room enemy to a rare deterministic miniboss", () => {
    const rooms = Array.from({ length: 4_000 }, (_, index) => node(index + 20_000, 0, 1, {
      tag: "section",
      lootSeed: stableHash(`miniboss-room-${index}`),
      isRoot: false,
    }));
    const generated = rooms.map(room => monsterSpecsForRoom(room, 3));
    const repeated = rooms.map(room => monsterSpecsForRoom(room, 3));
    const minibosses = generated.flatMap(monsters => monsters.filter(monster => monster.miniboss));
    const minibossRoomRate = generated.filter(monsters => monsters.some(monster => monster.miniboss)).length / rooms.length;

    expect(repeated).toEqual(generated);
    expect(generated.every(monsters => monsters.filter(monster => monster.miniboss).length <= 1)).toBe(true);
    expect(minibossRoomRate).toBeGreaterThan((MINIBOSS_CHANCE_PERCENT - 2) / 100);
    expect(minibossRoomRate).toBeLessThan((MINIBOSS_CHANCE_PERCENT + 2) / 100);
    expect(new Set(minibosses.map(monster => monster.kind))).toEqual(
      new Set(Object.keys(REGULAR_MONSTER_DEFINITIONS)),
    );
    for (const miniboss of minibosses) {
      const definition = REGULAR_MONSTER_DEFINITIONS[miniboss.kind as RegularMonsterKind];
      expect(miniboss.size).toBeCloseTo(definition.size * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.radius).toBe(definition.radius);
      expect(miniboss.maxHp).toBeGreaterThanOrEqual(definition.baseHp * MINIBOSS_HP_MULTIPLIER);
      expect(miniboss.attackDamage).toBeGreaterThanOrEqual(
        Math.ceil(definition.attackDamage * MINIBOSS_DAMAGE_MULTIPLIER),
      );
      expect(miniboss.attackPattern).toBe(definition.attackPattern);
    }
  });

  it("guarantees a deterministic miniboss when every room misses its rarity roll", () => {
    const rooms = Array.from({ length: 200 }, (_, index) => node(index + 30_000, 0, 1, {
      tag: "section",
      lootSeed: stableHash(`miniboss-fallback-room-${index}`),
      isRoot: false,
      x: index * ROOM_WIDTH * 2,
    }))
      .filter(room => monsterSpecsForRoom(room, 3).every(monster => !monster.miniboss))
      .slice(0, 6);
    expect(rooms).toHaveLength(6);

    const layout = { nodes: rooms, links: [], hiddenCount: 0 };
    const generated = buildMonsters(layout, new Map(), new Set(), 3);
    const reordered = buildMonsters(
      { ...layout, nodes: [...rooms].reverse() },
      new Map(),
      new Set(),
      3,
    );
    const minibosses = generated.filter(monster => monster.miniboss);
    const reorderedMinibosses = reordered.filter(monster => monster.miniboss);

    expect(minibosses).toHaveLength(1);
    expect(reorderedMinibosses).toHaveLength(1);
    expect(reorderedMinibosses[0]?.id).toBe(minibosses[0]?.id);
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
    });
    const arena = bossLayout.nodes.find(room => room.tag === "script")!;
    expect(arena).toMatchObject({
      shape: "rectangle",
      width: ROOM_DEFINITIONS.boss.width,
      height: ROOM_DEFINITIONS.boss.height,
    });

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
    expect(earlyLoot[1]?.kind).toBe("weapon");
    expect(earlyLoot[1]?.weapon?.maxAmmo).not.toBeNull();
    expect(earlyLoot[1]?.weaponPlacement).toBe("floor");
    expect(earlyLoot.some(item => item.kind === "core")).toBe(true);
    expect(new Set(earlyLoot.map(item => item.id)).size).toBe(earlyLoot.length);

    const heapTitan = bossSpecForRoom(arena, 1, "heap-titan");
    expect(heapTitan.maxHp).toBeGreaterThan(150);
    expect(heapTitan.projectileRange).toBeGreaterThanOrEqual(world(780));
    expect(HEAP_TITAN_WAVE.initialDelayMs).toBeLessThan(2_000);
    expect(HEAP_TITAN_WAVE.baseIntervalMs).toBeLessThan(3_000);
    expect(HEAP_TITAN_WAVE.bulletCount).toBeGreaterThanOrEqual(12);
    expect(HEAP_TITAN_WAVE.enragedBulletCount).toBeGreaterThan(HEAP_TITAN_WAVE.bulletCount);

    const sampledScripts = Array.from({ length: 200 }, (_, index) => node(index + 3_000, 0, 1, {
      tag: "script",
      lootSeed: stableHash(`boss-kind-${index}`),
      isRoot: false,
    }));
    expect(new Set(sampledScripts.map(bossKindForRoom))).toEqual(
      new Set(["packet-storm", "fork-bomb", "heap-titan", "kimi-swarm", "llama-herd"]),
    );
    const rosterRoot = node(5_000, null, 0, { lootSeed: stableHash("boss-roster-root") });
    const rosterScripts = Array.from({ length: 20 }, (_, index) => node(5_001 + index, rosterRoot.id, 1, {
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
      new Set(["packet-storm", "fork-bomb", "heap-titan", "kimi-swarm", "llama-herd"]),
    );
    const reorderedRoster = buildMonsters(
      { nodes: [rosterRoot, ...rosterScripts].reverse(), links: [], hiddenCount: 0 },
      new Map(),
      new Set(),
      1,
    ).filter(monster => monster.bossKind);
    expect(new Map(reorderedRoster.map(monster => [monster.id, monster.bossKind]))).toEqual(
      new Map(roster.map(monster => [monster.id, monster.bossKind])),
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

  it("preserves boss positions after they pursue the player out of their arena", () => {
    const room = node(6_000, null, 0, {
      parentId: 0,
      isRoot: false,
      tag: "script",
      x: 250,
      y: -150,
      width: ROOM_DEFINITIONS.boss.width,
      height: ROOM_DEFINITIONS.boss.height,
      lootSeed: stableHash("confined-boss"),
    });
    const boss = bossSpecForRoom(room, 4);
    const destination = node(999, room.id, 1, {
      x: room.x + room.width + world(300),
      y: room.y,
      width: ROOM_DEFINITIONS.rectangle.width,
      height: ROOM_DEFINITIONS.rectangle.height,
      isRoot: false,
    });
    const restored = buildMonsters(
      { nodes: [room, destination], links: [], hiddenCount: 0 },
      new Map([[
        boss.id,
        {
          x: destination.x,
          y: destination.y,
          roomId: 999,
          hp: boss.maxHp,
          dead: false,
          active: true,
          droppedLoot: false,
          dropId: null,
          dropX: null,
          dropY: null,
          dropKind: null,
        },
      ]]),
      new Set([room.id]),
      4,
    ).find(monster => monster.id === boss.id)!;

    expect(restored.roomId).toBe(999);
    expect(restored.x).toBe(destination.x);
    expect(restored.y).toBe(destination.y);
    expect(pointInRoom(restored.x, restored.y, room, restored.radius)).toBe(false);
  });

  it("subtracts the projectile's full damage from obstacle HP", () => {
    const obstacle = decorationSpecsForRoom(room).find(item => item.obstacle)!;
    obstacle.hp = 10;
    obstacle.maxHp = 10;
    expect(applyObstacleDamage(obstacle, 3)).toBe(true);
    expect(obstacle).toMatchObject({ hp: 7, destroyed: false });
    expect(applyObstacleDamage(obstacle, 8)).toBe(true);
    expect(obstacle).toMatchObject({ hp: 0, destroyed: true });
  });

  it("centers scenery projectile hitboxes on the visible object", () => {
    const item = {
      ...DECORATION_DEFINITIONS.crateCargo,
      id: "hitbox-crate",
      roomId: room.id,
      x: 100,
      y: 200,
      maxHp: 3,
      hp: 3,
      destroyed: false,
      dropKind: null,
    };
    expect(item.hitOffsetY).toBeLessThan(-item.radius);
    expect(projectileHitsDecoration(item, { x: item.x, y: item.y + item.hitOffsetY }, 1)).toBe(true);
    expect(projectileHitsDecoration(item, { x: item.x, y: item.y }, 1)).toBe(false);
  });

  it("releases actor projectiles from the visual center instead of the floor anchor", () => {
    expect(actorAimDirection(
      { x: 100, y: 200 },
      -50,
      { x: 200, y: 150 },
    )).toEqual({ x: 1, y: 0 });
    expect(actorProjectileOrigin(
      { x: 100, y: 200 },
      { x: 1, y: 0 },
      -50,
      40,
      10,
    )).toEqual({ x: 140, y: 160 });
    expect(actorProjectileOrigin(
      { x: 100, y: 200 },
      { x: 0, y: -1 },
      -50,
      40,
    )).toEqual({ x: 100, y: 110 });
    expect(actorCollisionCenter({ x: 100, y: 200 }, -50)).toEqual({ x: 100, y: 150 });
    expect(projectileHitsCircle({ x: 100, y: 150 }, 30, { x: 100, y: 150 }, 5)).toBe(true);
    expect(projectileHitsCircle({ x: 100, y: 150 }, 30, { x: 100, y: 200 }, 5)).toBe(false);
  });

  it("generates deterministic procedural weapons and exposes all archetypes", () => {
    const hiddenRoom = node(7_000, 0, 1, {
      tag: "section",
      title: "<section> Hidden cache",
      lootSeed: stableHash("hidden-weapon-room"),
      isHidden: true,
      x: 400,
      y: 400,
      isRoot: false,
    });
    const hiddenWeapon = weaponLootForRoom(hiddenRoom, "https://example.com/floor-1");
    expect(hiddenWeapon).not.toBeNull();
    expect(hiddenWeapon?.kind).toBe("weapon");
    expect(hiddenWeapon?.weapon).toEqual(weaponForRoom(hiddenRoom, "hidden"));
    expect(hiddenWeapon?.weaponPlacement).toBe("pedestal");
    expect(hiddenWeapon?.weapon?.maxAmmo ?? 0).toBeGreaterThan(0);
    expect(hiddenWeapon?.weapon?.name).not.toBe(DEFAULT_WEAPON.name);
    expect(weaponPedestalForRoom(hiddenRoom, "https://example.com/floor-1")).toMatchObject({
      id: `${hiddenWeapon?.id}::pedestal`,
      roomId: hiddenRoom.id,
      x: hiddenWeapon?.x,
      y: hiddenWeapon?.y,
      kind: "weapon-pedestal",
      obstacle: false,
    });

    const samples = Array.from({ length: 500 }, (_, index) => node(index + 7_100, 0, 1, {
      tag: index % 3 === 0 ? "section" : index % 3 === 1 ? "article" : "aside",
      title: `<node> Weapon sample ${index}`,
      lootSeed: stableHash(`weapon-sample-${index}`),
      isRoot: false,
    }));
    const kinds = new Set(samples.map(room => weaponForRoom(room).kind));
    expect(kinds).toEqual(new Set(weaponKinds().filter(kind => kind !== "pulse-rifle")));
    expect(samples.some(room => weaponLootForRoom(room, "https://example.com/room") !== null)).toBe(true);
  });

  it("defines directional monster animations and fallbacks where frames are unavailable", () => {
    expect(MONSTER_FRAMES.scout.down.walk).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.up.walk).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.right.walk).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.left.walk).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.up.walk![0]).toBe("assets/enemies/scout/walk/back/frame_01.png");
    expect(MONSTER_FRAMES.scout.right.walk![0]).toBe("assets/enemies/scout/walk/right/frame_01.png");
    expect(MONSTER_FRAMES.scout.left.walk![0]).toBe("assets/enemies/scout/walk/left/frame_01.png");
    expect(MONSTER_FRAMES.scout.down.melee).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.up.ranged).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.right.ranged).toHaveLength(4);
    expect(MONSTER_FRAMES.scout.left.melee).toHaveLength(4);
    expect(MONSTER_FRAMES.sentryBallistic.down.walk).toBeUndefined();
    expect(MONSTER_FRAMES.sentryBallistic.up.normal).toEqual([MONSTER_FRAMES.sentryBallistic.up.ranged![0]]);
    expect(MONSTER_FRAMES.sentryBallistic.down.ranged).toHaveLength(4);
    expect(Object.values(EFFECT_FRAMES).every(frames => frames.length === 4)).toBe(true);
  });

  it("keeps destruction, collision, debris, and spawner visuals as separate concerns", () => {
    const lowProp = {
      ...DECORATION_DEFINITIONS.reagentRack,
      id: "low-prop",
      roomId: room.id,
      x: room.x,
      y: room.y,
      visualVariant: 3,
      maxHp: 2,
      hp: 2,
      destroyed: false,
      dropKind: null,
    };
    expect(lowProp).toMatchObject({ obstacle: false, destructible: true });
    expect(applyObstacleDamage(lowProp, 2)).toBe(true);
    expect(lowProp.destroyed).toBe(true);
    expect(lowProp.visual.destroyed?.length).toBeGreaterThan(0);
    expect(DECORATION_DEFINITIONS.spawner.visual.animations?.spawn).toMatchObject({
      eventFrame: 2,
      holdLast: true,
    });
    expect(DECORATION_DEFINITIONS.spawner.visual.animations?.spawn?.frames).toHaveLength(4);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].projectileSpeed).toBe(0);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].projectileSpeed).toBe(0);
    expect(REGULAR_MONSTER_DEFINITIONS["shooter-heavy"].projectileSpeed).toBeGreaterThan(0);
    expect(REGULAR_MONSTER_DEFINITIONS["shooter-light"].projectileSpeed).toBeGreaterThan(0);
  });

  it("emits single, twin-barrel, and scatter enemy volleys", () => {
    expect(enemyVolleyProjectiles({ x: 1, y: 0 }, "melee", 15)).toEqual([]);
    expect(enemyVolleyProjectiles({ x: 1, y: 0 }, "single", 15)).toEqual([
      { direction: { x: 1, y: 0 }, lateralOffset: 0 },
    ]);
    expect(enemyVolleyProjectiles({ x: 1, y: 0 }, "double", 15)).toEqual([
      { direction: { x: 1, y: 0 }, lateralOffset: -15 },
      { direction: { x: 1, y: 0 }, lateralOffset: 15 },
    ]);
    const scatter = enemyVolleyProjectiles({ x: 1, y: 0 }, "scatter", 15);
    expect(scatter).toHaveLength(5);
    expect(scatter[2]).toEqual({ direction: { x: 1, y: 0 }, lateralOffset: 0 });
    expect(scatter[0]!.direction.y).toBeLessThan(scatter[1]!.direction.y);
    expect(scatter[3]!.direction.y).toBeLessThan(scatter[4]!.direction.y);
    expect(scatter.every(projectile =>
      Math.abs(Math.hypot(projectile.direction.x, projectile.direction.y) - 1) < 0.000_001
    )).toBe(true);
  });

  it("makes regular weapon drops tiny and miniboss weapon drops common", () => {
    const seeds = Array.from({ length: 20_000 }, (_, index) => stableHash(`monster-weapon-${index}`));
    const regularDrops = seeds.filter(seed => monsterDropsWeapon(seed, false));
    const minibossDrops = seeds.filter(seed => monsterDropsWeapon(seed, true));

    expect(REGULAR_MONSTER_WEAPON_DROP_CHANCE_PER_10K).toBe(100);
    expect(MINIBOSS_WEAPON_DROP_CHANCE_PER_10K).toBe(5_000);
    expect(regularDrops.length).toBeGreaterThan(0);
    expect(regularDrops.length / seeds.length).toBeGreaterThan(0.007);
    expect(regularDrops.length / seeds.length).toBeLessThan(0.013);
    expect(minibossDrops.length / seeds.length).toBeGreaterThan(0.47);
    expect(minibossDrops.length / seeds.length).toBeLessThan(0.53);
    expect(regularDrops.every(seed => monsterDropsWeapon(seed, true))).toBe(true);

    const weapon = weaponForMonster("sentry-light", seeds[0]!);
    expect(weapon).toEqual(weaponForMonster("sentry-light", seeds[0]!));
    expect(weapon.maxAmmo).toBeGreaterThan(0);
  });

  it("preserves dropped weapon ammo inside weapon loot payloads", () => {
    const room = node(7_500, 0, 1, {
      tag: "article",
      title: "<article> Weapon carrier",
      lootSeed: stableHash("weapon-carrier-room"),
      isRoot: false,
      isHidden: true,
      x: 300,
      y: 300,
    });
    const weaponLoot = weaponLootForRoom(room, "https://example.com/floor-2");
    expect(weaponLoot?.weapon?.maxAmmo).toBeGreaterThan(0);
    expect(weaponLoot?.weapon?.ammoPerLoot).toBeGreaterThan(0);
    expect(weaponLoot?.weaponAmmo).toBeUndefined();
  });

  it("emits expected projectile patterns and ammo replenishment", () => {
    const room = node(8_000, 0, 1, {
      tag: "main",
      title: "<main> Arsenal",
      lootSeed: stableHash("weapon-pattern-room"),
      isRoot: false,
    });
    const forward = { x: 1, y: 0 };
    const scatter = projectilesForWeapon({
      ...weaponForRoom({ ...room, lootSeed: stableHash("scatter-room") }),
      kind: "scatter-array",
      name: "TEST SCATTER ARRAY",
      projectileSpeed: 440,
      projectileRange: 460,
      projectileRadius: 4,
      damage: 1,
      maxAmmo: 20,
      ammoPerLoot: 3,
    }, forward, 0);
    expect(scatter).toHaveLength(7);
    expect(scatter.some(projectile => projectile.direction.y !== 0)).toBe(true);

    const nova = projectilesForWeapon({
      ...weaponForRoom({ ...room, lootSeed: stableHash("nova-room") }),
      kind: "nova-cache",
      name: "TEST NOVA CACHE",
      projectileSpeed: 420,
      projectileRange: 590,
      projectileRadius: 5,
      damage: 1,
      maxAmmo: 12,
      ammoPerLoot: 2,
    }, forward, 0);
    expect(nova).toHaveLength(8);
    expect(new Set(nova.map(projectile => `${Math.round(projectile.direction.x * 100)},${Math.round(projectile.direction.y * 100)}`)).size).toBe(8);

    const helixBase = {
      ...weaponForRoom({ ...room, lootSeed: stableHash("helix-room") }),
      kind: "helix-emitter" as const,
      name: "TEST HELIX EMITTER",
      maxAmmo: 30,
      ammoPerLoot: 5,
    };
    const helixA = projectilesForWeapon(helixBase, forward, 0);
    const helixB = projectilesForWeapon(helixBase, forward, 1);
    expect(helixA).toHaveLength(2);
    expect(helixB).toHaveLength(2);
    expect(helixA).not.toEqual(helixB);
    expect(replenishWeaponAmmo(helixBase, 10)).toBe(15);
    expect(replenishWeaponAmmo(helixBase, helixBase.maxAmmo)).toBe(helixBase.maxAmmo);
    expect(replenishWeaponAmmo(DEFAULT_WEAPON, null)).toBeNull();
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
    expect(Math.max(...floorTenCounts)).toBeGreaterThan(Math.max(...floorOneCounts));
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
    expect(earlySpawners[0]!.spawnIntervalMs).toBe(30_000);
    expect(deepSpawners[0]!.spawnIntervalMs).toBe(21_000);
    expect(deepSpawners[0]!.spawnIntervalMs).toBeLessThan(earlySpawners[0]!.spawnIntervalMs ?? Infinity);

    const spawner = deepSpawners[0]!;
    const restoredDecorations = buildDecorations(combatLayout, new Map([[
      spawner.id,
      { hp: 2, destroyed: false, spawnedCount: 2 },
    ]]), 10);
    const restoredSpawner = restoredDecorations.find(item => item.id === spawner.id)!;
    expect(restoredSpawner).toMatchObject({ hp: 2, spawnedCount: 2 });

    const reinforcement = monsterSpecForSpawner(restoredSpawner, 10, 0);
    expect(reinforcement).toMatchObject({
      x: restoredSpawner.x,
      y: restoredSpawner.y,
      spawnSourceId: restoredSpawner.id,
    });
    reinforcement.attackKind = "ranged";
    reinforcement.attackCooldownMs = 1;
    reinforcement.lastAttackAt = 1_000;
    expect(monsterAttackIsReady(reinforcement, 1_000)).toBe(false);
    expect(monsterAttackIsReady(reinforcement, 1_001)).toBe(true);
    // Save the reinforcement at a spot that is actually free: placement
    // capacity depends on obstacle layout, but the restored state must be
    // honored wherever it fits.
    const placedBeforeSave = buildMonsters(combatLayout, new Map(), new Set([combatRoom.id]), 10, restoredDecorations)
      .map(item => ({ x: item.x, y: item.y, radius: item.radius }));
    let savedPosition: Point | undefined;
    for (let ring = 0; ring <= 9 && !savedPosition; ring += 1) {
      for (let index = 0; index < 24; index += 1) {
        const angle = index / 24 * Math.PI * 2;
        const position = {
          x: reinforcement.x + Math.cos(angle) * world(45) * ring,
          y: reinforcement.y + Math.sin(angle) * world(45) * ring,
        };
        if (monsterPositionIsClear(position, reinforcement.radius, combatLayout, restoredDecorations, reinforcement.spawnSourceId, placedBeforeSave)) {
          savedPosition = position;
          break;
        }
      }
    }
    expect(savedPosition).toBeDefined();
    const restoredMonsters = buildMonsters(combatLayout, new Map([[
      reinforcement.id,
      {
        x: savedPosition!.x,
        y: savedPosition!.y,
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
    const restoredReinforcement = restoredMonsters.find(item => item.id === reinforcement.id)!;
    expect(restoredReinforcement).toMatchObject({
      hp: 1,
      active: true,
    });
    expect(monsterPositionIsClear(
      restoredReinforcement,
      restoredReinforcement.radius,
      combatLayout,
      restoredDecorations,
      restoredReinforcement.spawnSourceId,
    )).toBe(true);
  });

  it("namespaces collected loot to a specific floor instance", () => {
    const imageRoom = node(9_001, null, 0, {
      x: 500,
      y: 400,
      tag: "img",
      lootSeed: stableHash("img-namespace"),
      isRoot: true,
    });
    const imageLayout = { nodes: [imageRoom], links: [], hiddenCount: 0 };
    const floorOne = buildInteractiveObjects(imageLayout, "https://example.com/::floor-1", null, new Set());
    const floorTwo = buildInteractiveObjects(imageLayout, "https://example.com/::floor-2", null, new Set());
    expect(floorOne.loot.length).toBeGreaterThan(0);
    expect(floorOne.loot.map(item => item.id)).not.toEqual(floorTwo.loot.map(item => item.id));
  });

  it("deterministically gives a moderate share of scenery loot and medkit drops", () => {
    const drops = Array.from({ length: 1_000 }, (_, index) =>
      sceneryDropKindForSeed(stableHash(`scenery-${index}`)),
    ).filter(kind => kind !== null);

    expect(drops.length).toBeGreaterThan(200);
    expect(drops.length).toBeLessThan(400);
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

  it("builds leaf-room content browsers beside portals and drops three to seven RAM sticks", () => {
    const contentRoom = node(9_900, 0, 1, {
      x: 500,
      y: 400,
      contentHtml: "<p>Recovered transmission</p><img src=\"https://example.com/image.png\">",
      lootSeed: stableHash("content-browser"),
    });
    const browser = contentBrowserForRoom(contentRoom);
    if (!browser) throw new Error("Expected a content browser");

    expect(browser).toMatchObject({
      id: `${contentRoom.id}::content-browser`,
      contentPoint: true,
      contentUnlocked: false,
      contentEnabled: false,
      destructible: true,
      obstacle: false,
      dropKind: "credit",
    });
    expect(browser.dropCount).toBeGreaterThanOrEqual(3);
    expect(browser.dropCount).toBeLessThanOrEqual(7);
    expect(DECORATION_DEFINITIONS.contentBrowser.visual.destroyed?.map(clip => clip.frames[0])).toEqual([
      DEBRIS_ASSETS.genericCircuit,
      DEBRIS_ASSETS.genericMetal,
    ]);

    expect(contentBrowserForRoom({ ...contentRoom, isRoot: true })).toBeNull();
    expect(contentBrowserForRoom({ ...contentRoom, childCount: 1 })).toBeNull();

    const portalRoom = {
      ...contentRoom,
      hrefs: ["https://example.com/next"],
    };
    const portalBrowser = contentBrowserForRoom(portalRoom)!;
    const objects = buildInteractiveObjects(
      { nodes: [portalRoom], links: [], hiddenCount: 0 },
      "content-floor",
      null,
      new Set(),
    );
    expect(objects.stairs).toHaveLength(1);
    expect(Math.hypot(
      portalBrowser.x - objects.stairs[0]!.x,
      portalBrowser.y - objects.stairs[0]!.y,
    )).toBeGreaterThan(PORTAL_DEFINITION.size / 2 + portalBrowser.size / 2);

    const restored = buildDecorations(
      { nodes: [contentRoom], links: [], hiddenCount: 0 },
      new Map([[browser.id, { hp: 0, destroyed: true, contentEnabled: true }]]),
    ).find(item => item.id === browser.id)!;
    expect(restored).toMatchObject({ destroyed: true, contentUnlocked: true, contentEnabled: false });

    const drops = buildSceneryDrops([{ ...browser, hp: 0, destroyed: true }], "content-floor", new Set());
    expect(drops).toHaveLength(browser.dropCount!);
    expect(drops.every(drop => drop.kind === "credit")).toBe(true);
    expect(new Set(drops.map(drop => drop.id)).size).toBe(drops.length);
    expect(buildSceneryDrops(
      [{ ...browser, hp: 0, destroyed: true }],
      "content-floor",
      new Set([drops[0]!.id]),
    )).toHaveLength(drops.length - 1);
  });
});
