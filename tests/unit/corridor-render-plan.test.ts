import { describe, expect, it } from "vitest";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { WORLD_GEOMETRY } from "../../src/client/domain/specs";
import {
  buildCorridorRenderPlan,
  type CorridorCornerKind,
} from "../../src/client/render/corridor-render-plan";
import type {
  Direction,
  DungeonLayout,
  GraphNode,
  LayoutLink,
  Point,
} from "../../src/client/types";

const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;
const CORRIDOR_WIDTH = WORLD_GEOMETRY.corridorHalfWidth * 2;

function room(id: number, parentId: number | null = null): GraphNode {
  return {
    id,
    parentId,
    tag: "div",
    depth: parentId === null ? 0 : 1,
    hrefs: [],
    coalescedCount: 0,
    label: `Room ${id}`,
    floorLabel: `F${id}`,
    title: `Room ${id}`,
    contentHtml: null,
    x: 0,
    y: 0,
    width: SEGMENT_SIZE * 4,
    height: SEGMENT_SIZE * 4,
    lootSeed: id + 100,
    isRoot: parentId === null,
    isHidden: false,
    parentSide: null,
    directionFromParent: null,
    shape: "rectangle",
    childCount: 0,
  };
}

function directionBetween(start: Point, end: Point): Direction {
  if (end.x > start.x) return "E";
  if (end.x < start.x) return "W";
  if (end.y > start.y) return "S";
  return "N";
}

function layoutForArms(directions: readonly Direction[]): DungeonLayout {
  const source = room(0);
  const links = directions.map<LayoutLink>((direction, index) => {
    const target = room(index + 1, 0);
    const end = ({
      N: { x: 0, y: -SEGMENT_SIZE * 2 },
      E: { x: SEGMENT_SIZE * 2, y: 0 },
      S: { x: 0, y: SEGMENT_SIZE * 2 },
      W: { x: -SEGMENT_SIZE * 2, y: 0 },
    } as const)[direction];
    return {
      id: `arm-${direction}`,
      source,
      target,
      direction,
      ownerRoomId: source.id,
      width: CORRIDOR_WIDTH,
      points: [{ x: 0, y: 0 }, end],
    };
  });
  return { nodes: [source, ...links.map(link => link.target)], links, hiddenCount: 0 };
}

function sortedCornerKinds(layout: DungeonLayout): CorridorCornerKind[] {
  return buildCorridorRenderPlan(layout, SEGMENT_SIZE).corners
    .map(corner => corner.kind)
    .sort();
}

