import { describe, expect, it } from "vitest";
import {
  ASSETS,
  BACKGROUND_ASSETS,
  BASE_FLOOR_ASSETS,
  DAMAGED_FLOOR_ASSETS,
  DEBRIS_ASSETS,
  EFFECT_FRAMES,
  ENVIRONMENT_SEGMENT_SIZE,
  FLOOR_ASSETS,
  MONSTER_FRAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SCENERY_ASSETS,
} from "../../src/client/config";
import { backgroundAssetForUrl } from "../../src/client/domain/background";
import { bossStage } from "../../src/client/domain/boss-attacks";
import { signageFontForUrl, SIGNAGE_FONTS, stationAmbientForUrl, STATION_AMBIENT_TRACKS } from "../../src/client/domain/level-style";
import {
  applyObstacleDamage,
  actorAimDirection,
  actorCollisionCenter,
  actorProjectileOrigin,
  barrelExplosionTargets,
  energyDashPower,
  enemyVolleyProjectiles,
  monsterAttackIsReady,
  monsterEngagementRange,
  monsterMeleeRange,
  projectileHitsCircle,
  projectileHitsDecoration,
  steerDashDirection,
} from "../../src/client/domain/combat";
import {
  distanceSquared,
  footprintMoveIsClear,
  footprintsOverlap,
  pointInCorridor,
  pointNearDirectDoor,
  pointInRoom,
  pointInRoomFloor,
  roomContainingFloorPoint,
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
  monsterLootKindForSeed,
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
import { coalesceLeaves, contentPagesForRoom, domToGraph } from "../../src/client/domain/graph";
import { stableHash } from "../../src/client/domain/hash";
import { corridorEndpoints, corridorIntersectsRoom, corridorLength, doorCapacity, doorPositionForSlot, layoutOrthogonal } from "../../src/client/domain/layout";
import { aStarPath, chooseReachablePath, monsterEscapeStep, revealedRoomPath, walkableApproachPoint, walkableSegment } from "../../src/client/domain/pathfinding";
import { closestPortalWithUrl, entryPortalFor, initialPlayerPosition, updatePortalAvailability, updatePortalContacts } from "../../src/client/domain/portals";
import { indexMonsterHitboxes, monsterCollisionCandidates } from "../../src/client/domain/spatial";
import { buildWallFootprints, wallBlocksSegment, wallHitboxes, wallOverlapsEllipse, WallRectIndex } from "../../src/client/domain/wall-collision";
import {
  BARREL_EXPLOSION_RADIUS,
  BOSS_DEFINITIONS,
  DECORATION_DEFINITIONS,
  DEFAULT_BULLET_SPEC,
  GLM_HUNTER_ATTACKS,
  MAX_REGULAR_MONSTER_FOOTPRINT,
  MAX_REGULAR_MONSTER_RADIUS,
  MINIBOSS_CHANCE_PERCENT,
  MINIBOSS_DAMAGE_MULTIPLIER,
  MINIBOSS_HP_MULTIPLIER,
  MINIBOSS_SIZE_MULTIPLIER,
  MONSTER_WALK_REFERENCE_SPEED,
  monsterWalkElapsed,
  PLAYER_ENERGY_MAX,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  REGULAR_MONSTER_DEFINITIONS,
  ROOM_SCENERY_THEMES,
  ROOM_DEFINITIONS,
  WEAPON_VISUAL_DEFINITIONS,
  WORLD_GEOMETRY,
  type RoomSceneryTheme,
} from "../../src/client/domain/world-specs";
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
import type { Decoration, DungeonGraph, DungeonLayout, EllipseRadii, GraphNode, LayoutLink, Point, RegularMonsterKind, SpriteClip, Stair } from "../../src/client/types";

function onLayoutFloor(layout: DungeonLayout, point: Point): boolean {
  return layout.nodes.some(room => pointInRoomFloor(point.x, point.y, room)) ||
    layout.links.some(link => pointInCorridor(point.x, point.y, link));
}

function actorClearOfWalls(layout: DungeonLayout, point: Point, radius: number | EllipseRadii, walls: WallRectIndex): boolean {
  const radii = typeof radius === "number" ? { x: radius, y: radius } : radius;
  return onLayoutFloor(layout, point) && !wallOverlapsEllipse(point, radii, walls);
}

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

const forkGroups = (links: readonly LayoutLink[]): Map<string, LayoutLink[]> => {
  const groups = new Map<string, LayoutLink[]>();
  for (const link of links) {
    const group = groups.get(link.forkId!) ?? [];
    group.push(link);
    groups.set(link.forkId!, group);
  }
  return groups;
};

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

  it("assigns each readable piece to one browser, including root text and folded descendants", () => {
    const html = `<body>Root text<main>Before <p>Inner <b>bold</b></p> After
      <img src="/picture.png" alt="Picture"><script>secret()</script></main></body>`;
    const graph = domToGraph(html, "https://example.com/page");
    const main = graph.nodes.find(room => room.tag === "main")!;
    const leaf = graph.nodes.find(room => room.tag === "b")!;
    expect(contentBrowserForRoom(graph.nodes[0]!)).not.toBeNull();
    expect(contentBrowserForRoom(main)).not.toBeNull();
    expect(contentBrowserForRoom(leaf)).not.toBeNull();
    const content = graph.nodes.flatMap(room => room.contentChunks ?? []).sort((a, b) => a.order - b.order)
      .map(chunk => chunk.html).join("");
    const rendered = document.createElement("div");
    rendered.innerHTML = content;
    expect(rendered.textContent).toBe("Root textBefore Inner bold After\n      ");
    expect(rendered.querySelectorAll("img")).toHaveLength(1);
    expect(rendered.querySelector("img")?.getAttribute("src")).toBe("https://example.com/picture.png");
    expect(content).not.toContain("secret()");

    const rootPages = contentPagesForRoom(graph.nodes[0]!, graph.nodes);
    const mainSubtree = rootPages.find(page => page.label === "MAIN");
    expect(mainSubtree?.html).toContain("Inner");
    expect(mainSubtree?.html).toContain("<b>bold</b>");
    expect(mainSubtree?.html).toContain("picture.png");
    expect(contentPagesForRoom(main, graph.nodes).find(page => page.label === "P")?.html)
      .toContain("<b>bold</b>");

    const folded = coalesceLeaves(graph.nodes, 2);
    const foldedLeaf = folded.find(room => room.tag === "main")!;
    expect(foldedLeaf.contentChunks?.map(chunk => chunk.html).join("")).toContain("bold");
    expect(contentBrowserForRoom(foldedLeaf)).not.toBeNull();
    const foldedPages = contentPagesForRoom(foldedLeaf);
    expect(foldedPages.filter(page => page.sourceSubtreeId !== undefined).map(page => page.label))
      .toEqual(["P", "IMG"]);
    expect(foldedPages.find(page => page.label === "P")?.html).toContain("<b>bold</b>");
    expect(foldedPages.find(page => page.label === "IMG")?.html).toContain("picture.png");
    expect(foldedPages.filter(page => page.sourceSubtreeId === undefined).every(page => page.label === "MAIN"))
      .toBe(true);
    expect(folded.flatMap(room => room.contentChunks ?? []).map(chunk => chunk.order).sort((a, b) => a - b))
      .toEqual(graph.nodes.flatMap(room => room.contentChunks ?? []).map(chunk => chunk.order).sort((a, b) => a - b));
  });

  it("shows every child subtree's complete HTML on one page, even beyond the chunk limit", () => {
    const text = `${"A".repeat(110_000)}END`;
    const graph = domToGraph(`<body>Root text<main><p>${text}</p><section>Another child</section></main></body>`,
      "https://example.com/page");
    const parentPage = contentPagesForRoom(graph.nodes[0]!, graph.nodes).find(page => page.label === "MAIN");
    expect(parentPage?.html).toContain("END");
    expect(parentPage!.html.length).toBeGreaterThan(110_000);
    const folded = coalesceLeaves(graph.nodes, 2).find(room => room.tag === "main")!;
    const pages = contentPagesForRoom(folded);
    expect(pages).toHaveLength(2);
    expect(pages.map(page => page.label)).toEqual(["P", "SECTION"]);
    const content = document.createElement("div");
    content.innerHTML = pages[0]!.html;
    expect(content.textContent).toBe(text);
    expect(pages[0]!.html.length).toBeGreaterThan(110_000);
    expect(pages[1]?.html).toContain("Another child");
  });

  it("retains every readable chunk beyond the room cap and across long text pages", () => {
    const items = Array.from({ length: 500 }, (_, index) => `<span>Item${index}!</span>`).join("");
    const text = `${"A".repeat(110_000)}END`;
    const graph = domToGraph(`<body><main>${items}<p>${text}</p></main></body>`, "https://example.com/page");
    expect(graph.originalCount).toBe(450);
    expect(graph.nodes).toHaveLength(100);
    expect(graph.truncated).toBe(true);
    const layout = layoutOrthogonal(graph);
    const pages = layout.nodes.flatMap(room => room.contentChunks ?? []);
    expect(layout.nodes.filter(room => room.contentChunks?.length).every(room => contentBrowserForRoom(room))).toBe(true);
    const rendered = document.createElement("div");
    rendered.innerHTML = pages.sort((a, b) => a.order - b.order).map(page => page.html).join("");
    expect([...rendered.textContent!.matchAll(/Item(\d+)!/g)].map(match => Number(match[1])))
      .toEqual(Array.from({ length: 500 }, (_, index) => index));
    expect(rendered.textContent).toContain(text);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every(page => page.html.length <= 48_000)).toBe(true);
  });

  it("omits browsers for script rooms and rooms with no readable content", () => {
    const graph = domToGraph("<body><script>ignored()</script><main> &nbsp; </main></body>", "https://example.com/");
    expect(graph.nodes.filter(room => room.tag === "script" || room.tag === "main")
      .every(room => contentBrowserForRoom(room) === null)).toBe(true);
    expect(buildDecorations(layoutOrthogonal(graph), new Map()).filter(item => item.contentPoint)).toEqual([]);

    const scriptRoom = node(10, 0, 1, {
      tag: "script",
      hrefs: Array.from({ length: 8 }, (_, index) => `https://example.com/${index}`),
      contentChunks: [{ order: 0, html: "<p>Ignored</p>", label: "SCRIPT" }],
    });
    expect(contentBrowserForRoom(scriptRoom)).toBeNull();
    expect(buildInteractiveObjects({ nodes: [scriptRoom], links: [], hiddenCount: 0 },
      "https://example.com/page", null, new Set()).stairs).toHaveLength(8);
    expect(contentBrowserForRoom(domToGraph("<body><img src='/image.png'></body>", "https://example.com/")
      .nodes.find(room => room.tag === "img")!)).not.toBeNull();
  });

  it("reserves a browser slot on the root when it has readable content", () => {
    const root = node(0, null, 0, {
      contentChunks: [{ order: 0, html: "<p>Readable root</p>", label: "BODY" }],
      hrefs: Array.from({ length: 8 }, (_, index) => `https://example.com/${index}`),
    });
    const layout = { nodes: [root], links: [], hiddenCount: 0 };
    expect(contentBrowserForRoom(root)).not.toBeNull();
    const stairs = buildInteractiveObjects(layout, "https://example.com/page", null, new Set()).stairs;
    expect(stairs.filter(stair => stair.type === "up")).toHaveLength(1);
    expect(stairs.filter(stair => stair.type === "down")).toHaveLength(6);
  });
});

describe("URL backgrounds", () => {
  it("keeps a URL's background stable across visits and exposes every tile", () => {
    const urls = Array.from({ length: 200 }, (_, index) => `https://example.com/page-${index}`);
    const selected = urls.map(backgroundAssetForUrl);
    expect(selected).toEqual(urls.map(backgroundAssetForUrl));
    expect(new Set(selected)).toEqual(new Set(BACKGROUND_ASSETS));
  });
});

