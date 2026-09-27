import { describe, expect, it } from "vitest";
import { world } from "../../src/client/config";
import { pointInCorridor, pointInRoomFloor } from "../../src/client/domain/geometry";
import { PLAYER_SPEC, WORLD_GEOMETRY } from "../../src/client/domain/specs";
import { buildBlockedWallRegions, type DebugWallRegion } from "../../src/client/render/wall-debug-plan";
import type { DungeonLayout, GraphNode, LayoutLink, Point } from "../../src/client/types";

const step = world(8);
const roomWidth = WORLD_GEOMETRY.segmentSize * 4;

function room(id: number, x: number): GraphNode {
  return {
    id, x, y: 0, width: roomWidth, height: roomWidth,
    parentId: id === 0 ? null : 0, tag: "div", depth: id,
    hrefs: [], coalescedCount: 0, label: "", floorLabel: "", title: "", contentHtml: null,
    lootSeed: id, isRoot: id === 0, isHidden: false, parentSide: null,
    directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

function covered(regions: readonly DebugWallRegion[], point: Point): boolean {
  const { x, y } = point;
  return regions.some(region => x >= region.x && x < region.x + region.width &&
    y >= region.y && y < region.y + region.height);
}

describe("wall collision debug overlay", () => {
  it("shades blocked room edges and corridor sides while leaving door openings and floors clear", () => {
    const source = room(0, 0);
    const startX = source.x + source.width / 2;
    const endX = startX + WORLD_GEOMETRY.segmentSize * 3;
    const target = room(1, endX + roomWidth / 2);
    const link: LayoutLink = {
      id: "east", source, target, direction: "E", ownerRoomId: source.id,
      width: WORLD_GEOMETRY.corridorHalfWidth * 2,
      points: [{ x: startX, y: 0 }, { x: endX, y: 0 }],
    };
    const layout: DungeonLayout = { nodes: [source, target], links: [link], hiddenCount: 0 };
    const regions = buildBlockedWallRegions(layout, PLAYER_SPEC.radius, step);
    expect(regions.length).toBeGreaterThan(0);
    expect(covered(regions, { x: 0, y: -source.height / 2 + PLAYER_SPEC.radius / 2 })).toBe(true);
    expect(covered(regions, { x: startX - PLAYER_SPEC.radius / 2, y: world(140) })).toBe(true);
    expect(covered(regions, { x: (startX + endX) / 2, y: link.width / 2 - PLAYER_SPEC.radius / 2 })).toBe(true);
    expect(covered(regions, { x: startX - PLAYER_SPEC.radius / 2,
      y: WORLD_GEOMETRY.verticalDoorPassableOffsetY })).toBe(false);
    expect(covered(regions, { x: 0, y: 0 })).toBe(false);
    expect(covered(regions, { x: (startX + endX) / 2, y: 0 })).toBe(false);
  });

  it("keeps the opening between directly connected rooms clear", () => {
    const source = room(0, 0);
    const target = room(1, source.width);
    const doorway = { x: source.width / 2, y: 0 };
    const layout: DungeonLayout = {
      nodes: [source, target], hiddenCount: 0,
      links: [{ id: "direct", source, target, direction: "E", ownerRoomId: 0,
        width: WORLD_GEOMETRY.doorOpeningWidth, points: [doorway], direct: true }],
    };
    const regions = buildBlockedWallRegions(layout, PLAYER_SPEC.radius, step);
    expect(covered(regions, { x: doorway.x, y: WORLD_GEOMETRY.verticalDoorPassableOffsetY })).toBe(false);
    expect(covered(regions, { x: doorway.x, y: world(150) })).toBe(true);
  });

  it("does not paint the walkable fraction of a boundary cell at a doorway", () => {
    const source = room(0, 0);
    const target = room(1, source.width);
    const doorway = { x: source.width / 2, y: 0 };
    const link: LayoutLink = {
      id: "direct", source, target, direction: "E", ownerRoomId: 0,
      width: WORLD_GEOMETRY.doorOpeningWidth, points: [doorway], direct: true,
    };
    const regions = buildBlockedWallRegions({ nodes: [source, target], links: [link], hiddenCount: 0 });
    const edge = WORLD_GEOMETRY.verticalDoorPassableOffsetY +
      WORLD_GEOMETRY.doorOpeningWidth / 2 - PLAYER_SPEC.radius;
    const inside = { x: doorway.x, y: edge - 0.1 };
    const outside = { x: doorway.x, y: edge + 0.1 };
    expect(pointInCorridor(inside.x, inside.y, link)).toBe(true);
    expect(pointInRoomFloor(inside.x, inside.y, source)).toBe(false);
    expect(covered(regions, inside)).toBe(false);
    expect(covered(regions, outside)).toBe(true);
  });

  it("splits corridor-side cells at the same boundary used for movement", () => {
    const source = room(0, 0);
    const startX = source.width / 2;
    const endX = startX + WORLD_GEOMETRY.segmentSize * 3;
    const target = room(1, endX + roomWidth / 2);
    const link: LayoutLink = {
      id: "east", source, target, direction: "E", ownerRoomId: 0,
      width: WORLD_GEOMETRY.corridorHalfWidth * 2,
      points: [{ x: startX, y: 0 }, { x: endX, y: 0 }],
    };
    const regions = buildBlockedWallRegions({ nodes: [source, target], links: [link], hiddenCount: 0 });
    const edge = link.width / 2 - PLAYER_SPEC.radius;
    const x = (startX + endX) / 2;
    expect(pointInCorridor(x, edge - 0.1, link)).toBe(true);
    expect(covered(regions, { x, y: edge - 0.1 })).toBe(false);
    expect(pointInCorridor(x, edge + 0.1, link)).toBe(false);
    expect(covered(regions, { x, y: edge + 0.1 })).toBe(true);
  });
});