describe("corridor render planning", () => {
  it.each([
    [["N", "W"], "bottom-right"],
    [["N", "E"], "bottom-left"],
    [["S", "W"], "top-right"],
    [["S", "E"], "top-left"],
  ] as const)("encloses the %s bend with the %s internal corner", (directions, expectedCorner) => {
    const plan = buildCorridorRenderPlan(layoutForArms(directions), SEGMENT_SIZE);

    expect(plan.corners.map(corner => corner.kind)).toEqual([expectedCorner]);
    expect(plan.junctionFloors).toHaveLength(1);
    expect(plan.outerCorners).toHaveLength(1);
    expect(plan.outerCorners[0]).toMatchObject({
      x: expectedCorner.endsWith("left") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2,
      y: expectedCorner.startsWith("top") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2,
    });
    expect(plan.corners[0]).toMatchObject({
      x: expectedCorner.endsWith("left") ? SEGMENT_SIZE / 2 : -SEGMENT_SIZE / 2,
      y: expectedCorner.startsWith("top") ? SEGMENT_SIZE / 2 : -SEGMENT_SIZE / 2,
    });
    expect(plan.walls).toHaveLength(6);
  });

  it.each([
    [["N", "W", "E"], ["top-left", "top-right"]],
    [["S", "W", "E"], ["bottom-left", "bottom-right"]],
    [["E", "N", "S"], ["bottom-right", "top-right"]],
    [["W", "N", "S"], ["bottom-left", "top-left"]],
  ] as const)("encloses the %s junction with both corridor corners", (directions, expectedCorners) => {
    const layout = layoutForArms(directions);
    const plan = buildCorridorRenderPlan(layout, SEGMENT_SIZE);

    expect(sortedCornerKinds(layout)).toEqual([...expectedCorners].sort());
    for (const corner of plan.corners) {
      expect(corner.x).toBe(corner.kind.endsWith("left") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2);
      expect(corner.y).toBe(corner.kind.startsWith("top") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2);
    }
    expect(plan.junctionFloors).toEqual([]);
    expect(plan.outerCorners).toEqual([]);
    expect(plan.walls).toHaveLength(8);
  });

  it("encloses a four-way junction with all four internal corners", () => {
    const plan = buildCorridorRenderPlan(layoutForArms(["N", "E", "S", "W"]), SEGMENT_SIZE);

    expect(plan.corners.map(corner => corner.kind).sort()).toEqual([
      "bottom-left",
      "bottom-right",
      "top-left",
      "top-right",
    ]);
    for (const corner of plan.corners) {
      expect(corner.x).toBe(corner.kind.endsWith("left") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2);
      expect(corner.y).toBe(corner.kind.startsWith("top") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2);
    }
    expect(plan.junctionFloors).toEqual([]);
    expect(plan.outerCorners).toEqual([]);
    expect(plan.walls).toHaveLength(8);
    expect(plan.walls.some(wall =>
      Math.abs(wall.x) <= SEGMENT_SIZE / 2 &&
      Math.abs(wall.y) <= SEGMENT_SIZE / 2
    )).toBe(false);
  });

  it("removes both straight wall modules where corridor arms overlap", () => {
    const source = room(0);
    const corner = { x: 0, y: 0 };
    const west = { x: -SEGMENT_SIZE * 2, y: 0 };
    const north = { x: 0, y: -SEGMENT_SIZE * 2 };
    const links: LayoutLink[] = [
      {
        id: "west",
        source,
        target: room(1, 0),
        direction: directionBetween(west, corner),
        ownerRoomId: source.id,
        width: CORRIDOR_WIDTH,
        points: [west, corner],
      },
      {
        id: "north",
        source,
        target: room(2, 0),
        direction: directionBetween(corner, north),
        ownerRoomId: source.id,
        width: CORRIDOR_WIDTH,
        points: [corner, north],
      },
    ];
    const plan = buildCorridorRenderPlan({ nodes: [source], links, hiddenCount: 0 }, SEGMENT_SIZE);
    const hasWall = (side: Direction, x: number, y: number): boolean => plan.walls.some(wall =>
      wall.side === side && wall.x === x && wall.y === y
    );

    expect(hasWall("N", -SEGMENT_SIZE / 2, -SEGMENT_SIZE / 2)).toBe(false);
    expect(hasWall("W", -SEGMENT_SIZE / 2, -SEGMENT_SIZE / 2)).toBe(false);
    expect(hasWall("S", -SEGMENT_SIZE / 2, SEGMENT_SIZE / 2)).toBe(true);
    expect(hasWall("E", SEGMENT_SIZE / 2, -SEGMENT_SIZE / 2)).toBe(true);
  });

  it("deduplicates a fork trunk and gives its entrance and branches distinct signs", () => {
    const nodes = [
      room(0),
      ...Array.from({ length: 8 }, (_, index) => room(index + 1, 0)),
    ];
    const layout = layoutOrthogonal({
      nodes,
      links: [],
      originalCount: nodes.length,
      coalescedCount: 0,
      truncated: false,
    });
    const plan = buildCorridorRenderPlan(layout, SEGMENT_SIZE);
    const segmentKeys = plan.segments.map(segment => [
      Math.min(segment.start.x, segment.end.x),
      Math.min(segment.start.y, segment.end.y),
      Math.max(segment.start.x, segment.end.x),
      Math.max(segment.start.y, segment.end.y),
    ].join(":"));
    const entrySigns = plan.markings.filter(marking => marking.label === "");
    const forwardBranchSigns = plan.markings.filter(marking =>
      layout.links.some(link => marking.label === link.target.floorLabel)
    );
    const returnBranchSigns = plan.markings.filter(marking => marking.label === nodes[0]!.floorLabel);
    const nearestForkDistance = Math.min(...layout.links.map(link => {
      const start = link.points[0]!;
      const fork = link.points[link.forkPointIndex!]!;
      return Math.hypot(fork.x - start.x, fork.y - start.y);
    }));

    expect(new Set(segmentKeys).size).toBe(segmentKeys.length);
    expect(plan.segments).toHaveLength(layout.links.length + 1);
    expect(entrySigns).toHaveLength(1);
    expect(entrySigns[0]!.lateralOffset).toBe(0);
    expect(Math.hypot(
      entrySigns[0]!.end.x - entrySigns[0]!.start.x,
      entrySigns[0]!.end.y - entrySigns[0]!.start.y,
    )).toBe(nearestForkDistance);
    expect(Math.hypot(
      entrySigns[0]!.position.x - entrySigns[0]!.start.x,
      entrySigns[0]!.position.y - entrySigns[0]!.start.y,
    )).toBe(SEGMENT_SIZE / 2);
    expect(forwardBranchSigns).toHaveLength(layout.links.length);
    expect(forwardBranchSigns.every(marking => marking.lateralOffset === -SEGMENT_SIZE / 3)).toBe(true);
    expect(forwardBranchSigns.every(marking => Math.hypot(
      marking.position.x - marking.start.x,
      marking.position.y - marking.start.y,
    ) === SEGMENT_SIZE * 1.5)).toBe(true);
    expect(new Set(forwardBranchSigns.map(marking => marking.label))).toEqual(
      new Set(layout.links.map(link => link.target.floorLabel)),
    );
    expect(returnBranchSigns).toHaveLength(layout.links.length);
    expect(returnBranchSigns.every(marking => marking.lateralOffset === SEGMENT_SIZE / 3)).toBe(true);
    expect(returnBranchSigns.every(marking => Math.hypot(
      marking.position.x - marking.start.x,
      marking.position.y - marking.start.y,
    ) === SEGMENT_SIZE / 2)).toBe(true);
  });

  it("places signs just inside both entrances of a straight corridor", () => {
    const source = room(0);
    const target = room(1, 0);
    const end = { x: SEGMENT_SIZE * 6, y: 0 };
    const link: LayoutLink = {
      id: "long-run",
      source,
      target,
      direction: "E",
      ownerRoomId: source.id,
      width: CORRIDOR_WIDTH,
      points: [{ x: 0, y: 0 }, end],
    };

    const markings = buildCorridorRenderPlan(
      { nodes: [source, target], links: [link], hiddenCount: 0 },
      SEGMENT_SIZE,
    ).markings;

    expect(markings).toMatchObject([
      {
        start: { x: 0, y: 0 },
        end,
        position: { x: SEGMENT_SIZE / 2, y: 0 },
        label: target.floorLabel,
        lateralOffset: -SEGMENT_SIZE / 3,
      },
      {
        start: end,
        end: { x: 0, y: 0 },
        position: { x: end.x - SEGMENT_SIZE / 2, y: 0 },
        label: source.floorLabel,
        lateralOffset: SEGMENT_SIZE / 3,
      },
    ]);
  });
});
