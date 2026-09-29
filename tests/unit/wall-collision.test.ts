import { describe, expect, it } from "vitest";
import { buildDecorations, weaponPedestalForRoom } from "../../src/client/domain/generation";
import { pointInCorridor, pointInRoomFloor } from "../../src/client/domain/geometry";
import { domToGraph } from "../../src/client/domain/graph";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { DEFAULT_BULLET_SPEC, PLAYER_SPEC, WORLD_GEOMETRY } from "../../src/client/domain/specs";
import {
  buildWallFootprints, wallBlocksSegment, wallHitboxes, wallOverlapsEllipse,
  wallPieceFootprints, WALL_FOOTPRINTS, WALL_HITBOX_SHIFT_Y, WallRectIndex,
} from "../../src/client/domain/wall-collision";
import type { DungeonLayout, GraphNode, LayoutLink } from "../../src/client/types";

const s = WORLD_GEOMETRY.segmentSize;

function room(id: number, x: number): GraphNode {
  return {
    id, x, y: 0, width: 4 * s, height: 4 * s,
    parentId: id ? 0 : null, tag: "div", depth: id, hrefs: [], coalescedCount: 0,
    label: "", floorLabel: "", title: "", contentHtml: null,
    lootSeed: id + 37, isRoot: id === 0, isHidden: false, parentSide: null,
    directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

function eastLayout(direct: boolean): DungeonLayout {
  const source = room(0, 0);
  const doorX = source.width / 2;
  const endX = direct ? doorX : doorX + 3 * s;
  const target = room(1, endX + source.width / 2);
  const link: LayoutLink = {
    id: "east", source, target, direction: "E", ownerRoomId: 0,
    width: 2 * s, points: direct ? [{ x: doorX, y: 0 }] : [{ x: doorX, y: 0 }, { x: endX, y: 0 }],
    direct,
  };
  return { nodes: [source, target], links: [link], hiddenCount: 0 };
}

describe("physical wall pieces", () => {
  it("has individually editable variants, with two floor rectangles for corners and doors", () => {
    expect(Object.keys(WALL_FOOTPRINTS)).toHaveLength(12);
    for (const kind of ["top-left", "top-right", "bottom-left", "bottom-right", "door-N", "door-E", "door-S", "door-W"] as const) {
      expect(WALL_FOOTPRINTS[kind]).toHaveLength(2);
    }
    expect(wallPieceFootprints("wall-W", { x: 100, y: 200 })[0]!.x)
      .toBe(100 + WALL_FOOTPRINTS["wall-W"][0]!.x);
    // The rendered corner's extra straight sprites do not add hidden colliders.
    expect(buildWallFootprints({ nodes: [room(0, 0)], links: [], hiddenCount: 0 })).toHaveLength(16);
  });

  it("uses floor footprints for actors and the same rectangles shifted north for projectiles", () => {
    const footprints = wallPieceFootprints("wall-N", { x: 0, y: 0 });
    const hitboxes = wallHitboxes(footprints);
    expect(hitboxes[0]).toEqual({ ...footprints[0]!, y: footprints[0]!.y + WALL_HITBOX_SHIFT_Y });
    const point = { x: 0, y: hitboxes[0]!.y + hitboxes[0]!.height / 2 };
    const small = { x: 1, y: 1 };
    expect(wallOverlapsEllipse(point, small, new WallRectIndex(hitboxes))).toBe(true);
    expect(wallOverlapsEllipse(point, small, new WallRectIndex(footprints))).toBe(false);
    expect(wallBlocksSegment({ x: -s, y: point.y }, { x: s, y: point.y }, small,
      new WallRectIndex(hitboxes))).toBe(true);
    expect(wallBlocksSegment({ x: -s, y: point.y }, { x: s, y: point.y }, small,
      new WallRectIndex(footprints))).toBe(false);
  });

  it.each([false, true])("keeps the %s doorway open but blocks its jambs", direct => {
    const layout = eastLayout(direct);
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const door = layout.links[0]!.points[0]!;
    const passY = WORLD_GEOMETRY.verticalDoorPassableOffsetY;
    const approach = { x: door.x - s / 2, y: passY };
    const beyond = { x: door.x + s / 2, y: passY };
    expect(wallBlocksSegment(approach, beyond, PLAYER_SPEC.footprintRadii, walls)).toBe(false);
    const jamb = wallPieceFootprints("door-E", door)[1]!;
    const jambY = jamb.y + jamb.height / 2;
    expect(wallBlocksSegment(
      { x: approach.x, y: jambY },
      { x: beyond.x, y: jambY },
      PLAYER_SPEC.footprintRadii, walls,
    )).toBe(true);
  });

  it.each(["N", "E", "S", "W"] as const)("leaves the %s door opening clear while its two jambs block", side => {
    const walls = new WallRectIndex(wallPieceFootprints(`door-${side}`, { x: 0, y: 0 }));
    const vertical = side === "E" || side === "W";
    const opening = vertical ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
    const from = vertical ? { x: -s / 2, y: opening } : { x: 0, y: -s / 2 };
    const to = vertical ? { x: s / 2, y: opening } : { x: 0, y: s / 2 };
    expect(wallBlocksSegment(from, to, PLAYER_SPEC.footprintRadii, walls)).toBe(false);
    const jamb = wallPieceFootprints(`door-${side}`, { x: 0, y: 0 })[1]!;
    const acrossJamb = { x: jamb.x + jamb.width / 2, y: jamb.y + jamb.height / 2 };
    expect(wallOverlapsEllipse(acrossJamb, PLAYER_SPEC.footprintRadii, walls)).toBe(true);
  });

  it("does not treat floor membership as an extra projectile wall outside the hitbox", () => {
    const layout = eastLayout(false);
    const link = layout.links[0]!;
    const hitboxes = new WallRectIndex(wallHitboxes(buildWallFootprints(layout)));
    const middleX = (link.points[0]!.x + link.points[1]!.x) / 2;
    const clearY = link.width / 2 - WORLD_GEOMETRY.wallThickness;
    const from = { x: middleX - s / 2, y: clearY };
    const to = { x: middleX + s / 2, y: clearY };
    const radius = { x: DEFAULT_BULLET_SPEC.radius, y: DEFAULT_BULLET_SPEC.radius };
    // The former floor-aligned check rejects this shot even though it crosses no teal hitbox.
    const floorY = clearY - PLAYER_SPEC.hitboxOffset.y;
    expect(layout.nodes.some(room => pointInRoomFloor(middleX, floorY, room)) ||
      pointInCorridor(middleX, floorY, link)).toBe(false);
    expect(wallBlocksSegment(from, to, radius, hitboxes)).toBe(false);
    const blockedY = clearY + WALL_HITBOX_SHIFT_Y + WORLD_GEOMETRY.wallThickness / 2;
    expect(wallBlocksSegment({ ...from, y: blockedY }, { ...to, y: blockedY }, radius, hitboxes)).toBe(true);
  });

  it("blocks an entire swept ellipse at corners and across a thin wall between safe endpoints", () => {
    const corner = new WallRectIndex(wallPieceFootprints("top-left", { x: 0, y: 0 }));
    expect(wallOverlapsEllipse({ x: -s / 2 + 1, y: -s / 2 + 1 }, { x: 3, y: 3 }, corner)).toBe(true);
    const wall = new WallRectIndex(wallPieceFootprints("wall-N", { x: 0, y: 0 }));
    expect(wallBlocksSegment({ x: 0, y: -s }, { x: 0, y: 0 }, { x: 2, y: 2 }, wall)).toBe(true);
    expect(wallBlocksSegment({ x: s, y: -s }, { x: s, y: 0 }, { x: 2, y: 2 }, wall)).toBe(false);
  });

  it("places generated scenery off the configured wall footprints", () => {
    const graph = domToGraph(
      `<body><main><h1>Test</h1><p>${"scenery ".repeat(30)}</p><section><p>More text</p></section><article><p>Readable text</p></article></main></body>`,
      "https://example.com/walls", 1,
    );
    const layout = layoutOrthogonal(graph);
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const original = buildDecorations(layout, new Map(), 1, walls);
    const blockedSpot = original.find(item => item.obstacle) ?? original[0]!;
    const adjustedWalls = new WallRectIndex([...walls.rects, {
      x: blockedSpot.x - 4, y: blockedSpot.y - 4, width: 8, height: 8,
    }]);
    const scenery = [
      ...buildDecorations(layout, new Map(), 1, adjustedWalls),
      ...layout.nodes.flatMap(room => {
        const pedestal = weaponPedestalForRoom(room, "walls", adjustedWalls);
        return pedestal ? [pedestal] : [];
      }),
    ];
    expect(scenery.length).toBeGreaterThan(0);
    for (const item of scenery) {
      expect(wallOverlapsEllipse(item, item.footprintRadii, adjustedWalls), item.id).toBe(false);
    }
  });
});