describe("URL level atmosphere", () => {
  it("chooses stable signage fonts and station ambience from every available asset", () => {
    const urls = Array.from({ length: 200 }, (_, index) => `https://example.com/page-${index}`);
    const fonts = urls.map(signageFontForUrl);
    const tracks = urls.map(stationAmbientForUrl);
    expect(fonts).toEqual(urls.map(signageFontForUrl));
    expect(tracks).toEqual(urls.map(stationAmbientForUrl));
    expect(new Set(fonts)).toEqual(new Set(SIGNAGE_FONTS));
    expect(new Set(tracks)).toEqual(new Set(STATION_AMBIENT_TRACKS));
  });
});

describe("layout and geometry", () => {
  const graph: DungeonGraph = {
    nodes: [node(0, null, 0), node(1, 0, 1), node(2, 0, 1, { lootSeed: 16 })],
    links: [{ source: 0, target: 1 }, { source: 0, target: 2 }],
    originalCount: 3,
    coalescedCount: 0,
    truncated: false,
  };
  const layout = layoutOrthogonal(graph);

  it("uses authored world dimensions directly", () => {
    expect(ROOM_DEFINITIONS.rectangle).toEqual({ width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 4 });
    expect(PLAYER_SPEC.hitboxRadii).toEqual({ x: 28, y: 28 });
    expect(PLAYER_SPEC.footprintRadii).toEqual({ x: 20, y: 20 });
    expect(WORLD_GEOMETRY.segmentSize).toBe(64 * 2);
    expect(WORLD_GEOMETRY.floorTileSize).toBe(64);
    expect(WORLD_GEOMETRY.segmentSize).toBe(WORLD_GEOMETRY.floorTileSize * 2);
  });

  it("keeps actor damage hitboxes separate from occupied floor space", () => {
    const monster = { ...REGULAR_MONSTER_DEFINITIONS["sentry-light"], x: 0, y: 0 };
    const position = { x: monster.x + PLAYER_SPEC.footprintRadii.x + monster.footprintRadii.x, y: monster.y };
    expect(footprintsOverlap(position, PLAYER_SPEC.footprintRadii, monster, monster.footprintRadii)).toBe(false);
    expect(footprintsOverlap(position, PLAYER_SPEC.hitboxRadii, monster, monster.hitboxRadii)).toBe(true);
  });

  it("blocks entering occupied footprints but lets actors escape an existing overlap", () => {
    const blocker = { x: 0, y: 0 };
    expect(footprintMoveIsClear({ x: 12, y: 0 }, { x: 8, y: 0 }, 5, blocker, 5)).toBe(false);
    expect(footprintMoveIsClear({ x: 12, y: 0 }, { x: 10, y: 0 }, 5, blocker, 5)).toBe(true);
    expect(footprintMoveIsClear({ x: 5, y: 0 }, { x: 4, y: 0 }, 5, blocker, 5)).toBe(false);
    expect(footprintMoveIsClear({ x: 5, y: 0 }, { x: 6, y: 0 }, 5, blocker, 5)).toBe(true);
    expect(footprintMoveIsClear({ x: -2, y: 0 }, { x: 3, y: 0 }, 5, blocker, 5)).toBe(false);
    expect(footprintMoveIsClear(blocker, { x: 1, y: 0 }, 5, blocker, 5)).toBe(true);
  });

  it("uses both ellipse axes for footprints and preserves non-blocking scenery footprints", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 19, y: 0 };
    expect(footprintsOverlap(a, { x: 12, y: 3 }, b, { x: 8, y: 3 })).toBe(true);
    expect(footprintsOverlap(a, { x: 3, y: 12 }, b, { x: 3, y: 8 })).toBe(false);
    expect(footprintsOverlap(a, { x: 12, y: 3 }, { x: 16, y: 4 }, { x: 8, y: 3 })).toBe(false);
    expect(DECORATION_DEFINITIONS.contentBrowser.obstacle).toBe(false);
    expect(DECORATION_DEFINITIONS.contentBrowser.footprintRadii.x).toBeGreaterThan(0);
    expect(DECORATION_DEFINITIONS.reagentRack.obstacle).toBe(true);
    expect(DECORATION_DEFINITIONS.reagentRack.footprintRadii.y).toBeGreaterThan(0);
  });

  it("uses X and Y hitbox offsets and radii independently of the footprint", () => {
    const item = {
      ...DECORATION_DEFINITIONS.crateCargo,
      id: "ellipse-crate", roomId: 0, x: 100, y: 100, hp: 1, maxHp: 1, destroyed: false, dropKind: null,
      hitboxOffset: { x: 20, y: -30 }, hitboxRadii: { x: 12, y: 4 },
    };
    expect(projectileHitsDecoration(item, { x: 132, y: 70 }, 1)).toBe(true);
    expect(projectileHitsDecoration(item, { x: 120, y: 76 }, 1)).toBe(false);
    expect(projectileHitsDecoration(item, { x: 100, y: 100 }, 1)).toBe(false);
  });

  it("keeps melee attacks in reach without overlapping the player footprint", () => {
    const heavy = REGULAR_MONSTER_DEFINITIONS["melee-heavy"];
    const monster = { attackRange: heavy.attackRange, footprintRadii: heavy.footprintRadii };
    expect(monsterMeleeRange(monster)).toBeGreaterThan(monster.footprintRadii.x + PLAYER_SPEC.footprintRadii.x);
    expect(monsterMeleeRange(monster)).toBeGreaterThanOrEqual(monster.attackRange);
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
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].size).toBe(150);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-heavy"].size).toBe(230);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].size).toBe(175);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].spriteSize).toBe(150);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].spriteSize).toBe(248.5);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].visual.directions.down?.melee?.origin).toEqual({ x: 0.5, y: 0.5 });
    expect(PLAYER_SPEC.hitboxOffset.y).toBeLessThan(0);
    expect(REGULAR_MONSTER_DEFINITIONS["melee-light"].hitboxOffset.y).toBe(-5);
    expect(DECORATION_DEFINITIONS.crateCargo.visualOffset).toEqual({ x: 0, y: -10 });
    expect(WEAPON_VISUAL_DEFINITIONS["pulse-rifle"].pedestalYOffset).toBeLessThan(0);
  });

  it("positions every scenery clip with a visual offset instead of a sprite origin", () => {
    for (const definition of Object.values(DECORATION_DEFINITIONS)) {
      expect(definition).not.toHaveProperty("origin");
      expect(definition.visual.normal.origin).toEqual({ x: 0.5, y: 0.5 });
      for (const debris of definition.visual.destroyed ?? []) {
        expect(debris.origin).toEqual({ x: 0.5, y: 0.5 });
      }
    }
    expect(DECORATION_DEFINITIONS.plantViolet.visualOffset.y).toBe(-20);
    expect(DECORATION_DEFINITIONS.reactorPylon.visualOffset.y).toBe(-40);
    expect(DECORATION_DEFINITIONS.spawner.visualOffset.y).toBe(-55);
    expect(DECORATION_DEFINITIONS.contentBrowser.visualOffset.y).toBe(-35);
    expect(DECORATION_DEFINITIONS.crateCargo.hitboxOffset.y).toBe(-10);
    expect(DECORATION_DEFINITIONS.reagentRack.hitboxOffset.y).toBe(-15);
    expect(DECORATION_DEFINITIONS.spawner.hitboxOffset.y).toBe(-10);
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

  it.each([
    [12, "N"], [13, "E"], [6, "S"], [23, "W"],
  ] as const)("attaches rooms directly through a shared %s doorway when selected by their hashes", (lootSeed, direction) => {
    const nodes = [node(0, null, 0), node(1, 0, 1, { lootSeed })];
    const adjacent = layoutOrthogonal({ nodes, links: [], originalCount: 2, coalescedCount: 0, truncated: false });
    const link = adjacent.links[0]!;
    const door = link.points[0]!;
    expect(adjacent.hiddenCount).toBe(0);
    expect(link.direction).toBe(direction);
    expect(link.direct).toBe(true);
    expect(link.points).toEqual([door, door]);
    expect(corridorLength(link.points)).toBe(0);
    expect(decorationSpecsForCorridor(link)).toEqual([]);
    expect(revealedRoomPath(adjacent, new Set([0, 1]), 0, 1)).toEqual([0, 1]);

    const normal = direction === "E" ? { x: 1, y: 0 } : direction === "W" ? { x: -1, y: 0 }
      : direction === "S" ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const shift = normal.x ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
    const walls = new WallRectIndex(buildWallFootprints(adjacent));
    const walkable = (point: Point, radius: number | EllipseRadii) =>
      actorClearOfWalls(adjacent, point, radius, walls);
    for (const radius of [PLAYER_SPEC.footprintRadii, { x: MAX_REGULAR_MONSTER_FOOTPRINT, y: MAX_REGULAR_MONSTER_FOOTPRINT }]) {
      const along = normal.x ? radius.x : radius.y;
      const start = { x: door.x - normal.x * (along + 30), y: door.y - normal.y * (along + 30) + shift };
      const goal = { x: door.x + normal.x * (along + 30), y: door.y + normal.y * (along + 30) + shift };
      expect(walkable({ x: door.x, y: door.y + shift }, radius)).toBe(true);
      for (const [from, to] of [[start, goal], [goal, start]] as const) {
        const path = aStarPath(from, to, point => walkable(point, radius), WORLD_GEOMETRY.pathGridStep, 1800);
        expect(path).not.toBeNull();
        expect(path!.slice(1).every((point, index) =>
          walkableSegment(path![index]!, point, candidate => walkable(candidate, radius))
        )).toBe(true);
      }
      const blocked = { x: door.x - normal.y * WORLD_GEOMETRY.segmentSize * 0.75,
        y: door.y + shift + normal.x * WORLD_GEOMETRY.segmentSize * 0.75 };
      expect(walkable(blocked, radius)).toBe(false);
    }
  });

  it.each([
    [12, "N"], [13, "E"], [6, "S"], [23, "W"],
  ] as const)("reveals a directly attached %s room half a segment before its doorway", (lootSeed, direction) => {
    const adjacent = layoutOrthogonal({
      nodes: [node(0, null, 0), node(1, 0, 1, { lootSeed })],
      links: [], originalCount: 2, coalescedCount: 0, truncated: false,
    });
    const link = adjacent.links[0]!;
    const door = link.points[0]!;
    const normal = direction === "E" ? { x: 1, y: 0 } : direction === "W" ? { x: -1, y: 0 }
      : direction === "S" ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const center = {
      x: door.x,
      y: door.y + (normal.x ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0),
    };
    const range = WORLD_GEOMETRY.segmentSize / 2;
    for (const [room, side] of [[link.source, -1], [link.target, 1]] as const) {
      const approach = (distance: number): Point => ({
        x: center.x + normal.x * side * distance,
        y: center.y + normal.y * side * distance,
      });
      expect(pointNearDirectDoor(approach(range + 1), room, link)).toBe(false);
      expect(pointNearDirectDoor(approach(range), room, link)).toBe(true);
      expect(pointNearDirectDoor(approach(range / 2), room, link)).toBe(true);
      expect(pointNearDirectDoor(approach(-range / 2), room, link)).toBe(false);
      expect(pointNearDirectDoor(approach(range), room, { ...link, direct: undefined })).toBe(false);
    }
    expect(pointNearDirectDoor(center, node(2, null, 0), link)).toBe(false);
  });

  it("keeps spaced corridors when direct attachment is not selected", () => {
    const nodes = [node(0, null, 0), node(1, 0, 1, { lootSeed: 11 })];
    const spaced = layoutOrthogonal({ nodes, links: [], originalCount: 2, coalescedCount: 0, truncated: false });
    expect(spaced.links[0]!.direct).toBeUndefined();
    expect(corridorLength(spaced.links[0]!.points)).toBeGreaterThan(0);
  });

  it("mixes direct attachments and spaced corridors across nested rooms", () => {
    const nodes = Array.from({ length: 16 }, (_, index) =>
      node(index, index ? index - 1 : null, index)
    );
    const mixed = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    expect(mixed.hiddenCount).toBe(0);
    expect(mixed.links.filter(link => link.direct).length)
      .toBeGreaterThan(mixed.links.filter(link => !link.direct).length);
    expect(mixed.links.some(link => !link.direct)).toBe(true);
    for (const link of mixed.links.filter(link => link.direct)) {
      for (const room of mixed.nodes) {
        if (room.id === link.source.id || room.id === link.target.id) continue;
        expect(corridorIntersectsRoom(link, room, 0)).toBe(false);
      }
    }
  });

  it("recognizes rooms, corridors, and point distances", () => {
    expect(pointInRoom(0, 0, layout.nodes[0]!)).toBe(true);
    const [start, end] = layout.links[0]!.points;
    expect(pointInCorridor((start!.x + end!.x) / 2, (start!.y + end!.y) / 2, layout.links[0]!)).toBe(true);
    expect(distanceSquared({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(25);
  });

  it("treats room and corridor shapes as floor while piece footprints block walls and door jambs", () => {
    const room = layout.nodes[0]!;
    const topWallEdge = room.y - room.height / 2;
    expect(pointInRoomFloor(room.x, topWallEdge, room)).toBe(true);
    expect(pointInRoomFloor(room.x, topWallEdge - 1, room)).toBe(false);
    expect(pointInRoomFloor(room.x + room.width / 2, room.y, room)).toBe(true);
    expect(pointInRoomFloor(room.x, room.y + room.height / 2, room)).toBe(true);
    expect(pointInRoomFloor(room.x + room.width / 2 + 1, room.y, room)).toBe(false);

    const link = layout.links[0]!;
    const start = link.points[0]!;
    const end = link.points[1]!;
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    expect(pointInCorridor(midpoint.x, midpoint.y, link)).toBe(true);
    const northWall = walls.rects.find(rect => rect.y < topWallEdge && rect.y + rect.height === topWallEdge &&
      rect.width > rect.height && rect.x >= room.x - room.width / 2 && rect.x + rect.width <= room.x + room.width / 2)!;
    expect(actorClearOfWalls(layout, { x: northWall.x + northWall.width / 2,
      y: topWallEdge + PLAYER_SPEC.footprintRadii.y / 4 },
      PLAYER_SPEC.footprintRadii, walls)).toBe(false);
    const doorCenter = { x: start.x, y: start.y + (start.y === end.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0) };
    expect(actorClearOfWalls(layout, doorCenter, PLAYER_SPEC.footprintRadii, walls)).toBe(true);
    expect(pointInCorridor(
      midpoint.x,
      midpoint.y + link.width / 2 + 1,
      link,
    )).toBe(false);
    if (start.y === end.y) {
      const topWallEdge = midpoint.y - link.width / 2;
      expect(pointInCorridor(midpoint.x, topWallEdge, link)).toBe(true);
      expect(pointInCorridor(midpoint.x, topWallEdge - 1, link)).toBe(false);
      expect(pointInCorridor(midpoint.x, midpoint.y + link.width / 2, link)).toBe(true);
    } else {
      expect(pointInCorridor(midpoint.x - link.width / 2, midpoint.y, link)).toBe(true);
      expect(pointInCorridor(midpoint.x - link.width / 2 - 1, midpoint.y, link)).toBe(false);
      expect(pointInCorridor(midpoint.x + link.width / 2, midpoint.y, link)).toBe(true);
    }
  });

  it("keeps widened doorways and corridor obstacles traversable by monsters", () => {
    const decorations = buildDecorations(layout, new Map(), 1);
    const walls = new WallRectIndex(buildWallFootprints(layout));
    for (const link of layout.links) {
      const path = aStarPath(
        link.source,
        link.target,
        point => {
          const inFloor = actorClearOfWalls(layout, point, MAX_REGULAR_MONSTER_FOOTPRINT, walls);
          const blocked = decorations.some(item =>
            item.obstacle &&
            !item.destroyed &&
            footprintsOverlap(point, MAX_REGULAR_MONSTER_FOOTPRINT, item, item.footprintRadii)
          );
          return inFloor && !blocked;
        },
        18,
        6_000,
        {
          minX: Math.min(link.source.x - link.source.width / 2, link.target.x - link.target.width / 2),
          maxX: Math.max(link.source.x + link.source.width / 2, link.target.x + link.target.width / 2),
          minY: Math.min(link.source.y - link.source.height / 2, link.target.y - link.target.height / 2),
          maxY: Math.max(link.source.y + link.source.height / 2, link.target.y + link.target.height / 2),
        },
      );
      expect(path, `Expected route through ${JSON.stringify(link.points)}`).not.toBeNull();
      expect(path!.slice(1).every((point, index) => walkableSegment(
        path![index]!, point,
        candidate => actorClearOfWalls(layout, candidate, MAX_REGULAR_MONSTER_FOOTPRINT, walls),
      ))).toBe(true);
    }
  });

  it("crosses doorway openings from either side at the monster's actual grid size", () => {
    for (const link of layout.links) {
      const door = link.points[0]!;
      const next = link.points[1]!;
      const length = Math.hypot(next.x - door.x, next.y - door.y);
      const unit = { x: (next.x - door.x) / length, y: (next.y - door.y) / length };
      const shiftY = door.y === next.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
      const radius = MAX_REGULAR_MONSTER_FOOTPRINT;
      const start = {
        x: door.x - unit.x * (radius + 30),
        y: door.y - unit.y * (radius + 30) + shiftY,
      };
      const goal = {
        x: door.x + unit.x * (WORLD_GEOMETRY.wallThickness + 30),
        y: door.y + unit.y * (WORLD_GEOMETRY.wallThickness + 30) + shiftY,
      };
      const walls = new WallRectIndex(buildWallFootprints(layout));
      const walkable = (point: Point) => actorClearOfWalls(layout, point, radius, walls);
      for (const [from, to] of [[start, goal], [goal, start]] as const) {
        const path = aStarPath(from, to, walkable, WORLD_GEOMETRY.pathGridStep, 1800);
        expect(path, `Expected ${link.direction} doorway to be passable from both sides`).not.toBeNull();
        expect(path!.at(-1)).toEqual(to);
        expect(path!.slice(1).every((point, index) =>
          walkableSegment(path![index]!, point, walkable)
        )).toBe(true);
      }
    }
  });

  it("routes monsters near room and corridor walls using footprints and sights using hitboxes", () => {
    const room = layout.nodes[0]!;
    const link = layout.links[0]!;
    const [start, end] = link.points;
    const horizontal = start!.y === end!.y;
    const corridorPlayer = horizontal
      ? { x: (start!.x + end!.x) / 2,
        y: start!.y - link.width / 2 + PLAYER_SPEC.footprintRadii.y + 5 }
      : { x: start!.x - link.width / 2 + PLAYER_SPEC.footprintRadii.x + 5,
        y: (start!.y + end!.y) / 2 };
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const hitboxes = new WallRectIndex(wallHitboxes(walls.rects));
    for (const player of [
      { x: room.x, y: room.y - room.height / 2 + PLAYER_SPEC.footprintRadii.y + 5 },
      corridorPlayer,
    ]) {
      for (const kind of ["melee-light", "melee-heavy"] as const) {
        const spec = REGULAR_MONSTER_DEFINITIONS[kind];
        const monster = { x: player.x + 100, y: player.y + 110 };
        const footprint = spec.footprintRadii;
        const walkable = (point: Point) => actorClearOfWalls(layout, point, footprint, walls) &&
          !footprintsOverlap(point, footprint, player, PLAYER_SPEC.footprintRadii);
        const clearShot = (point: Point) => !wallBlocksSegment(
          actorCollisionCenter(point, spec.hitboxOffset), actorCollisionCenter(player, PLAYER_SPEC.hitboxOffset),
          { x: DEFAULT_BULLET_SPEC.radius, y: DEFAULT_BULLET_SPEC.radius }, hitboxes,
        );
        expect(actorClearOfWalls(layout, player, PLAYER_SPEC.footprintRadii, walls)).toBe(true);
        expect(walkable(player)).toBe(false);
        const approach = walkableApproachPoint(player, monster, walkable, clearShot,
          footprint.x + PLAYER_SPEC.footprintRadii.x + WORLD_GEOMETRY.pathGridStep * 2);
        expect(approach).not.toBeNull();
        expect(Math.hypot(approach!.x - player.x, approach!.y - player.y))
          .toBeGreaterThanOrEqual(footprint.x + PLAYER_SPEC.footprintRadii.x);
        const path = aStarPath(monster, approach!, walkable, WORLD_GEOMETRY.pathGridStep, 1800);
        expect(path).not.toBeNull();
        expect(path!.at(-1)).toEqual(approach);
        expect(path!.slice(1).every((point, index) => walkableSegment(path![index]!, point, walkable))).toBe(true);

        expect(clearShot(approach!)).toBe(true);
      }
    }
  });

  it("recognizes the player's room at walkable corners of shaped rooms", () => {
    for (const shape of ["capsule", "octagon"] as const) {
      const room = { ...layout.nodes[0]!, shape };
      const point = {
        x: room.x + room.width / 2 - PLAYER_SPEC.footprintRadii.x,
        y: room.y + room.height / 2 - PLAYER_SPEC.footprintRadii.y,
      };
      expect(pointInRoomFloor(point.x, point.y, room)).toBe(true);
      expect(pointInRoom(point.x, point.y, room, 0)).toBe(false);
      expect(roomContainingFloorPoint([room], point)).toBe(room);
    }
  });

  it("uses shifted wall hitboxes rather than floor membership for projectile paths", () => {
    const wall = new WallRectIndex([{ x: 20, y: 10, width: 10, height: 10 }]);
    const hitboxes = new WallRectIndex(wallHitboxes(wall.rects));
    const shot = { x: 0, y: 0 };
    const target = { x: 60, y: 0 };
    expect(wallBlocksSegment(shot, target, { x: 1, y: 1 }, hitboxes)).toBe(false);
    expect(wallBlocksSegment(shot, target, { x: 1, y: 1 }, wall)).toBe(false);
    const atHitboxHeight = { x: 0, y: 15 + (hitboxes.rects[0]!.y - wall.rects[0]!.y) };
    expect(wallBlocksSegment(atHitboxHeight, { x: 60, y: atHitboxHeight.y }, { x: 1, y: 1 }, hitboxes)).toBe(true);
  });

  it("uses piece footprints, not the floor outline, to block each door jamb", () => {
    const walls = new WallRectIndex(buildWallFootprints(layout));
    for (const link of layout.links) {
      const start = link.points[0]!;
      const end = link.points.at(-1)!;
      const length = corridorLength(link.points);
      const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      const lateral = { x: -unit.y, y: unit.x };
      const verticalShift = start.y === end.y ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
      for (const boundary of [start, end]) {
        const center = { x: boundary.x, y: boundary.y + verticalShift };
        expect(actorClearOfWalls(layout, center, PLAYER_SPEC.footprintRadii, walls)).toBe(true);
        const edge = { x: center.x + lateral.x * WORLD_GEOMETRY.segmentSize * 0.8,
          y: center.y + lateral.y * WORLD_GEOMETRY.segmentSize * 0.8 };
        expect(onLayoutFloor(layout, edge)).toBe(true);
        expect(actorClearOfWalls(layout, edge, PLAYER_SPEC.footprintRadii, walls)).toBe(false);
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
    expect(decorations.every(item => !item.obstacle)).toBe(true);
    expect(monsters).toEqual(monsterSpecsForCorridor(link, 3));
    expect(monsters).toEqual([]);
    expect(decorations.every(item => item.roomId === link.source.id)).toBe(true);
    expect(monsters.every(item => item.spawnRoomId === link.source.id)).toBe(true);
  });

  it("spreads eight siblings across four two-branch forks", () => {
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
    expect(new Set(forkLayout.links.map(link => link.forkId)).size).toBe(4);
    expect(new Set(forkLayout.links.map(link => JSON.stringify(link.points[0]))).size).toBe(4);
    expect(new Set(forkLayout.links.map(link => `${link.points[1]!.x}:${link.points[1]!.y}`)).size).toBe(4);
    expect([...forkGroups(forkLayout.links).values()].map(links => links.length)).toEqual([2, 2, 2, 2]);
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
    expect(pointInCorridor(forkPoint.x, forkPoint.y, forkLink)).toBe(true);
    const end = forkLink.points.at(-1)!;
    const playerInBranch = { x: forkPoint.x + (end.x - forkPoint.x) * 0.4, y: forkPoint.y + (end.y - forkPoint.y) * 0.4 };
    const forkWalls = new WallRectIndex(buildWallFootprints(forkLayout));
    const walkable = (point: Point) => actorClearOfWalls(forkLayout, point, MAX_REGULAR_MONSTER_FOOTPRINT, forkWalls);
    const path = aStarPath(forkLink.source, playerInBranch, walkable, WORLD_GEOMETRY.pathGridStep, 6000);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(playerInBranch);
    expect(path!.slice(1).every((point, index) =>
      walkableSegment(path![index]!, point, walkable)
    )).toBe(true);

    const previousRoom = forkLink.target;
    const playerRoom = forkLayout.links[4]!.target;
    expect(walkableSegment(previousRoom, playerRoom, walkable)).toBe(true);
    expect(walkableSegment(previousRoom, playerRoom, point =>
      actorClearOfWalls(forkLayout, point, MAX_REGULAR_MONSTER_RADIUS, forkWalls)
    )).toBe(true);
    const door = forkLink.points.at(-1)!;
    const beforeDoor = forkLink.points.at(-2)!;
    const doorLength = Math.hypot(beforeDoor.x - door.x, beforeDoor.y - door.y);
    const insideCorridor = {
      x: door.x + (beforeDoor.x - door.x) / doorLength * 80,
      y: door.y + (beforeDoor.y - door.y) / doorLength * 80,
    };
    for (const start of [previousRoom, insideCorridor]) {
      expect(walkable(start)).toBe(true);
      const route = chooseReachablePath(
        start, [playerRoom, forkLink.source], walkable, WORLD_GEOMETRY.pathGridStep, 6000,
        destination => ({
          minX: Math.min(start.x, destination.x, forkLink.source.x) - WORLD_GEOMETRY.pathBoundsPadding,
          maxX: Math.max(start.x, destination.x, forkLink.source.x) + WORLD_GEOMETRY.pathBoundsPadding,
          minY: Math.min(start.y, destination.y, forkLink.source.y) - WORLD_GEOMETRY.pathBoundsPadding,
          maxY: Math.max(start.y, destination.y, forkLink.source.y) + WORLD_GEOMETRY.pathBoundsPadding,
        }),
      );
      expect(route?.targetIndex).toBe(0);
      expect(route?.path.at(-1)).toEqual(playerRoom);
      expect(route!.path.slice(1).every((point, index) =>
        walkableSegment(route!.path[index]!, point, walkable)
      )).toBe(true);
    }
  });

  it("chooses a long shared corridor or multiple room exits from the parent room hash", () => {
    const graphForSeed = (lootSeed: number): DungeonGraph => {
      const nodes = [node(0, null, 0, { lootSeed }),
        ...Array.from({ length: 8 }, (_, index) => node(index + 1, 0, 1))];
      return { nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false };
    };
    const roomForks = layoutOrthogonal(graphForSeed(10));
    const corridorForks = layoutOrthogonal(graphForSeed(12));
    expect(roomForks.hiddenCount).toBe(0);
    expect(corridorForks.hiddenCount).toBe(0);
    expect([...forkGroups(roomForks.links).values()].map(group => group.length)).toEqual([2, 2, 2, 2]);
    expect([...forkGroups(corridorForks.links).values()].map(group => group.length)).toEqual([8]);
    expect(new Set(corridorForks.links.map(link => JSON.stringify(link.points[0]))).size).toBe(1);
    const forks = corridorForks.links.map(link => link.points[1]!);
    expect(new Set(forks.map(point => `${point.x}:${point.y}`)).size).toBe(4);
    const start = corridorForks.links[0]!.points[0]!;
    expect(Math.hypot(forks[7]!.x - start.x, forks[7]!.y - start.y))
      .toBeGreaterThan(Math.hypot(forks[0]!.x - start.x, forks[0]!.y - start.y) + 10 * WORLD_GEOMETRY.segmentSize);
    expect(layoutOrthogonal(graphForSeed(12)).links.map(link => link.points))
      .toEqual(corridorForks.links.map(link => link.points));
  });

  it("uses each room's fork preference independently, including small sibling groups", () => {
    const nodes = [node(0, null, 0, { lootSeed: 98 }),
      node(1, 0, 1, { lootSeed: 12 }), node(2, 0, 1, { lootSeed: 10 }),
      ...Array.from({ length: 8 }, (_, index) => node(index + 3, 1, 2)),
      ...Array.from({ length: 8 }, (_, index) => node(index + 11, 2, 2))];
    const mixed = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    expect(mixed.hiddenCount).toBe(0);
    expect(mixed.links.filter(link => link.source.id === 0).every(link => link.forkId === undefined)).toBe(true);
    expect(forkGroups(mixed.links.filter(link => link.source.id === 1)).size).toBe(1);
    expect(forkGroups(mixed.links.filter(link => link.source.id === 2)).size).toBe(4);

    const corridorRoot = [node(0, null, 0, { lootSeed: 12 }),
      ...Array.from({ length: 3 }, (_, index) => node(index + 1, 0, 1))];
    const shortFork = layoutOrthogonal({
      nodes: corridorRoot, links: [], originalCount: corridorRoot.length, coalescedCount: 0, truncated: false,
    });
    expect(shortFork.links).toHaveLength(3);
    expect(forkGroups(shortFork.links).size).toBe(1);
  });

  it("keeps one door per small side and three distinct slots per long side", () => {
    const small = node(0, null, 0);
    const wide = { ...small, ...ROOM_DEFINITIONS.wide };
    const large = { ...small, ...ROOM_DEFINITIONS.boss };
    expect(["N", "E", "S", "W"].map(side => doorCapacity(small, side as "N" | "E" | "S" | "W")))
      .toEqual([1, 1, 1, 1]);
    expect(["N", "E", "S", "W"].map(side => doorCapacity(wide, side as "N" | "E" | "S" | "W")))
      .toEqual([3, 1, 3, 1]);
    expect(["N", "E", "S", "W"].map(side => doorCapacity(large, side as "N" | "E" | "S" | "W")))
      .toEqual([3, 3, 3, 3]);
    expect([0, 1, 2].map(slot => doorPositionForSlot(large, "N", slot).x))
      .toEqual([0, -2 * WORLD_GEOMETRY.segmentSize, 2 * WORLD_GEOMETRY.segmentSize]);
  });

  it.each([5, 7, 8, 9, 16, 32, 40])("routes up to 32 root children through balanced fork entrances (%i children)", count => {
    const nodes = [node(0, null, 0), ...Array.from({ length: count }, (_, index) => node(index + 1, 0, 1))];
    const forkLayout = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    const placedCount = Math.min(count, 32);
    expect(forkLayout.links).toHaveLength(placedCount);
    expect(forkLayout.hiddenCount).toBe(count - placedCount);
    const groups = forkGroups(forkLayout.links);
    expect(groups.size).toBe(Math.min(4, Math.ceil(placedCount / 2)));
    for (const links of groups.values()) {
      expect(links.length).toBeLessThanOrEqual(8);
      expect(new Set(links.map(link => JSON.stringify(link.points[0]))).size).toBe(1);
    }
    expect(new Set([...groups.values()].map(links => JSON.stringify(links[0]!.points[0]))).size).toBe(groups.size);
    for (const link of forkLayout.links) {
      for (const room of forkLayout.nodes) {
        if (room.id !== link.source.id && room.id !== link.target.id) {
          expect(corridorIntersectsRoom(link, room)).toBe(false);
        }
      }
    }
  });

  it.each([2, 4, 8, 9, 16, 24, 32])("fills long corridor trunks before opening another entrance (%i children)", count => {
    const nodes = [node(0, null, 0, { lootSeed: 12 }),
      ...Array.from({ length: count }, (_, index) => node(index + 1, 0, 1))];
    const layout = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    expect(layout.hiddenCount).toBe(0);
    const groups = [...forkGroups(layout.links).values()];
    expect(groups).toHaveLength(Math.ceil(count / 8));
    expect(groups.map(group => group.length)).toEqual(Array.from({ length: Math.ceil(count / 8) },
      (_, index) => Math.min(8, count - index * 8)));
    expect(groups.every(group => new Set(group.map(link => JSON.stringify(link.points[0]))).size === 1)).toBe(true);
  });

  it("uses a second door on a long side rather than forking through a non-root room's incoming corridor", () => {
    const nodes = [node(0, null, 0), node(1, 0, 1),
      ...Array.from({ length: 32 }, (_, index) => node(index + 2, 1, 2))];
    const forkLayout = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    const incoming = forkLayout.links.find(link => link.target.id === 1)!;
    const children = forkLayout.links.filter(link => link.source.id === 1);
    expect(children).toHaveLength(32);
    expect(forkLayout.hiddenCount).toBe(0);
    const groups = forkGroups(children);
    expect(groups.size).toBe(4);
    expect([...groups.values()].map(links => links[0]!.direction)).not.toContain(incoming.targetDirection);
    const entrances = [...groups.values()].map(links => links[0]!.points[0]!);
    expect(new Set(entrances.map(point => `${point.x}:${point.y}`)).size).toBe(4);
    expect(entrances).not.toContainEqual(incoming.points.at(-1));
    expect(new Set([...groups.values()].map(links => links[0]!.direction)).size).toBe(3);
  });

  it("uses a spare long-side slot when a wide room's incoming door occupies a short side", () => {
    const nodes = [node(0, null, 0), node(1, 0, 1, { lootSeed: 11 }),
      ...Array.from({ length: 7 }, (_, index) => node(index + 2, 1, 2))];
    const layout = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    const parent = layout.nodes.find(room => room.id === 1)!;
    const children = layout.links.filter(link => link.source.id === 1);
    expect(parent.width).toBe(ROOM_DEFINITIONS.wide.width);
    expect(children).toHaveLength(7);
    const groups = forkGroups(children);
    expect(groups.size).toBe(4);
    const byDirection = [...groups.values()].map(links => links[0]!.direction);
    expect(byDirection.filter(direction => direction === "N" || direction === "S")).toHaveLength(3);
    expect(byDirection).not.toContain(parent.parentSide);
  });

  it("promotes an unplaceable subtree's content to a browser on its placed ancestor", () => {
    const nodes = [
      node(0, null, 0, { contentChunks: [{ order: 0, html: "<p>Root</p>", label: "ROOT" }] }),
      ...Array.from({ length: 40 }, (_, index) => node(index + 1, 0, 1, {
        contentChunks: [{ order: index + 1, html: `<p>Child${index + 1}</p>`, label: `CHILD${index + 1}` }],
      })),
      node(41, 40, 2, { contentChunks: [{ order: 41, html: "<p>Grandchild</p>", label: "GRANDCHILD" }] }),
    ];
    const layout = layoutOrthogonal({ nodes, links: [], originalCount: nodes.length, coalescedCount: 0, truncated: false });
    const root = layout.nodes[0]!;
    expect(layout.hiddenCount).toBe(9);
    const lastChildPage = contentPagesForRoom(root).find(page => page.sourceSubtreeId === 40);
    expect(lastChildPage?.label).toBe(nodes[40]!.floorLabel);
    expect(lastChildPage?.html).toContain("Child40");
    expect(lastChildPage?.html).toContain("Grandchild");
    expect(contentBrowserForRoom(root)).not.toBeNull();
    expect(layout.nodes.flatMap(room => room.contentChunks ?? []).map(chunk => chunk.order).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 42 }, (_, index) => index));
    expect(nodes[0]!.contentChunks).toHaveLength(1);
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

  it("does not jump a thin blocked doorway band between walkable grid points", () => {
    const walkable = ({ x, y }: Point) => !(x >= 4 && x <= 13 && y <= 4);
    const path = aStarPath({ x: 0, y: 0 }, { x: 36, y: 0 }, walkable, 18, 200);
    expect(path).not.toBeNull();
    expect(path!.slice(1).every((point, index) =>
      walkableSegment(path![index]!, point, walkable)
    )).toBe(true);
    expect(path!.some(point => point.y > 0)).toBe(true);
  });

  it("reaches the doorway grid from a walkable position whose nearest cell is blocked", () => {
    const walkable = ({ x }: Point) => x >= 4;
    const start = { x: 6, y: 0 };
    const goal = { x: 36, y: 0 };
    const path = aStarPath(start, goal, walkable, 18, 200);
    expect(path?.[0]).toEqual(start);
    expect(path?.at(-1)).toEqual(goal);
    expect(path!.slice(1).every((point, index) => walkableSegment(path![index]!, point, walkable))).toBe(true);
    const returnPath = aStarPath(goal, start, walkable, 18, 200);
    expect(returnPath?.at(-1)).toEqual(start);
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
    const obstacle = { x: 0, y: 0, radii: { x: 10, y: 10 } };
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

  it("previews the closest URL-bearing portal in range even when portals are inactive", () => {
    const first: Stair = { ...portal, enabled: false };
    const second: Stair = { ...portal, id: "room-1::portal-down-1", x: 160, url: "https://example.com/other", enabled: false };
    const noUrl: Stair = { ...portal, id: "room-1::portal-up", x: 140, url: null };
    const portals = [first, second, noUrl];

    expect(closestPortalWithUrl(portals, { x: 125, y: 100 }, 80)).toBe(first);
    expect(closestPortalWithUrl(portals, { x: 145, y: 100 }, 80)).toBe(second);
    expect(closestPortalWithUrl(portals, { x: 300, y: 100 }, 80)).toBeNull();
  });

  it("requires the boss and every enemy from revealed rooms, but ignores unrevealed enemies", () => {
    const down = { ...portal };
    const up = { ...portal, id: "room-1::portal-up", type: "up" as const, url: "https://example.com/previous" };
    const firstFloorUp = { ...up, id: "room-0::portal-up", url: null };
    const stairs = [down, up, firstFloorUp];
    const monsters = [
      { dead: false, spawnRoomId: 0, roomId: 0, bossKind: undefined },
      { dead: false, spawnRoomId: 1, roomId: 1, bossKind: "qwen-teleporter" as const },
      { dead: false, spawnRoomId: 2, roomId: 2, bossKind: undefined },
      { dead: false, spawnRoomId: 3, roomId: 3, bossKind: undefined },
    ];
    const revealed = new Set([0]);

    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([false, false, false]);
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(false);

    monsters[1]!.dead = true; // The boss blocks even before its room is revealed.
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(false);
    monsters[0]!.dead = true;
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([true, true, false]);

    revealed.add(2);
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([false, false, false]);
    monsters[2]!.dead = true;
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([true, true, false]);

    // Reinforcements from a revealed room also relock portals.
    monsters.push({ dead: false, spawnRoomId: 2, roomId: 3, bossKind: undefined });
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    monsters[4]!.dead = true;
    expect(updatePortalAvailability(stairs, monsters, revealed)).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([true, true, false]);
  });

  it("counts enemies that enter a revealed room even if they originated elsewhere", () => {
    const stairs = [{ ...portal, enabled: false }];
    const monster = { dead: false, spawnRoomId: 2, roomId: 2, miniboss: true };
    const revealed = new Set([0]);
    expect(updatePortalAvailability(stairs, [monster], revealed)).toBe(true);
    expect(stairs[0]?.enabled).toBe(true);
    monster.roomId = 0;
    expect(updatePortalAvailability(stairs, [monster], revealed)).toBe(true);
    expect(stairs[0]?.enabled).toBe(false);
  });

  it("opens destination portals immediately on floors without monsters", () => {
    const stairs = [{ ...portal, enabled: false }, { ...portal, type: "up" as const, url: null }];
    expect(updatePortalAvailability(stairs, [], new Set())).toBe(true);
    expect(stairs.map(stair => stair.enabled)).toEqual([true, false]);
  });

  it("requires leaving a portal occupied at spawn before it can activate", () => {
    const contacts = new Set<string>();
    updatePortalContacts([portal], portal, PLAYER_SPEC.footprintRadii, contacts);
    expect(updatePortalContacts([portal], portal, PLAYER_SPEC.footprintRadii, contacts)).toBeNull();
    expect(updatePortalContacts([portal], { x: 200, y: 100 }, PLAYER_SPEC.footprintRadii, contacts)).toBeNull();
    expect(updatePortalContacts([portal], portal, PLAYER_SPEC.footprintRadii, contacts)).toEqual(portal);
  });

  it("does not activate when walking through a disabled portal", () => {
    const contacts = new Set<string>();
    expect(updatePortalContacts([{ ...portal, enabled: false }], portal, PLAYER_SPEC.footprintRadii, contacts)).toBeNull();
    expect(contacts.size).toBe(0);
  });

  it("activates only when the whole player footprint enters the portal footprint, not at spawn", () => {
    const contacts = new Set<string>();
    const { footprintRadii, spawnOffset } = PORTAL_DEFINITION;
    expect(updatePortalContacts(
      [portal],
      { x: portal.x + footprintRadii.x - PLAYER_SPEC.footprintRadii.x + 1, y: portal.y },
      PLAYER_SPEC.footprintRadii,
      contacts,
    )).toBeNull();
    expect(updatePortalContacts([portal], portal, PLAYER_SPEC.footprintRadii, contacts)).toEqual(portal);
    contacts.clear();
    expect(updatePortalContacts(
      [portal],
      { x: portal.x + spawnOffset.x, y: portal.y + spawnOffset.y },
      PLAYER_SPEC.footprintRadii,
      contacts,
    )).toBeNull();
  });

  it("checks the player's entire elliptical footprint, including diagonal edges", () => {
    const contacts = new Set<string>();
    const playerFootprint = { x: 8, y: 20 };
    const portalRadii = PORTAL_DEFINITION.footprintRadii;
    expect(updatePortalContacts([portal], { x: portal.x, y: portal.y + portalRadii.y - playerFootprint.y + 1 },
      playerFootprint, contacts)).toBeNull();
    expect(updatePortalContacts([portal], {
      x: portal.x + portalRadii.x * 0.7,
      y: portal.y + portalRadii.y * 0.6,
    }, playerFootprint, contacts)).toBeNull();
    expect(updatePortalContacts([portal], portal, playerFootprint, contacts)).toEqual(portal);
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
    const first = monsterWalkElapsed(walk, 1_000, 1, 120);
    const second = monsterWalkElapsed(walk, 1_000, 2, 120);
    expect(first).not.toBe(second);
    expect(monsterWalkElapsed(walk, 1_000, 1, 120)).toBe(first);
  });

  it("scales walk playback rate with monster speed and clamps extremes", () => {
    expect(MONSTER_WALK_REFERENCE_SPEED).toBe(120);
    expect(monsterWalkElapsed(walk, 1_000, 0, 0)).toBe(500);
    expect(monsterWalkElapsed(walk, 1_000, 0, 600)).toBe(2_000);
    expect(monsterWalkElapsed(walk, 1_000, 0, 120)).toBe(1_000);
    expect(monsterWalkElapsed(walk, 1_000, 0, 60)).toBe(500);
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
          const minimum = Math.max(10, item.footprintRadii.x, item.footprintRadii.y) +
            Math.max(10, other.footprintRadii.x, other.footprintRadii.y) + 8;
          expect(Math.hypot(item.x - other.x, item.y - other.y)).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  it("uses every new room theme and makes its scenery available to generation", () => {
    const newThemes: RoomSceneryTheme[] = ["medical", "engine", "escape", "storage", "living"];
    const rooms = Array.from({ length: 800 }, (_, index) => node(index + 40_000, 0, 1, {
      tag: "img",
      lootSeed: stableHash(`new-theme-${index}`),
    }));
    const themedAssets = Object.values(SCENERY_ASSETS).filter(asset =>
      /^assets\/scenery\/(medical|engine|escape|storage|living)\//.test(asset) ||
      asset === SCENERY_ASSETS.planterDivider
    );
    const themeAssets = new Set(Object.values(ROOM_SCENERY_THEMES).flatMap(theme =>
      [...theme.primary, ...theme.accents].map(entry => entry.definition.visual.normal.frames[0])
    ));
    expect(themedAssets).toHaveLength(48);
    expect(themedAssets.filter(asset => !themeAssets.has(asset))).toEqual([]);
    const spawnedAssets = new Set(rooms.flatMap(room => decorationSpecsForRoom(room).map(item => item.visual.normal.frames[0])));
    expect(themedAssets.filter(asset => !spawnedAssets.has(asset))).toEqual([]);
    for (const theme of newThemes) {
      const matching = rooms.filter(room => roomSceneryThemeForRoom(room) === theme);
      expect(matching.length, theme).toBeGreaterThan(0);
      const primaryIds = new Set(ROOM_SCENERY_THEMES[theme].primary.map(entry => entry.definition.definitionId));
      expect(matching.some(room => decorationSpecsForRoom(room).some(item => primaryIds.has(item.definitionId)))).toBe(true);
      expect(roomSceneryThemeForRoom(matching[0]!)).toBe(theme);
    }
    expect(ROOM_SCENERY_THEMES.lab.primary.some(entry => entry.definition.definitionId === "evacuation-kiosk")).toBe(false);
    expect(ROOM_SCENERY_THEMES.escape.primary.some(entry => entry.definition.definitionId === "evacuation-kiosk")).toBe(true);
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
    expect(monsterPositionIsClear(relocated, relocated.footprintRadii, combatLayout, [blocker])).toBe(true);
    expect(monsterPositionIsClear(
      { x: blocker.x + blocker.footprintRadii.x + relocated.footprintRadii.x - 1, y: blocker.y },
      relocated.footprintRadii, combatLayout, [blocker],
    )).toBe(false);
  });

  it("keeps generated monsters off the player's arrival footprint", () => {
    const combatRoom = node(9, 0, 1, {
      x: 500,
      y: 400,
      tag: "section",
      isRoot: false,
      lootSeed: stableHash("arrival-monster-room"),
    });
    const layout = { nodes: [combatRoom], links: [], hiddenCount: 0 };
    const first = monsterSpecsForRoom(combatRoom, 1)[0]!;
    const arrival = { x: first.x, y: first.y };
    const monsters = buildMonsters(layout, new Map(), new Set([combatRoom.id]), 1, [], arrival);
    expect(monsters.some(monster => monster.id === first.id)).toBe(true);
    expect(monsters.every(monster =>
      !footprintsOverlap(monster, monster.footprintRadii, arrival, PLAYER_SPEC.footprintRadii)
    )).toBe(true);
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
        const itemIsDecoration = "definitionId" in item;
        const otherIsDecoration = "definitionId" in other;
        // Monsters only keep their distance from obstacle scenery; non-obstacle
        // low scenery is intentionally walkable. Decoration pairs always separate.
        if (itemIsDecoration !== otherIsDecoration) {
          const decoration = itemIsDecoration ? item : other;
          if (!(decoration as Decoration).obstacle) continue;
        }
        // Actor placement checks the actual ellipses, including enlarged
        // miniboss footprints, rather than their enclosing circles.
        if (!itemIsDecoration || !otherIsDecoration) {
          expect(footprintsOverlap(item, item.footprintRadii, other, other.footprintRadii), `${item.id} vs ${other.id}`)
            .toBe(false);
          continue;
        }
        const minimum = Math.max(item.footprintRadii.x, item.footprintRadii.y) +
          Math.max(other.footprintRadii.x, other.footprintRadii.y);
        expect(Math.hypot(item.x - other.x, item.y - other.y), `${item.id} vs ${other.id}`)
          .toBeGreaterThanOrEqual(minimum);
      }
    }
    for (const room of rooms) {
      const positions = lootPositions(room, lootCountForRoom(room));
      for (const [index, position] of positions.entries()) {
        for (const other of positions.slice(index + 1)) {
          expect(Math.hypot(position.x - other.x, position.y - other.y))
            .toBeGreaterThanOrEqual(66);
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
      width: 460,
      height: 560,
      shape: "tall",
    });
    const positions = staircasePositions(tallRoom, 10);
    const distances = positions.flatMap((position, index) =>
      positions.slice(index + 1).map(other => Math.hypot(position.x - other.x, position.y - other.y))
    );
    expect(positions).toHaveLength(8);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(100);
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
      isBossArena: true,
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
      .map(item => ({ kind: item.kind, obstacle: item.obstacle, destructible: item.destructible, visualOffset: item.visualOffset }));
    expect(sceneryFor(script)).toEqual(sceneryFor(section));
    expect(monsterSpecsForRoom({ ...script, isBossArena: false }).some(monster => monster.bossKind)).toBe(false);
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

  it("spaces scenery along long and turning corridors without stacking props", () => {
    const source = node(0, null, 0);
    const target = node(1, 0, 1);
    const length = ENVIRONMENT_SEGMENT_SIZE * 20;
    const link: LayoutLink = {
      id: "long-corridor", source, target, direction: "S", ownerRoomId: source.id,
      width: WORLD_GEOMETRY.corridorHalfWidth * 2,
      points: [{ x: 0, y: 0 }, { x: 0, y: length }, { x: length / 2, y: length }],
    };
    const decorations = decorationSpecsForCorridor(link, 4);
    expect(decorations.length).toBeGreaterThan(3);
    expect(decorations).toEqual(decorationSpecsForCorridor(link, 4));
    for (const [index, item] of decorations.entries()) {
      for (const previous of decorations.slice(0, index)) {
        expect(Math.hypot(item.x - previous.x, item.y - previous.y))
          .toBeGreaterThanOrEqual((item.size + previous.size) / 2);
      }
    }
    expect(decorations.some(item => item.y < length / 2)).toBe(true);
    expect(decorations.some(item => item.x > 0)).toBe(true);

    // Forked corridors may share a trunk; they must not duplicate its props.
    const shared = { ...link, id: "shared-trunk" };
    const generated = buildDecorations({ nodes: [source, target], links: [link, shared], hiddenCount: 0 }, new Map(), 4)
      .filter(item => item.kind === "corridor-prop");
    for (const [index, item] of generated.entries()) {
      for (const previous of generated.slice(0, index)) {
        expect(Math.hypot(item.x - previous.x, item.y - previous.y))
          .toBeGreaterThanOrEqual((item.size + previous.size) / 2);
      }
    }
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
    expect(scout!.hitboxRadii.x).toBeLessThan(heavy!.hitboxRadii.x);
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
      .toBeGreaterThan(REGULAR_MONSTER_DEFINITIONS["sentry-light"].attackCooldownMs);
    expect(REGULAR_MONSTER_DEFINITIONS["sentry-light"].attackCooldownMs)
      .toBe(700);
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
    expect(lightSentry.attackCooldownMs).toBe(700);
    expect(lightSentry.visual.directions.down?.ranged?.frameDurationMs).toBe(125);
    expect(monsterAttackIsReady(lightSentry, 1_699)).toBe(false);
    expect(monsterAttackIsReady(lightSentry, 1_700)).toBe(true);
    lightSentry.attackWarmupUntil = 1_750;
    expect(monsterAttackIsReady(lightSentry, 1_749)).toBe(false);
    expect(monsterAttackIsReady(lightSentry, 1_750)).toBe(true);
    delete lightSentry.attackWarmupUntil;
    expect(monsterAttackIsReady(lightSentry, 1_700)).toBe(true);
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
      expect(miniboss.spriteSize).toBeCloseTo(definition.spriteSize * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.destroyedVisualOffset.y).toBeCloseTo(definition.destroyedVisualOffset.y * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.visualOffset.x).toBeCloseTo(definition.visualOffset.x * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.visualOffset.y).toBeCloseTo(definition.visualOffset.y * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.hitboxOffset.x).toBeCloseTo(definition.hitboxOffset.x * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.hitboxOffset.y).toBeCloseTo(definition.hitboxOffset.y * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.visual).toBe(definition.visual);
      expect(miniboss.hitboxRadii.x).toBeCloseTo(definition.hitboxRadii.x * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.hitboxRadii.y).toBeCloseTo(definition.hitboxRadii.y * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.footprintRadii.x).toBeCloseTo(definition.footprintRadii.x * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.footprintRadii.y).toBeCloseTo(definition.footprintRadii.y * MINIBOSS_SIZE_MULTIPLIER);
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

    const arena = node(30_300, 0, 1, {
      tag: "script", isBossArena: true, isRoot: false,
      x: -ROOM_WIDTH * 3, lootSeed: stableHash("fallback-arena"),
    });
    const layout = { nodes: [...rooms, arena], links: [], hiddenCount: 0 };
    const generated = buildMonsters(layout, new Map(), new Set(), 3);
    const reordered = buildMonsters(
      { ...layout, nodes: [...layout.nodes].reverse() },
      new Map(),
      new Set(),
      3,
    );
    const minibosses = generated.filter(monster => monster.miniboss);
    const reorderedMinibosses = reordered.filter(monster => monster.miniboss);

    expect(minibosses).toHaveLength(1);
    expect(minibosses[0]?.spawnRoomId).not.toBe(arena.id);
    expect(reorderedMinibosses).toHaveLength(1);
    expect(reorderedMinibosses[0]?.id).toBe(minibosses[0]?.id);
  });

  it("uses the entrance for the miniboss when it is the only alternative to the arena", () => {
    const root = node(0, null, 0);
    const candidate = Array.from({ length: 100 }, (_, index) => node(1, 0, 1, {
      lootSeed: stableHash(`two-room-arena-${index}`), isBossArena: true,
    })).find(room => monsterSpecsForRoom(room).every(monster => !monster.miniboss))!;
    const layout = layoutOrthogonal({
      nodes: [root, candidate], links: [{ source: 0, target: 1 }],
      originalCount: 2, coalescedCount: 0, truncated: false,
    });
    const monsters = buildMonsters(layout, new Map(), new Set());
    const miniboss = monsters.find(monster => monster.miniboss);
    expect(monsters.filter(monster => monster.bossKind)).toHaveLength(1);
    expect(miniboss?.spawnRoomId).toBe(root.id);
    expect(buildMonsters(layout, new Map(), new Set()).find(monster => monster.miniboss)?.id).toBe(miniboss?.id);
  });

  it("skips bosses and minibosses when the floor has only one room", () => {
    const root = node(0, null, 0, { tag: "script" });
    const layout = layoutOrthogonal({
      nodes: [root], links: [], originalCount: 1, coalescedCount: 0, truncated: false,
    });
    expect(layout.nodes[0]?.isBossArena).toBe(false);
    expect(buildMonsters(layout, new Map(), new Set())).toEqual([]);
  });

  it("breaks equal room-to-room distances using the floor seed, independently of node order", () => {
    const root = node(0, null, 0, { lootSeed: stableHash("tie-root") });
    const first = node(1, 0, 1, { lootSeed: stableHash("tie-first") });
    const second = node(2, 0, 1, { lootSeed: stableHash("tie-second") });
    const graph = {
      nodes: [root, first, second], links: [{ source: 0, target: 1 }, { source: 0, target: 2 }],
      originalCount: 3, coalescedCount: 0, truncated: false,
    };
    const expected = [first, second].sort((left, right) =>
      stableHash(`${root.lootSeed}|boss-arena|${right.lootSeed}|${right.id}`) -
      stableHash(`${root.lootSeed}|boss-arena|${left.lootSeed}|${left.id}`) || left.id - right.id
    )[0]!.id;
    expect(layoutOrthogonal(graph).nodes.find(room => room.isBossArena)?.id).toBe(expected);
    expect(layoutOrthogonal({ ...graph, nodes: [root, second, first] })
      .nodes.find(room => room.isBossArena)?.id).toBe(expected);
  });

  it("turns the farthest room into a scaled boss arena regardless of its tag", () => {
    const root = node(0, null, 0);
    const scriptRoom = node(1, 0, 1, {
      tag: "script",
      lootSeed: stableHash("boss-script"),
    });
    const farthest = node(2, 1, 2, { tag: "img", lootSeed: stableHash("boss-image") });
    const bossLayout = layoutOrthogonal({
      nodes: [root, scriptRoom, farthest],
      links: [{ source: 0, target: 1 }, { source: 1, target: 2 }],
      originalCount: 3,
      coalescedCount: 0,
      truncated: false,
    });
    const arena = bossLayout.nodes.find(room => room.isBossArena)!;
    expect(arena.id).toBe(farthest.id);
    expect(bossLayout.nodes.find(room => room.id === scriptRoom.id)?.isBossArena).toBe(false);
    expect(monsterSpecsForRoom(bossLayout.nodes.find(room => room.id === scriptRoom.id)!)
      .some(monster => monster.bossKind)).toBe(false);
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

    const glmHunter = bossSpecForRoom(arena, 1, "glm-hunter");
    expect(glmHunter.maxHp).toBeGreaterThan(150);
    expect(glmHunter.visual).toBe(BOSS_DEFINITIONS["glm-hunter"].visual);
    expect(glmHunter.spriteSize).toBe(BOSS_DEFINITIONS["glm-hunter"].spriteSize);
    expect(glmHunter.destroyedVisualOffset).toEqual(BOSS_DEFINITIONS["glm-hunter"].destroyedVisualOffset);
    expect(glmHunter.attackRange).toBeGreaterThanOrEqual(glmHunter.footprintRadii.x + PLAYER_SPEC.footprintRadii.x);
    expect(GLM_HUNTER_ATTACKS.chargeWindupMs).toBeGreaterThan(0);
    expect(GLM_HUNTER_ATTACKS.initialChargeDelayMs).toBeGreaterThan(GLM_HUNTER_ATTACKS.chargeWindupMs);

    const sampledScripts = Array.from({ length: 200 }, (_, index) => node(index + 3_000, 0, 1, {
      tag: "script",
      lootSeed: stableHash(`boss-kind-${index}`),
      isRoot: false,
    }));
    expect(new Set(sampledScripts.map(bossKindForRoom))).toEqual(
      new Set(["deepseek-summoner", "qwen-teleporter", "glm-hunter", "kimi-spiral", "hy4-wave"]),
    );
    expect(BOSS_DEFINITIONS["hy4-wave"].label).toBe("Hy4");
    const rosterRoot = node(5_000, null, 0, { lootSeed: stableHash("boss-roster-root") });
    const rosterScripts = Array.from({ length: 20 }, (_, index) => node(5_001 + index, rosterRoot.id, 1, {
      tag: "section",
      lootSeed: stableHash(`roster-script-${index}`),
      isRoot: false,
      isBossArena: true,
      x: index * 1_000,
    }));
    const roster = buildMonsters(
      { nodes: [rosterRoot, ...rosterScripts], links: [], hiddenCount: 0 },
      new Map(),
      new Set(),
      1,
    ).filter(monster => monster.bossKind);
    expect(new Set(roster.map(monster => monster.bossKind))).toEqual(
      new Set(["deepseek-summoner", "qwen-teleporter", "glm-hunter", "kimi-spiral", "hy4-wave"]),
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

  it("reconstructs deterministic DeepSeek summons from boss state", () => {
    const scriptRooms = Array.from({ length: 100 }, (_, index) => node(index + 4_000, 0, 1, {
      tag: "script",
      lootSeed: stableHash(`summoner-boss-${index}`),
      isRoot: false,
      x: 500,
      y: 400,
    }));
    const room = scriptRooms.find(candidate => bossKindForRoom(candidate) === "deepseek-summoner")!;
    room.isBossArena = true;
    const boss = bossSpecForRoom(room, 6);
    const firstSummon = monsterSpecForBossSummon(boss, 6, 0);
    expect(firstSummon).toEqual(monsterSpecForBossSummon(boss, 6, 0));
    const layout = { nodes: [room], links: [], hiddenCount: 0 };
    const savedStates = new Map([[
        boss.id,
        {
          x: boss.x,
          y: boss.y,
          roomId: room.id,
          hp: Math.floor(boss.maxHp / 4),
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
      ]]);
    const monsters = buildMonsters(layout, savedStates, new Set([room.id]), 6);
    expect(monsters.filter(monster => monster.id.startsWith(`${boss.id}::summon-`))).toHaveLength(3);
    expect(monsters.find(monster => monster.id === boss.id)).toMatchObject({
      hp: Math.floor(boss.maxHp / 4),
      attackSequence: 3,
      summonedCount: 3,
    });
    expect(bossStage(monsters.find(monster => monster.id === boss.id)!.hp, boss.maxHp)).toBe(3);

    savedStates.set(`${boss.id}::summon-1`, { ...savedStates.get(boss.id)!, hp: 0, dead: true });
    expect(buildMonsters(layout, savedStates, new Set([room.id]), 6)
      .filter(monster => monster.id.startsWith(`${boss.id}::summon-`))).toHaveLength(2);
  });

  it("preserves boss positions after they pursue the player out of their arena", () => {
    const room = node(6_000, null, 0, {
      parentId: 0,
      isRoot: false,
      tag: "script",
      isBossArena: true,
      x: 250,
      y: -150,
      width: ROOM_DEFINITIONS.boss.width,
      height: ROOM_DEFINITIONS.boss.height,
      lootSeed: stableHash("confined-boss"),
    });
    const boss = bossSpecForRoom(room, 4);
    const destination = node(999, room.id, 1, {
      x: room.x + room.width + 300,
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
    expect(pointInRoom(restored.x, restored.y, room, restored.hitboxRadii)).toBe(false);
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

  it("scales dash distance and damage per energy, including charges above the current cap", () => {
    expect(PLAYER_ENERGY_MAX).toBe(10);
    expect(energyDashPower(1)).toEqual({ maxDistance: WORLD_GEOMETRY.segmentSize * 0.75, damage: 4.7 });
    expect(energyDashPower(5)).toEqual({ maxDistance: WORLD_GEOMETRY.segmentSize * 0.75 * 5, damage: 23.5 });
    expect(energyDashPower(10)).toEqual({ maxDistance: WORLD_GEOMETRY.segmentSize * 0.75 * 10, damage: 47 });
    expect(energyDashPower(15)).toEqual({ maxDistance: WORLD_GEOMETRY.segmentSize * 0.75 * 15, damage: 70.5 });
  });

  it("turns the dash toward the current cursor at a limited rate", () => {
    const current = { x: 1, y: 0 };
    const center = { x: 0, y: 0 };
    const turn = steerDashDirection(current, center, { x: 0, y: 100 }, Math.PI / 6);
    expect(turn.x).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(turn.y).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(steerDashDirection(turn, center, { x: 0, y: 100 }, Math.PI / 2).y).toBeCloseTo(1);
    expect(steerDashDirection(current, center, center, Math.PI / 6)).toBe(current);
    const crossing = steerDashDirection({ x: -1, y: 0.01 }, center, { x: -100, y: -1 }, 0.1);
    expect(crossing.x).toBeLessThan(-0.99);
  });

  it("includes nearby destructible scenery, other barrels, and active monsters in a barrel blast", () => {
    const barrel: Decoration = {
      ...DECORATION_DEFINITIONS.barrelRed,
      id: "blast-barrel", roomId: room.id, x: 1000, y: 1000,
      maxHp: 6, hp: 0, destroyed: true, dropKind: null,
    };
    const neighbor = { ...barrel, id: "neighbor", x: barrel.x + 40, hp: 6, destroyed: false };
    const crate: Decoration = {
      ...DECORATION_DEFINITIONS.crateCargo,
      id: "near-crate", roomId: room.id, x: barrel.x - 50, y: barrel.y,
      maxHp: 4, hp: 4, destroyed: false, dropKind: null,
    };
    const destroyed = { ...crate, id: "destroyed-crate", destroyed: true };
    const indestructible = { ...crate, id: "pedestal", destructible: false };
    const distant = { ...crate, id: "distant-crate", x: barrel.x + BARREL_EXPLOSION_RADIUS + crate.hitboxRadii.x + 1 };
    const monsterSpec = monsterSpecForSpawner(barrel, 1, 0);
    const monster = {
      ...monsterSpec,
      active: true,
      hp: 10,
      y: barrel.y + barrel.hitboxOffset.y - monsterSpec.hitboxOffset.y,
    };
    const dead = { ...monster, id: "dead-monster", dead: true };
    const inactive = { ...monster, id: "inactive-monster", active: false };
    const farMonster = { ...monster, id: "far-monster", x: barrel.x + BARREL_EXPLOSION_RADIUS + monster.hitboxRadii.x + 1 };
    const player = { x: barrel.x, y: barrel.y + barrel.hitboxOffset.y - PLAYER_SPEC.hitboxOffset.y };

    expect(barrelExplosionTargets(
      barrel,
      [barrel, neighbor, crate, destroyed, indestructible, distant],
      [monster, dead, inactive, farMonster],
      player,
    )).toEqual({ decorations: [neighbor, crate], monsters: [monster], hitsPlayer: true });
  });

  it("uses collider edges and visible centers for barrel explosion range", () => {
    const barrel: Decoration = {
      ...DECORATION_DEFINITIONS.barrelHazard,
      id: "blast-barrel", roomId: room.id, x: 1000, y: 1000,
      maxHp: 6, hp: 0, destroyed: true, dropKind: null,
    };
    const crate: Decoration = {
      ...DECORATION_DEFINITIONS.crateCargo,
      id: "edge-crate", roomId: room.id,
      x: barrel.x + BARREL_EXPLOSION_RADIUS + DECORATION_DEFINITIONS.crateCargo.hitboxRadii.x,
      y: barrel.y + barrel.hitboxOffset.y - DECORATION_DEFINITIONS.crateCargo.hitboxOffset.y,
      maxHp: 4, hp: 4, destroyed: false, dropKind: null,
    };
    const player = {
      x: barrel.x + BARREL_EXPLOSION_RADIUS + PLAYER_SPEC.hitboxRadii.x,
      y: barrel.y + barrel.hitboxOffset.y - PLAYER_SPEC.hitboxOffset.y,
    };
    const monsterSpec = monsterSpecForSpawner(barrel, 1, 1);
    const monster = {
      ...monsterSpec,
      active: true,
      x: barrel.x + BARREL_EXPLOSION_RADIUS + monsterSpec.hitboxRadii.x,
      y: barrel.y + barrel.hitboxOffset.y - monsterSpec.hitboxOffset.y,
    };

    expect(barrelExplosionTargets(barrel, [crate], [monster], player)).toMatchObject({
      decorations: [crate], monsters: [monster], hitsPlayer: true,
    });
    expect(barrelExplosionTargets(
      barrel,
      [{ ...crate, x: crate.x + 1 }],
      [{ ...monster, x: monster.x + 1 }],
      { ...player, x: player.x + 1 },
    )).toMatchObject({ decorations: [], monsters: [], hitsPlayer: false });
  });

  it("finds monster hitboxes across spatial cell boundaries and refreshes after movement", () => {
    const template = monsterSpecsForRoom(node(9_001, 0, 1, { isRoot: false }))[0]!;
    const cellSize = WORLD_GEOMETRY.spatialCellSize;
    const centerOffsetY = template.hitboxOffset.y;
    const near = {
      ...template,
      x: cellSize - template.hitboxRadii.x / 2,
      y: cellSize - template.hitboxRadii.y / 2 - centerOffsetY,
      active: false,
    };
    const far = { ...template, id: "far-monster", x: cellSize * 6 };
    const dead = { ...near, id: "dead-monster", dead: true };
    const hit = { x: cellSize + template.hitboxRadii.x / 2, y: cellSize + template.hitboxRadii.y / 2 };

    const cells = indexMonsterHitboxes([near, far, dead]);
    // Index inactive monsters so discovering a room during a tick can activate them immediately.
    expect(monsterCollisionCandidates(cells, hit, 0)).toEqual(new Set([near]));
    expect(monsterCollisionCandidates(cells, { x: cellSize, y: cellSize }, cellSize)).toEqual(new Set([near]));

    near.x = cellSize * 3;
    near.y = cellSize * 3 - centerOffsetY;
    const movedCells = indexMonsterHitboxes([near, far, dead]);
    expect(monsterCollisionCandidates(movedCells, hit, 0)).toEqual(new Set());
    expect(monsterCollisionCandidates(movedCells, { x: near.x, y: near.y + centerOffsetY }, 0))
      .toEqual(new Set([near]));
  });

  it("indexes hitboxes at their X/Y-offset centers using separate extents", () => {
    const template = monsterSpecsForRoom(node(9_002, 0, 1, { isRoot: false }))[0]!;
    const cell = WORLD_GEOMETRY.spatialCellSize;
    const monster = {
      ...template,
      x: cell - 60,
      y: cell + 5,
      hitboxOffset: { x: 70, y: -10 },
      hitboxRadii: { x: 3, y: 7 },
    };
    const cells = indexMonsterHitboxes([monster]);
    expect(monsterCollisionCandidates(cells, { x: cell + 10, y: cell - 5 }, 0)).toEqual(new Set([monster]));
    expect(monsterCollisionCandidates(cells, { x: monster.x, y: monster.y }, 0)).toEqual(new Set());
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
    expect(item.hitboxOffset.y).toBeLessThan(0);
    expect(projectileHitsDecoration(item, { x: item.x + item.hitboxOffset.x, y: item.y + item.hitboxOffset.y }, 1)).toBe(true);
    expect(projectileHitsDecoration(item, {
      x: item.x + item.hitboxOffset.x,
      y: item.y + item.hitboxOffset.y - item.hitboxRadii.y - 2,
    }, 1)).toBe(false);
  });

  it("releases actor projectiles from the visual center instead of the floor anchor", () => {
    expect(actorAimDirection(
      { x: 100, y: 200 },
      { x: 0, y: -50 },
      { x: 200, y: 150 },
    )).toEqual({ x: 1, y: 0 });
    expect(actorProjectileOrigin(
      { x: 100, y: 200 },
      { x: 1, y: 0 },
      { x: 0, y: -50 },
      40,
      10,
    )).toEqual({ x: 140, y: 160 });
    expect(actorProjectileOrigin(
      { x: 100, y: 200 },
      { x: 0, y: -1 },
      { x: 0, y: -50 },
      40,
    )).toEqual({ x: 100, y: 110 });
    expect(actorCollisionCenter({ x: 100, y: 200 }, { x: 0, y: -50 })).toEqual({ x: 100, y: 150 });
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

  it("leaves species-specific wrecks and parts when enemies die", () => {
    const definitions = [
      ["scout", REGULAR_MONSTER_DEFINITIONS["melee-light"]],
      ["heavy", REGULAR_MONSTER_DEFINITIONS["melee-heavy"]],
      ["sentry-ballistic", REGULAR_MONSTER_DEFINITIONS["sentry-light"]],
      ["sentry-twin", REGULAR_MONSTER_DEFINITIONS["sentry-heavy"]],
      ["sentry-energy", REGULAR_MONSTER_DEFINITIONS["sentry-scatter"]],
      ["boss-arc", BOSS_DEFINITIONS["deepseek-summoner"]],
      ["boss-missile", BOSS_DEFINITIONS["kimi-spiral"]],
      ["boss-fortress", BOSS_DEFINITIONS["glm-hunter"]],
      ["boss-laser", BOSS_DEFINITIONS["qwen-teleporter"]],
      ["boss-siege", BOSS_DEFINITIONS["hy4-wave"]],
    ] as const;
    for (const [kind, definition] of definitions) {
      const prefix = `assets/debris/enemies__${kind.replaceAll("-", "_")}__`;
      expect(definition.visual.destroyed?.slice(0, 2).map(clip => clip.frames[0]), kind).toEqual([
        `${prefix}wreck.png`,
        `${prefix}parts.png`,
      ]);
      expect(definition.visual.destroyed?.every(clip => clip.origin.y === 0.5)).toBe(true);
      expect(definition.destroyedVisualOffset.y).toBeCloseTo(
        -definition.size * definition.visual.destroyed![0]!.sizeScale * 0.4375,
      );
    }
  });

  it("uses matching debris for colored barrels, electronics, energy, and fuel props", () => {
    const assetsFor = (definition: { visual: { destroyed?: readonly SpriteClip[] } }) =>
      definition.visual.destroyed?.map(clip => clip.frames[0]) ?? [];
    expect(assetsFor(DECORATION_DEFINITIONS.barrelRed)).toContain(DEBRIS_ASSETS.redBarrelWreck);
    expect(assetsFor(DECORATION_DEFINITIONS.barrelCoolant)).toEqual(expect.arrayContaining([
      DEBRIS_ASSETS.blueBarrelWreck, DEBRIS_ASSETS.turquoiseBarrelShards,
    ]));
    expect(assetsFor(DECORATION_DEFINITIONS.barrelHazard)).toContain(DEBRIS_ASSETS.yellowBarrelWreck);
    expect(assetsFor(DECORATION_DEFINITIONS.terminal)).toContain(DEBRIS_ASSETS.cyanMonitor);
    expect(assetsFor(DECORATION_DEFINITIONS.serverRack)).toContain(DEBRIS_ASSETS.electronicsCabinet);
    expect(assetsFor(DECORATION_DEFINITIONS.energyCapacitor)).toContain(DEBRIS_ASSETS.purpleEnergyCoil);
    expect(assetsFor(DECORATION_DEFINITIONS.fuelPumpSkid)).toEqual(expect.arrayContaining([
      DEBRIS_ASSETS.greenChemicalBarrel, DEBRIS_ASSETS.orangeFuelBarrel,
    ]));
    expect(assetsFor(DECORATION_DEFINITIONS.canisterRack)).toContain(DEBRIS_ASSETS.mixedBarrelParts);
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
    expect(lowProp).toMatchObject({ obstacle: true, destructible: true });
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

  it("varies regular monster loot across adjacent seeds from one room", () => {
    // The former (seed >>> 3) % 100 roll produced four medkits for these IDs.
    const roomSeed = stableHash("35|monsters");
    const seeds = Array.from({ length: 4 }, (_, index) => stableHash(`${roomSeed}|1|${index}`));
    const kinds = seeds.map(monsterLootKindForSeed);

    expect(new Set(kinds).size).toBeGreaterThanOrEqual(3);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(seeds.map(monsterLootKindForSeed)).toEqual(kinds);
    }
  });

  it("keeps regular monster loot weights across many room seeds", () => {
    const byRoom = Array.from({ length: 1_000 }, (_, roomSeed) => {
      const monstersSeed = stableHash(`${roomSeed}|monsters`);
      return Array.from({ length: 6 }, (_, index) =>
        monsterLootKindForSeed(stableHash(`${monstersSeed}|1|${index}`)));
    });
    expect(byRoom.filter(drops => new Set(drops.slice(0, 4)).size === 1).length).toBeLessThan(40);
    const kinds = byRoom.flat();
    for (const [kind, chance] of [
      ["credit", 0.30], ["energy", 0.30], ["core", 0.20], ["medkit", 0.15], ["crystal", 0.05],
    ] as const) {
      expect(Math.abs(kinds.filter(drop => drop === kind).length / kinds.length - chance))
        .toBeLessThan(0.025);
    }
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
    expect(scatter).toHaveLength(5);
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
    const floorTenSpawnersByRoom = combatRooms.map(room =>
      decorationSpecsForRoom(room, 10).filter(item => item.spawner)
    );
    const floorTenCounts = floorTenSpawnersByRoom.map(items => items.length);
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
    const floorTenSpawners = floorTenSpawnersByRoom.flat();
    const dropKinds = floorTenSpawners.map(item => item.dropKind);
    expect(dropKinds).toContain(null);
    expect(new Set(dropKinds.filter(kind => kind !== null)).size).toBeGreaterThan(1);
    expect(floorTenSpawners.every(item =>
      item.dropKind === sceneryDropKindForSeed(item.visualVariant!)
    )).toBe(true);

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
    expect(restoredSpawner).toMatchObject({ hp: 2, spawnedCount: 2, dropKind: spawner.dropKind });

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
      .map(item => ({ x: item.x, y: item.y, footprintRadii: item.footprintRadii }));
    let savedPosition: Point | undefined;
    for (let ring = 0; ring <= 9 && !savedPosition; ring += 1) {
      for (let index = 0; index < 24; index += 1) {
        const angle = index / 24 * Math.PI * 2;
        const position = {
          x: reinforcement.x + Math.cos(angle) * 45 * ring,
          y: reinforcement.y + Math.sin(angle) * 45 * ring,
        };
        if (monsterPositionIsClear(position, reinforcement.footprintRadii, combatLayout, restoredDecorations, placedBeforeSave)) {
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
      restoredReinforcement.footprintRadii,
      combatLayout,
      restoredDecorations,
    )).toBe(true);
  });

  it("keeps relocated doorway spawners separate from each other and room decorations", () => {
    const room = node(2_500, 0, 1, {
      tag: "section",
      width: ROOM_WIDTH * 2,
      height: ROOM_HEIGHT * 2,
      lootSeed: stableHash("crowded-spawner-doorways"),
    });
    const original = decorationSpecsForRoom(room, 10).filter(item => item.spawner);
    expect(original.length).toBeGreaterThanOrEqual(3);
    const doorwayFor = (item: Decoration): Point => {
      const dx = item.x - room.x;
      const dy = item.y - room.y;
      return Math.abs(dx) > Math.abs(dy)
        ? { x: room.x + Math.sign(dx) * room.width / 2, y: item.y }
        : { x: item.x, y: room.y + Math.sign(dy) * room.height / 2 };
    };
    const links: LayoutLink[] = original.slice(0, 3).map((item, index) => {
      const door = doorwayFor(item);
      return {
        id: `${room.id}->${index}`,
        source: room,
        target: node(3_000 + index, room.id, 2),
        direction: door.x !== item.x
          ? (item.x > room.x ? "E" : "W")
          : (item.y > room.y ? "S" : "N"),
        ownerRoomId: room.id,
        width: WORLD_GEOMETRY.corridorHalfWidth * 2,
        points: [door, door],
        direct: true,
      };
    });
    const layout = { nodes: [room], links, hiddenCount: 0 };
    const placed = buildDecorations(layout, new Map(), 10);
    const spawners = placed.filter(item => item.spawner);
    const relocated = original.slice(0, 3).filter(item => {
      const moved = spawners.find(candidate => candidate.id === item.id);
      return moved && (moved.x !== item.x || moved.y !== item.y);
    });
    expect(relocated).toHaveLength(0);
    expect(buildDecorations(layout, new Map(), 10)).toEqual(placed);
    for (const spawner of spawners) {
      for (const other of placed) {
        if (spawner.id === other.id) continue;
        expect(Math.hypot(spawner.x - other.x, spawner.y - other.y)).toBeGreaterThanOrEqual(
          Math.max(10, spawner.footprintRadii.x, spawner.footprintRadii.y) +
          Math.max(10, other.footprintRadii.x, other.footprintRadii.y) + 8,
        );
      }
    }
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

  it("favors the contents of dedicated crates without guaranteeing a drop", () => {
    const seeds = Array.from({ length: 5_000 }, (_, index) => stableHash(`crate-drop-${index}`));
    const generalDrops = seeds.map(seed => sceneryDropKindForSeed(seed));
    expect(seeds.map(seed => sceneryDropKindForSeed(seed, DECORATION_DEFINITIONS.crateCargo.definitionId)))
      .toEqual(generalDrops);

    for (const [definitionId, favoredKind] of [
      [DECORATION_DEFINITIONS.crateMedical.definitionId, "medkit"],
      [DECORATION_DEFINITIONS.crateAmmo.definitionId, "core"],
      [DECORATION_DEFINITIONS.crateArmored.definitionId, "energy"],
    ] as const) {
      const drops = seeds.map(seed => sceneryDropKindForSeed(seed, definitionId));
      expect(drops.filter(kind => kind === null).length).toBe(generalDrops.filter(kind => kind === null).length);
      expect(drops.filter(kind => kind === favoredKind).length)
        .toBeGreaterThan(generalDrops.filter(kind => kind === favoredKind).length * 2);
      expect(drops.some(kind => kind !== null && kind !== favoredKind)).toBe(true);
    }
  });

  it("assigns dedicated crate drops from their own definition and seed", () => {
    const crates = Array.from({ length: 240 }, (_, index) =>
      decorationSpecsForRoom(node(index + 5_000, 0, 1, { lootSeed: stableHash(`crate-room-${index}`) }))
    ).flat().filter(item => item.kind === "crate");
    const dedicated = [
      DECORATION_DEFINITIONS.crateMedical.definitionId,
      DECORATION_DEFINITIONS.crateAmmo.definitionId,
      DECORATION_DEFINITIONS.crateArmored.definitionId,
    ];
    for (const definitionId of dedicated) {
      const matching = crates.filter(item => item.definitionId === definitionId);
      expect(matching.length).toBeGreaterThan(0);
      expect(matching.every(item =>
        item.dropKind === sceneryDropKindForSeed(item.visualVariant!, definitionId)
      )).toBe(true);
    }
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
