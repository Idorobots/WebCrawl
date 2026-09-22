import { describe, expect, it } from "vitest";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { WORLD_GEOMETRY } from "../../src/client/domain/specs";
import {
  buildCorridorRenderPlan,
  buildRoomWalls,
  doorModuleStyle,
  wallModuleStyle,
  type CorridorCornerKind,
  type DoorModulePlan,
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

function sortedCornerKinds(layout: DungeonLayout): string[] {
  return buildCorridorRenderPlan(layout, SEGMENT_SIZE).corners
    .filter(corner => corner.kind !== "wall")
    .map(corner => corner.kind)
    .sort();
}

const cell = (kind: string): Point => ({
  x: kind.endsWith("left") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2,
  y: kind.startsWith("top") ? -SEGMENT_SIZE / 2 : SEGMENT_SIZE / 2,
});

const oppositeCorner = (kind: string): string => {
  const vertical = kind.startsWith("top") ? "bottom" : "top";
  const horizontal = kind.endsWith("left") ? "right" : "left";
  return `${vertical}-${horizontal}`;
};

describe("corridor render planning", () => {
  it.each([
    [["N", "W"], "bottom-right", 4],
    [["N", "E"], "bottom-left", 5],
    [["S", "W"], "top-right", 5],
    [["S", "E"], "top-left", 6],
  ] as const)("encloses the %s bend with the %s corner construction on both corner cells", (directions, expectedCorner, expectedWalls) => {
    const plan = buildCorridorRenderPlan(layoutForArms(directions), SEGMENT_SIZE);
    const outerCell = cell(expectedCorner);
    const innerKindCell = oppositeCorner(expectedCorner);
    const innerCell = cell(innerKindCell);
    const innerShift = {
      x: innerKindCell.endsWith("left") ? -SEGMENT_SIZE : SEGMENT_SIZE,
      y: innerKindCell.startsWith("top") ? -SEGMENT_SIZE : SEGMENT_SIZE,
    };

    expect(plan.corners.filter(corner => corner.kind !== "wall").map(corner => corner.kind))
      .toEqual([expectedCorner, expectedCorner]);
    expect(plan.junctionFloors).toHaveLength(1);
    expect(plan.corners.filter(corner => corner.kind !== "wall")).toMatchObject([
      { kind: expectedCorner, x: outerCell.x, y: outerCell.y },
      { kind: expectedCorner, x: innerCell.x + innerShift.x, y: innerCell.y + innerShift.y },
    ]);
    expect(plan.walls).toHaveLength(expectedWalls);
  });

  it.each([
    [["N", "W", "E"], ["bottom-left", "bottom-right"], 5],
    [["S", "W", "E"], ["top-left", "top-right"], 7],
    [["E", "N", "S"], ["bottom-left", "top-left"], 7],
    [["W", "N", "S"], ["bottom-right", "top-right"], 5],
  ] as const)("encloses the %s junction with the opposite constructions on its concave corners", (directions, expectedCorners, expectedWalls) => {
    const layout = layoutForArms(directions);
    const plan = buildCorridorRenderPlan(layout, SEGMENT_SIZE);

    expect(sortedCornerKinds(layout)).toEqual([...expectedCorners].sort());
    for (const corner of plan.corners.filter(candidate => candidate.kind !== "wall")) {
      // The construction kind is the diagonally opposite room corner of the
      // corner's own cell.
      expect(corner.kind).toBe(oppositeCorner(
        `${corner.y < 0 ? "top" : "bottom"}-${corner.x < 0 ? "left" : "right"}`,
      ));
    }
    expect(plan.junctionFloors).toEqual([]);
    expect(plan.walls).toHaveLength(expectedWalls);
  });

  it("encloses a four-way junction with the opposite construction on every corner", () => {
    const plan = buildCorridorRenderPlan(layoutForArms(["N", "E", "S", "W"]), SEGMENT_SIZE);
    const cornerModules = plan.corners.filter(corner => corner.kind !== "wall");

    expect(cornerModules.map(corner => corner.kind).sort()).toEqual([
      "bottom-left",
      "bottom-right",
      "top-left",
      "top-right",
    ]);
    for (const corner of cornerModules) {
      expect(corner.kind).toBe(oppositeCorner(
        `${corner.y < 0 ? "top" : "bottom"}-${corner.x < 0 ? "left" : "right"}`,
      ));
    }
    expect(plan.junctionFloors).toEqual([]);
    expect(plan.walls).toHaveLength(4);
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

describe("wall module styles", () => {
  const style = (side: Direction, kind: "wall" | CorridorCornerKind) =>
    wallModuleStyle({ x: 0, y: 0, side, kind }, SEGMENT_SIZE);

  it("shifts northern horizontal walls one segment up", () => {
    expect(style("N", "wall")).toMatchObject({ offsetX: 0, offsetY: -SEGMENT_SIZE, width: SEGMENT_SIZE, height: SEGMENT_SIZE });
    expect(style("S", "wall")).toMatchObject({ offsetX: 0, offsetY: 0, width: SEGMENT_SIZE, height: SEGMENT_SIZE });
  });

  it("shifts western vertical walls one segment left and bottom-anchors the overlap", () => {
    expect(style("E", "wall")).toMatchObject({ offsetX: 0, offsetY: -SEGMENT_SIZE / 2, width: SEGMENT_SIZE, height: SEGMENT_SIZE * 2 });
    expect(style("W", "wall")).toMatchObject({ offsetX: -SEGMENT_SIZE, offsetY: -SEGMENT_SIZE / 2, width: SEGMENT_SIZE, height: SEGMENT_SIZE * 2 });
  });

  it("anchors left corners like vertical walls and top corners like northern walls", () => {
    expect(style("W", "top-left")).toMatchObject({ offsetX: -SEGMENT_SIZE, offsetY: -SEGMENT_SIZE, height: SEGMENT_SIZE });
    expect(style("E", "top-right")).toMatchObject({ offsetX: 0, offsetY: -SEGMENT_SIZE, height: SEGMENT_SIZE });
    expect(style("W", "bottom-left")).toMatchObject({ offsetX: -SEGMENT_SIZE, offsetY: -SEGMENT_SIZE / 2, height: SEGMENT_SIZE * 2 });
    expect(style("E", "bottom-right")).toMatchObject({ offsetX: 0, offsetY: -SEGMENT_SIZE / 2, height: SEGMENT_SIZE * 2 });
  });

  it("spans horizontal doors over two segments and vertical doors over three", () => {
    expect(doorModuleStyle("N", SEGMENT_SIZE)).toMatchObject({
      width: SEGMENT_SIZE * 2,
      height: SEGMENT_SIZE,
      offsetX: 0,
      offsetY: -SEGMENT_SIZE / 2,
    });
    expect(doorModuleStyle("S", SEGMENT_SIZE)).toMatchObject({ offsetX: 0, offsetY: -SEGMENT_SIZE / 2 });
    expect(doorModuleStyle("E", SEGMENT_SIZE)).toMatchObject({
      width: SEGMENT_SIZE,
      height: SEGMENT_SIZE * 3,
      offsetX: -SEGMENT_SIZE / 2,
      offsetY: -SEGMENT_SIZE * 0.75,
    });
    expect(doorModuleStyle("W", SEGMENT_SIZE)).toMatchObject({ offsetX: -SEGMENT_SIZE / 2, offsetY: -SEGMENT_SIZE * 0.75 });
  });
});

describe("room wall layout", () => {
  const door = (side: DoorModulePlan["side"], boundary: Point): DoorModulePlan => ({ position: boundary, side });

  it("reserves two cells for horizontal doors and three for vertical doors", () => {
    // 4x4-segment room centered on the origin; boundaries at +-2 segments.
    const baseRoom = { ...room(0), x: 0, y: 0 };
    const modules = buildRoomWalls(baseRoom, [
      door("N", { x: 0, y: -SEGMENT_SIZE * 2 }),
      door("E", { x: SEGMENT_SIZE * 2, y: 0 }),
    ], SEGMENT_SIZE);
    const edgeWall = (side: Direction, x: number, y: number): boolean => modules.some(module =>
      module.kind === "wall" && module.side === side && module.x === x && module.y === y,
    );

    // North row: columns 1 and 2 flank the boundary at x=0 and are both
    // reserved; only the top-left corner's own segment remains.
    expect(edgeWall("N", -SEGMENT_SIZE / 2, -SEGMENT_SIZE * 1.5)).toBe(false);
    expect(edgeWall("N", SEGMENT_SIZE / 2, -SEGMENT_SIZE * 1.5)).toBe(false);
    expect(modules.filter(module => module.side === "N" && module.kind === "wall")).toHaveLength(1);

    // The south row stays fully walled.
    expect(edgeWall("S", -SEGMENT_SIZE / 2, SEGMENT_SIZE * 1.5)).toBe(true);
    expect(edgeWall("S", SEGMENT_SIZE / 2, SEGMENT_SIZE * 1.5)).toBe(true);

    // East column: the door cell plus the two above (rows 1..2) are reserved;
    // the top-right corner's extra vertical segment stays at the corner row.
    expect(edgeWall("E", SEGMENT_SIZE * 1.5, -SEGMENT_SIZE * 1.5)).toBe(true);
    expect(edgeWall("E", SEGMENT_SIZE * 1.5, -SEGMENT_SIZE / 2)).toBe(false);
    expect(edgeWall("E", SEGMENT_SIZE * 1.5, SEGMENT_SIZE / 2)).toBe(false);
    expect(modules.filter(module => module.side === "E" && module.kind === "wall")).toHaveLength(1);

    // Corners are always placed regardless of reservations.
    expect(modules.filter(module => module.kind !== "wall")).toHaveLength(4);
  });

  it("places plain wall modules on every unreserved perimeter cell", () => {
    const baseRoom = { ...room(0), x: 0, y: 0 };
    const modules = buildRoomWalls(baseRoom, [], SEGMENT_SIZE);
    // 2 cells per edge plus the extra segments the top-left, top-right and
    // bottom-left corner cells need next to their corner sprites.
    expect(modules.filter(module => module.kind === "wall")).toHaveLength(12);
    expect(modules.filter(module => module.kind === "wall" && module.side === "N")).toEqual([
      { x: -SEGMENT_SIZE * 1.5, y: -SEGMENT_SIZE * 1.5, side: "N", kind: "wall" },
      { x: -SEGMENT_SIZE / 2, y: -SEGMENT_SIZE * 1.5, side: "N", kind: "wall" },
      { x: SEGMENT_SIZE / 2, y: -SEGMENT_SIZE * 1.5, side: "N", kind: "wall" },
    ]);
  });
});
